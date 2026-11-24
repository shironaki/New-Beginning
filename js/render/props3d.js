/**
 * js/render/props3d.js — пропы мира из запечённых 3D-моделей вместо кривых.
 *
 * Данные приходят из `js/render/propsprites.js`, который генерирует
 * `node tools/prop-bake.js --emit` (модели — CC0-паки, см.
 * dev/character-style-lab/assets/kenney/README.md). Здесь только чтение кадров:
 * RLE → палитра → офскрин-канвас на kind×тон, и отрисовка с ветром, тенью и
 * погодой. Ничего не решаем на глаз: height кадра = `propHeight(kind, 1)` из
 * tilesart, поэтому проп занимает ровно то место в сетке коллизий, которое для
 * него уже зарезервировано.
 *
 * Почему офскрин-канвас, а не fillRect по пикселю: вал contains ~40 пропов на
 * экран, по 900 пикселей на сосну — это 36 000 заливок на кадр. Кэш по (kind,
 * тон) делает один decode на сезон, дальше только drawImage.
 *
 * Что здесь СОЗНАТЕЛЬНО не сделано:
 *   • один ракурс на проп (не четыре, как у героя): билборду хватает, а лист
 *     вырастает вчетверо;
 *   • свет по сторонам света есть (faceFactors + дорожка граней в листе), но это
 *     перекраска палитры, а не пересъёмка: длинной тени от пропа на проп здесь
 *     нет, как нет и self-shadowing — для этого пришлось бы печь кадр на каждый
 *     час суток, и лист перестал бы быть листом;
 *   • `hits` (проп оббит наполовину) — геометрии для «подрезанного» дерева в
 *     паке нет, остаёмся на процедурной отрисовке для побитых пропов.
 */
import { PROP_SPRITES, PROP_META } from "./propsprites.js";

const PPU = PROP_META.pxPerUnit || 1;

/** Погодные/сезонные тона: один кадр на kind×тон, больше перерисовок не будет. */
const TONES = ["plain", "autumn", "winter", "wet", "snowwet"];
const WET = {
    wet: [26, 40, 58],          // дождь: тёмно-синий, как у героя
    snow: [206, 226, 244],
    rainA: 0.34,
    snowA: 0.30,
    snowCap: 0.55               // шапка снега на верхних пикселях колонок
};
/** Эти пропы «дышат» на ветру — те же лиственные, что качает tilesart. */
const SWAY = new Set(["pine", "spruce", "dead_tree", "ancient_oak", "bush", "hut_roof"]);
/** Флаги отладки; `enabled` выключается сам, если канвасов в среде нет. */
export const PROPS3D = {
    enabled: true,
    reason: null,
    // Принудительный тон кадра для сравнения стилей: ?props3dTone=winter.
    tone: null,
    stats: { sprites: 0, drawn: 0, skipped: 0, lit: 0 }
};

/**
 * Свет. Запечённый кадр несёт в себе один раз выбранный источник света, и на
 * этом его возможности кончаются — но у каждого пикселя есть код грани, куда
 * она смотрит (1..6 = восток, запад, верх, низ, тыл, перед; см. faceStats в
 * tools/prop-bake.js). Этого хватает, чтобы проп честно реагировал на время
 * суток и погоду: перекраска палитры по коду грани, без новых тонов и без
 * дизеринга.
 */
