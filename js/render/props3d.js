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
 *   • следы солнца по сторонам света — свет «на камеру» зашит в запекку;
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
const SWAY = new Set(["pine", "spruce", "tree_pine", "dead_tree", "ancient_oak", "bush", "hut_roof"]);
/** Флаги отладки; `enabled` выключается сам, если канвасов в среде нет. */
export const PROPS3D = {
    enabled: true,
    reason: null,
    stats: { sprites: 0, drawn: 0, skipped: 0 }
};

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

function makeCanvas(w, h) {
    if (typeof document !== "undefined" && document.createElement) {
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        return cv;
    }
    return null;
}

/** Кадр kind×тон: decode → RGBA → офскрин-канвас. null, если среды для канваса нет. */
function spriteFor(kind, tone) {
    const key = `${kind}|${tone}`;
    if (CACHE.has(key)) return CACHE.get(key);
    const entry = PROP_SPRITES[kind];
    if (!entry) return null;
    const cv = makeCanvas(entry.w, entry.h);
    if (!cv || !cv.getContext) { PROPS3D.enabled = false; PROPS3D.reason = "нет document.createElement('canvas')"; return null; }
    const ctx = cv.getContext("2d");
    const pal = tintPal(entry.palette, tone);
    const index = decodeStream(entry);
    const img = ctx.createImageData ? ctx.createImageData(entry.w, entry.h) : { data: new Uint8ClampedArray(entry.w * entry.h * 4), width: entry.w, height: entry.h };
    for (let i = 0; i < index.length; i += 1) {
        const v = index[i];
        if (!v) continue;
        const c = pal[v - 1] || [255, 0, 255];
        const o = i * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
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
    const wet = opts.weather === "rain" || opts.weather === "storm" || (opts.groundWet || 0) > 0.4;
    const snowy = season === "winter" || opts.weather === "snow";
    const tone = snowy ? (wet ? "snowwet" : "winter") : (season === "autumn" ? "autumn" : (wet ? "wet" : "plain"));
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
    ctx.fillStyle = lift ? "rgba(14,12,10,0.12)" : "rgba(14,12,10,0.22)";
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.34, w * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(sprite.canvas, Math.round(-w / 2), Math.round(-h - lift));
    ctx.restore();
    PROPS3D.stats.drawn += 1;
    return true;
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
        sprites: CACHE.size,
        pxPerUnit: PPU
    };
}