const FACE_N = [
    [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
];

/** Свет по умолчанию = тот, что уже запечён: поправок нет (amp=0 → все 1). */
export function defaultSun() { return { dir: 0.55, elev: 0.72, amp: 0, amb: 1, rough: 0 }; }

/**
 * Коэффициент яркости для каждой грани при данном солнце. Чистая функция: её
 * можно гонять в node, где канваса нет, — и тестовый файл гоняет именно её.
 * `x,y` нужны только для шероховатости (рассеянный свет бури кладёт на пиксель
 * стабильный шум, а не случайный, иначе проп кипит).
 */
export function faceFactors(sun, x = 0, y = 0, out = [1, 1, 1, 1, 1, 1, 1]) {
    const amp = Math.max(0, Math.min(1, sun.amp || 0));
    if (amp <= 0 && !sun.rough && sun.amb === 1) {
        for (let b = 1; b <= 6; b += 1) out[b] = sun.amb;
        return out;
    }
    const az = Math.max(-1, Math.min(1, sun.dir)) * Math.PI / 2;
    const el = Math.max(0, Math.min(1, sun.elev)) * Math.PI / 2;
    const sx = Math.sin(az) * Math.cos(el), sy = Math.sin(el), sz = Math.cos(az) * Math.cos(el);
    // Буря и дождь: свет рассеянный, тени нет, но мокрая кора бликует пятнами.
    const jitter = sun.rough ? (hash2(x, y, 91) - 0.5) * sun.rough * 0.5 : 0;
    // Свет перераспределяется, а не добавляется: 0.42 — уровень, при котором
    // коэффициент равен 1. Без этой привязки полдень «съедал» половину яркости
    // всего кадра (боковые грани при вертикальном солнце не освещены вовсе), и
    // ночной лес оказывался светлее дневного.
    for (let b = 1; b <= 6; b += 1) {
        const n = FACE_N[b];
        const ndl = Math.max(0, n[0] * sx + n[1] * sy + n[2] * sz);
        const raw = Math.max(0.34, Math.min(1.9, 1 + amp * (ndl - 0.42) * 1.15));
        out[b] = Math.max(0.12, sun.amb * raw * (1 + jitter));
    }
    return out;
}

/** Квант солнца: слишком мелкое изменение не стоит пересборки кадра. */
function sunKey(sun) {
    const q = (v, k) => Math.round((v || 0) * k);
    return `${q(sun.dir, 8)}:${q(sun.elev, 8)}:${q(sun.amp, 8)}:${q(sun.amb, 16)}:${q(sun.rough, 4)}`;
}

let SUN = defaultSun();
let SUN_KEY = sunKey(SUN);

/**
 * Играть светом: игра вызывает это из applySky, когда солнце встало/село или
 * погода сменилась. true — свет изменился достаточно, чтобы кадры перепеклись.
 */
export function setPropSun(next) {
    const sun = { ...SUN, ...next };
    const key = sunKey(sun);
    if (key === SUN_KEY) return false;
    SUN = sun; SUN_KEY = key;
    CACHE.clear();               // иначе на экране останутся кадры прошлого света
    PROPS3D.stats.lit = 0;
    return true;
}
export function propSun() { return SUN; }

/**
 * Ручной тон для сравнения стилей: ?props3dTone=winter или пункт меню «Вид
 * мира». Разбором адресной строки владеет ui/styleflags.js — единый источник
 * «что включено» для игры, меню и штампа сборки; здесь только приёмник.
 */
export function setPropTone(tone) {
    if (PROPS3D.tone === (tone || null)) return false;
    PROPS3D.tone = tone || null;
    return true;
}

const CACHE = new Map();

/** RLE-пары (длина, индекс) → плоский массив индексов палитры. */
function decodeStream(entry) {
    const total = entry.w * entry.h;
    const raw = typeof entry.stream === "string" ? base64Bytes(entry.stream) : entry.stream;
    const index = new Uint8Array(total);
    let p = 0;
    for (let i = 0; i + 1 < raw.length && p < total; i += 2) {
        const run = raw[i], value = raw[i + 1];
        const end = Math.min(total, p + run);
        if (value) index.fill(value, p, end);
        p = end;
    }
    return index;
}

function base64Bytes(text) {
    if (typeof atob === "function") {
        const bin = atob(text);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
        return out;
    }
    return new Uint8Array(Buffer.from(text, "base64"));   // node (тесты/smoke)
}

const hex2rgb = (hex) => [
    parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)
];

/**
 * Тон кадра. Осенняя листва и зимнее тепло — перекраска палитры, а не фильтра:
 * шаг маленький, и важно, чтобы силуэт не начал «дыряветь» от смешивания.
 */
function tintPal(pal, tone) {
    const out = pal.map(hex2rgb);
    const mix = (c, target, k) => [
        c[0] + (target[0] - c[0]) * k, c[1] + (target[1] - c[1]) * k, c[2] + (target[2] - c[2]) * k
    ];
    if (tone === "autumn") return out.map(c => mix(c, [168, 112, 54], 0.30));
    if (tone === "winter") return out.map(c => mix(c, [196, 210, 224], 0.24));
    if (tone === "wet") return out.map(c => mix(c, WET.wet, WET.rainA * 0.5));
    if (tone === "snowwet") return out.map(c => mix(mix(c, WET.wet, WET.rainA * 0.34), WET.snow, WET.snowA));
    return out;
}

/** Второй поток того же RLE — коды граней. null, если лист ещё старый. */
function decodeFaces(entry) {
    if (!entry.faces) return null;
    const total = entry.w * entry.h;
    const raw = typeof entry.faces === "string" ? base64Bytes(entry.faces) : entry.faces;
    const face = new Uint8Array(total);
    let p = 0;
    for (let i = 0; i + 1 < raw.length && p < total; i += 2) {
        const run = raw[i], value = raw[i + 1];
        const end = Math.min(total, p + run);
        face.fill(value, p, end);
        p = end;
    }
    return p >= total || p > 0 ? face : null;
}

function makeCanvas(w, h) {
    if (typeof document !== "undefined" && document.createElement) {
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        return cv;
    }
    return null;
}

/** Тон кадра из погоды/сезона; PROPS3D.tone перекрывает всё (?props3dTone). */
function resolveTone(opts = {}) {
    if (PROPS3D.tone) return PROPS3D.tone;
    const season = opts.season || "spring";
    const wet = opts.weather === "rain" || opts.weather === "storm" || (opts.groundWet || 0) > 0.4;
    const snowy = season === "winter" || opts.weather === "snow";
    return snowy ? (wet ? "snowwet" : "winter")
        : (season === "autumn" ? "autumn" : (wet ? "wet" : "plain"));
}

/** Кадр kind×тон: decode → RGBA → офскрин-канвас. null, если среды для канваса нет. */
function spriteFor(kind, tone) {
    const key = `${kind}|${tone}|${SUN_KEY}`;
    if (CACHE.has(key)) return CACHE.get(key);
    const entry = PROP_SPRITES[kind];
    if (!entry) return null;
    const cv = makeCanvas(entry.w, entry.h);
    if (!cv || !cv.getContext) { PROPS3D.enabled = false; PROPS3D.reason = "нет document.createElement('canvas')"; return null; }
    const ctx = cv.getContext("2d");
    const pal = tintPal(entry.palette, tone);
    const index = decodeStream(entry);
    // Свет по коду грани: при запечённом солнце (amp=0) поправок нет и кадр
    // идёт ровно так, как запечён. Шероховатость добавляется уже по пикселям —
    // иначе два соседних пикселя кроны светятся одинаково и «буря» не видна.
    const sun0 = defaultSun();
    const shade = SUN.amp > 0 || SUN.amb !== 1 || SUN.rough > 0
        ? (SUN.amp === 0 && SUN.rough === 0 ? null : faceFactors({ ...SUN, rough: 0 }))
        : null;
    const face = shade ? decodeFaces(entry) : (sun0 && null);
    const img = ctx.createImageData ? ctx.createImageData(entry.w, entry.h) : { data: new Uint8ClampedArray(entry.w * entry.h * 4), width: entry.w, height: entry.h };
    for (let i = 0; i < index.length; i += 1) {
        const v = index[i];
        if (!v) continue;
        const c = pal[v - 1] || [255, 0, 255];
        const o = i * 4;
        let k = 1;
        if (shade && face) {
            const b = face[i];
            if (b) {
                k = shade[b];
                if (SUN.rough) k *= 1 + (hash2(i % entry.w, (i / entry.w) | 0, 91) - 0.5) * SUN.rough * 0.5;
            }
        }
        img.data[o] = c[0] * k; img.data[o + 1] = c[1] * k; img.data[o + 2] = c[2] * k; img.data[o + 3] = 255;
    }
    if (shade && face) PROPS3D.stats.lit += 1;
    // Снег лежит сверху: в каждой колонке первые сплошные пиксели получают шапку.
    if (tone === "winter" || tone === "snowwet") {
        for (let x = 0; x < entry.w; x += 1) {
            let seen = 0;
            for (let y = 0; y < entry.h && seen < 2; y += 1) {
                const i = y * entry.w + x;
                if (!index[i]) continue;
                const o = i * 4;
                const k = WET.snowCap * (seen === 0 ? 1 : 0.45);
                img.data[o] += (WET.snow[0] - img.data[o]) * k;
                img.data[o + 1] += (WET.snow[1] - img.data[o + 1]) * k;
                img.data[o + 2] += (WET.snow[2] - img.data[o + 2]) * k;
                seen += 1;
            }
        }
    }
    ctx.putImageData(img, 0, 0);
    const sprite = { canvas: cv, w: entry.w, h: entry.h, height: entry.height || entry.h / PPU };
    CACHE.set(key, sprite);
    PROPS3D.stats.sprites = CACHE.size;
    return sprite;
}

/** Детерминированный шум по тайлу: без него все сосны в стае одинаковые. */
function hash2(x, y, salt = 0) {
    let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
    h = (h ^ (h >> 13)) * 1274126177 | 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

/**
 * Нарисовать проп запечённым кадром. true — нарисовали, false — рисуйте
 * процедурно (нет кадра, побитый проп, канвасов в среде нет).
 */
export function paintProp3D(ctx, obj, opts = {}) {
    if (!PROPS3D.enabled) return false;
    const kind = obj.kind;
    if (!PROP_SPRITES[kind]) return false;
    if (obj.hits) { PROPS3D.stats.skipped += 1; return false; }
    const season = opts.season || "spring";
    const tone = resolveTone(opts);
    const sprite = spriteFor(kind, tone) || spriteFor(kind, "plain");
    if (!sprite) return false;

    const size = obj.size || 1;
    const grow = 0.9 + hash2(obj.tx || 0, obj.ty || 0, 7) * 0.22;
    const sc = (SWAY.has(kind) ? grow : 1) * size;
    ctx.save();
    if (sc !== 1) ctx.scale(sc, sc);
    // Зеркало через тайл: иначе два одинаковых кадра рядом читаются как копипаста
    // (у процедурной отрисовки был свой flip — держим тот же приём).
    if (hash2(obj.tx || 0, obj.ty || 0, 43) > 0.5) ctx.scale(-1, 1);
    // Ветер: качаем только крону, и у каждого дерева своя фаза — ровно так же,
    // как это делает tilesart, чтобы обе ветки не разъезжались по фазам.
    if (SWAY.has(kind)) {
        const t = opts.time || 0;
        const lean = Math.sin(t * 0.8 + (obj.tx || 0) * 0.7 + (obj.ty || 0) * 0.37) * 0.02
                   + (opts.wind || 0) * 0.05;
        ctx.transform(1, 0, lean, 1, lean * sprite.h * 0.25, 0);
    }
    // Контактная тень: без неё проп «летает». Долгой тени от солнца в этом
    // кадре нет — свет модели уже запечён, так что остаётся только пятно под
    // основанием.
    // lift: деталь, которая стоит не на земле, а на другой детали (крыша на
    // стене). Мир передаёт число в пикселях — см. placeStoryProps в worldgen.
    const lift = obj.lift || 0;
    const w = sprite.w, h = sprite.h;
    // Контактная тень — только у того, что стоит на земле. Пятно под деталью,
    // стоящей на другой детали, и есть тот самый «летающий объект»: разрыв между
    // спрайтом и тенью читается как воздух, каким бы аккуратным ни был lift.
    if (!lift) {
        ctx.fillStyle = "rgba(14,12,10,0.22)";
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.34, w * 0.13, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.drawImage(sprite.canvas, Math.round(-w / 2), Math.round(-h - lift));
    ctx.restore();
    PROPS3D.stats.drawn += 1;
    return true;
}

/**
 * Свет пропов из игрового состояния. Направление берётся у того же SUN, что
 * читает процедурная отрисовка (tilesart.setSun кладёт тень «от солнца», а нам
 * нужен сам источник — это тот же вектор с обратным знаком), поэтому кривые и
 * запечённые кадры никогда не разойдутся по сторонам света. Высота солнца
 * восстанавливается из dy: setSun считает её как 0.30 + (1−elev)·0.36.
 */
export function propSunFor(state = {}, sun = { dx: 0.55, dy: 0.42, alpha: 1 }) {
    const elev = Math.max(0, Math.min(1, 1 - (sun.dy - 0.30) / 0.36));
    const day = Math.max(0, Math.min(1, sun.alpha === undefined ? 1 : sun.alpha));
    const weather = state.weather || "clear";
    // Пасмурно и дождь: свет рассеянный — контраст граней падает, зато мокрая
    // кора ловит блики (rough). Гроза — максимум рассеивания и максимум блеска.
    const diffuse = { clear: 1, wind: 0.86, cloudy: 0.7, rain: 0.5, storm: 0.34, fog: 0.28, snow: 0.55 }[weather];
    const amp = (0.34 + 0.66 * elev) * (diffuse === undefined ? 0.8 : diffuse) * (0.35 + 0.65 * day);
    const wet = weather === "rain" || weather === "storm" || (state.groundWet || 0) > 0.4;
    return {
        dir: Math.max(-1, Math.min(1, -sun.dx)),
        elev,
        amp,
        amb: 0.62 + 0.38 * day,
        rough: (wet ? 0.34 : 0) + (weather === "storm" ? 0.3 : 0) + (weather === "snow" ? 0.12 : 0)
    };
}

/**
 * Падающий обломок (world/debris.js): тот же запечённый кадр, но с подъёмом над
 * землёй, поворотом и затуханием в момент «лёг». Рисуется в том же translate,
 * что и пропы: x,y уже приведены к ноге объекта, z — пиксели над ней.
 */
export function paintDebris3D(ctx, body, opts = {}) {
    if (!PROPS3D.enabled) return false;
    const kind = PROP_SPRITES[body.kind] ? body.kind : "log";
    if (!PROP_SPRITES[kind]) return false;
    const tone = resolveTone(opts);
    const sprite = spriteFor(kind, tone) || spriteFor(kind, "plain");
    if (!sprite) return false;
    const scale = (body.scale || 1) * (body.size || 1);
    const settle = body.settling > 0 ? Math.max(0, body.settling / (opts.settle || 0.18)) : 1;
    const w = sprite.w, h = sprite.h;
    const lift = Math.max(0, body.z || 0);
    // 1 на земле → ~0.18 на высоте 500 px: пятно тает вместе с подлётом.
    const ground = 1 / (1 + lift / 110);
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.3 + ground * 0.7);
    ctx.fillStyle = `rgba(14,12,10,${(0.22 * ground).toFixed(3)})`;
    ctx.beginPath();
    // Пятно уменьшается вместе с высотой: это единственное, что отличает в кадре
    // «кусок летит» от «кусок висит» — раньше тень рисовалась уже после
    // translate(0, -z) и уезжала вверх вместе с телом, поэтому осколок на
    // подъёме выглядел приклеенным к воздуху (претензия «обломки висят»).
    const spread = 0.55 + 0.45 * ground;
    ctx.ellipse(0, 0, w * 0.34 * scale * spread, w * 0.13 * scale * spread, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(0, -Math.round(lift));
    ctx.globalAlpha = Math.min(1, 0.25 + settle * 0.75) * (body.sinking > 0 ? 0.55 : 1);
    if (body.ang) ctx.rotate(body.ang);
    // Тело в полёте чуть разворачивается по вертикали: иначе квадратный кадр
    // выглядит наклейкой, а не куском дерева.
    ctx.scale(scale, scale * (1 - Math.abs(Math.sin(body.ang || 0)) * 0.08));
    ctx.drawImage(sprite.canvas, Math.round(-w / 2), Math.round(-h / 2) + Math.round(h * 0.18));
    ctx.restore();
    PROPS3D.stats.drawn += 1;
    return true;
}

/**
 * Пиксели кадра так, как они лягут на экран: для dev-панели и для тестов,
 * которым важно, что свет меняет растр, а не только числа в конфиге.
 * null — если канвасов в среде нет (node без shim-документа).
 */
export function propSpritePixels(kind, tone = resolveTone({})) {
    const sprite = spriteFor(kind, tone);
    if (!sprite) return null;
    const ctx = sprite.canvas.getContext("2d");
    if (!ctx || !ctx.getImageData) return null;
    const img = ctx.getImageData(0, 0, sprite.w, sprite.h);
    return { w: sprite.w, h: sprite.h, tone, data: img.data };
}

/** Сколько пропов вообще умеют в 3D — для dev-панели и тестов. */
export function prop3dKinds() { return Object.keys(PROP_SPRITES); }
export function prop3dHas(kind) { return !!PROP_SPRITES[kind]; }
/** Причина отказа, если включённый режим ничего не нарисовал. */
export function prop3dStatus() {
    return {
        enabled: PROPS3D.enabled && typeof document !== "undefined" && !!document.createElement,
        reason: PROPS3D.reason,
        kinds: prop3dKinds().length,
        tone: PROPS3D.tone,
        sun: { ...SUN },
        sunKey: SUN_KEY,
        sprites: CACHE.size,
        pxPerUnit: PPU
    };
}
