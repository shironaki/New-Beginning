/**
 * render/hero3d.js — герой из запечённых кадров 3D-рига.
 *
 * Игра не умеет гонять three.js и WebGL-контекст у инструментов его тоже нет, поэтому
 * форма героя приходит сюда уже запечённой: `node tools/hero-bake.js --emit` снимает
 * позы с настоящего скелета Quaternius (65 костей, CC0), считает скиннинг и свет и
 * складывает результат в js/render/heroframes.js — палитра + RLE-индексы на кадр.
 * Здесь остаётся самое дешёвое: выбрать позу, собрать кадры в offscreen-canvas и
 * поставить его туда же, куда раньше ложилась векторная отрисовка.
 *
 * Что специально НЕ меняется:
 *   • точка отсчёта — линия стоп, вверх — отрицательный Y (контракт charspec.js);
 *   • тень от солнца, ватерлиния и наклон по диагонали рисует character.js, поэтому
 *     герой в спрайте стоит на земле и тонет в воде так же, как векторный;
 *   • предмет в руке — та же графика, что у поселенцев, но хват берётся из запечённой
 *     позиции кости кисти, поэтому факел не висит рядом с предплечьем.
 *
 * Поселенцы и путники векторные: спрайты — только про героя, у них нет ни инвентаря,
 * ни отражения, ни права на 400 KB ассета на брата.
 */
import { STREAMS as GRADED_STREAMS, META as GRADED_META, PALETTE_HEX as GRADED_PALETTE } from "./heroframes.js";
import { RAMPS, shadeHex, spriteToolAngle, toolOutward } from "./charspec.js";

const TAU = Math.PI * 2;

/**
 * Два выхода одной и той же запекки:
 *   • «grade»  — js/render/heroframes.js: пиксельный грейд (дизеринг + обводка), то, что играет;
 *   • «smooth» — js/render/herosmooth.js: тот же риг, тот же свет, та же сетка, но 14 тонов
 *     на дорожку, без дизеринга и без обводки.
 * Смысл раздвоения ровно один: сравнивать надо посадку одежды и силуэт, а не спорить
 * о стиле вслепую. Ячейка, опора и якоря кистей у обоих выходов общие (их считает один
 * прогон tools/hero-bake.js), поэтому переключение не сдвигает ни предмет в руке, ни
 * тень, ни ватерлинию. Гладкий модуль весит ~300 КБ и грузится по требованию.
 */
const SOURCES = {
    grade: { name: "grade", streams: GRADED_STREAMS, meta: GRADED_META, paletteHex: GRADED_PALETTE, poses: new Map(), paletteKey: null },
    smooth: null
};

const toRgb = (hex) => {
    const c = String(hex).replace("#", "");
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
};

/** Всё, что источник выводит из своей META, считается один раз и живёт в нём же. */
function bindSource(src) {
    src.U = 1 / (src.meta.pxPerUnit || 2);            // пиксель спрайта → единицы мира
    src.CELL = src.meta.cell;
    src.TOP = -(src.meta.cell.h - src.meta.footPad) * src.U;
    src.W = src.meta.cell.w * src.U;
    src.H = src.meta.cell.h * src.U;
    src.base = src.paletteHex.map(toRgb);
    src.paletteRgb = src.base;
    src.has = label => src.meta.poses.some(x => x.label === label);
    src.framesOf = label => src.meta.poses.find(x => x.label === label)?.frames || 6;
    return src;
}
let SRC = bindSource(SOURCES.grade);
/** Позы, которых у гладкого выхода нет: не пропускать кадр, а честно упростить. */
const SMOOTH_ALIAS = { run: "walk", attack: "chop", gather: "chop", torch: "idle" };

/**
 * Живой 3D (three.js) — опциональный слой НАД листом: `hero3dLive(true)` поднимает
 * WebGL-сцену, и `heroSprite` отдаёт кадр из неё. Лист остаётся источником
 * геометрии контракта (CELL/footPad/якоря) и запасным кадром: если WebGL или
 * three.js недоступны, герой рисуется листом, а причина видна в HERO3D.error —
 * ровно поэтому переход на 3D не может превратиться в чёрный спрайт.
 */
let LIVE_MOD = null;
export async function hero3dLive(on) {
    if (!on) {
        HERO3D.live = false;
        HERO3D.quality = SRC === SOURCES.smooth ? "smooth" : "grade";
        return false;
    }
    if (!LIVE_MOD) {
        try { LIVE_MOD = await import("./hero3d-live.js"); }
        catch (err) {
            HERO3D.error = `живой рендер не подключился: ${String(err && err.message || err).slice(0, 160)}`;
            HERO3D.live = false;
            return false;
        }
    }
    const ok = await LIVE_MOD.initLive();
    HERO3D.live = ok;
    if (ok) {
        HERO3D.quality = "live";
        HERO3D.error = "";
        LIVE_MOD.liveSun(HERO3D.tone || null);
    } else {
        HERO3D.error = LIVE_MOD.LIVE.error || "живой рендер недоступен";
        HERO3D.quality = SRC === SOURCES.smooth ? "smooth" : "grade";
    }
    return ok;
}
/** Тон света живого героя — общий с 3D-пропами (см. props3d.resolveTone). */
export function hero3dTone(tone) {
    HERO3D.tone = tone || null;
    if (HERO3D.live && LIVE_MOD) LIVE_MOD.liveSun(tone || null);
}
/** Что играет в живом слое — для штампа и панели отладки. */
export const hero3dLiveInfo = () => (LIVE_MOD ? LIVE_MOD.liveInfo() : null);

/** Готово ли включать спрайтовый режим. `false` у actor (`p.sprite === false`) выключает его точечно. */
export const HERO3D = {
    enabled: true,
    quality: "grade",
    // Какой лист по полу/причёске играет и почему чужой лист не приехал. Без
    // этой строки «выбрал женщину, а он всё ещё он» невозможно разобрать.
    sheet: "male/long",
    sheetError: "",
    // Причина, по которой запрошенный режим не включился. Нужна потому, что
    // «?hero3d=smooth → пусто» без этой строки невозможно разобрать: молчаливый
    // откат выглядел как сломанная игра, а не как отсутствующий модуль.
    error: "",
    // Играет ли живой 3D-слой (three.js). `quality === "live"` без этого флага
    // значит «режим запрошен, но сцена не поднялась» — и рисуется лист.
    live: false,
    tone: null,
    get ready() { return typeof document !== "undefined" && Object.keys(SRC.streams).length > 0; }
};

/**
 * Сменить выход. Возвращает true, если источник доступен; при отсутствии
 * herosmooth.js (его ещё не пропекли) тихо остаётся грейд — игра не должна
 * падать из-за режима сравнения.
 */
export async function hero3dQuality(quality) {
    if (quality === "live") return hero3dLive(true);
    if (quality === "grade") {
        await hero3dLive(false);
        SRC = SOURCES.grade; HERO3D.quality = "grade"; return true;
    }
    if (quality !== "smooth") return false;
    if (!SOURCES.smooth) {
        try {
            const mod = await import("./herosmooth.js");
            SOURCES.smooth = bindSource({ name: "smooth", streams: mod.STREAMS, meta: mod.META, paletteHex: mod.PALETTE_HEX, poses: new Map(), paletteKey: null });
        } catch (err) {
            HERO3D.error = String((err && err.message) || err).slice(0, 200);
            return false;
        }
    }
    SRC = SOURCES.smooth;
    HERO3D.quality = "smooth";
    return true;
}
/** Поза ищется в активном источнике; чего в нём нет — упрощается, а не роняет спрайт. */
const labelFor = (src, want) => (src.has(want) ? want : (src === SOURCES.smooth && SMOOTH_ALIAS[want]) || want);

/* ------------------------------- декодирование ------------------------------ */

/**
 * Палитра. Грейд-модуль приносит 76 цветов: общие (те, что в лаборатории стиля), обводку
 * и четыре цветовые дорожки — куртка, штаны, кожа, волосы. Дорожки в игре ПЕРЕСОБИРАЮТСЯ из
 * `look`: кадр помнит не цвет, а slot дорожки, поэтому сменить цвет куртки — это
 * заменить пять записей палитры, а не перепекать 188 кадров. У гладкого выхода дорожек
 * нет: там цвет запечён сплошным веером из 14 тонов, и перекраска осознанно не работает.
 */
/**
 * Группы записей палитры, которые в листе ЗАПЕЧЁНЫ своим цветом, а должны идти
 * за образом: рубашка, шарф, плащ, сумка, металл и кожа ремней. Без этого у
 * героя на спине оставалась кремовая «рубашка» из палитры листа (#e6dcbc), какой
 * бы цвет ни выбрал игрок, — ровно претензия «на спине белая палитра в одежде».
 * Дорожек (ramps) для них в запекке нет, зато имена записей есть, поэтому
 * перекраска идёт по имени: оттенок каждой записи сохраняется (он и делает
 * ткань объёмной), меняется только тон группы.
 */
const COLOR_GROUPS = [
    { look: "shirt", names: ["shirt", "shirtLight", "shirtShade", "shirtDeep", "scarf", "scarfLight", "scarfShadow", "scarfDeep"] },
    { look: "cloak", names: ["cloak", "cloakLight", "pack", "packDark", "packLight", "blanket", "blanketDark"], skipWhenUnset: true },
    { look: "accent", names: ["metal", "metalLight", "metalShade", "brass", "brassLight", "laces"] }
];
const lumOf = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
/** Индексы именованных записей палитры листа (значение кадра = индекс + 1). */
function indexOfNames(meta) {
    if (meta._nameIndex) return meta._nameIndex;
    const map = new Map();
    (meta.palette || []).forEach(([name, hex], i) => map.set(name, i));
    meta._nameIndex = map;
    return map;
}
/**
 * Перекрасить группу в новый тон, сохранив относительную светлоту каждой
 * записи: ratio = lum(запись)/lum(база группы). Так «светлый блик» остаётся
 * бликом, а «тёмная складка» — складкой, и ткань не превращается в flat-пятно.
 */
function recolorGroup(out, src, indices, baseHex) {
    const base = toRgb(baseHex);
    const baseLum = Math.max(8, lumOf(src.base[indices[0]]));
    for (const i of indices) {
        if (i === undefined || i >= out.length) continue;
        const ratio = Math.max(0.25, Math.min(1.9, lumOf(src.base[i]) / baseLum));
        for (let c = 0; c < 3; c += 1) out[i][c] = Math.max(0, Math.min(255, Math.round(base[c] * ratio)));
    }
}

function paletteFor(look, src = SRC) {
    const ramps = src.meta.ramps;
    if (!ramps) return src.base;
    const names = Object.keys(ramps);
    const key = names.map(name => String((look && look[RAMPS[name] && RAMPS[name].look]) || "")).join("|");
    const groupKey = COLOR_GROUPS.map(g => `${g.look}=${(look && look[g.look]) || ""}|`).join("")
        + `#${(look && look.hairStyle) || ""}`;
    // Ключ ОДИН и полный: раньше верхняя проверка сравнивала короткой ключ
    // дорожек с полным (его пишет низ функции) и никогда не совпадала, поэтому
    // палитра пересобиралась на каждый кадр.
    const fullKey = `${key}#${groupKey}`;
    if (fullKey === src.paletteKey) return src.paletteRgb;
    const out = src.base.map(rgb => rgb.slice());
    for (const name of names) {
        const meta = ramps[name];
        const spec = RAMPS[name];
        if (!spec) continue;
        const base = (look && look[spec.look]) || src.paletteHex[meta.at];
        const steps = Math.min(meta.steps, spec.offsets.length);
        for (let i = 0; i < steps; i += 1) out[meta.at + i] = toRgb(shadeHex(base, spec.offsets[i]));
    }
    // Группы по именам (см. COLOR_GROUPS). Ключ пересборки обязан учитывать и
    // эти поля: иначе смена рубашки не меняет палитру, потому что key собран
    // только по дорожкам.
    const indices = indexOfNames(src.meta);
    for (const group of COLOR_GROUPS) {
        const want = look && look[group.look];
        if (!want) {
            if (group.skipWhenUnset) continue;               // плаща нет — пусть останутся запечённые цвета
        }
        const list = group.names.map(n => indices.get(n)).filter(i => i !== undefined);
        if (list.length) recolorGroup(out, src, list, want || src.paletteHex[list[0]]);
    }
    // «Бритые» не требуют своего листа: дорожка волос становится дорожкой кожи
    // чуть темнее лица, и пучок/коса перестают висеть на лысой голове. До этого
    // выбор «Бритые» в редакторе не значил ровно ничего.
    if (look && (look.hairStyle === "bald" || look.hairStyle === "buzz") && ramps.hair && ramps.skin) {
        const hair = ramps.hair, skin = ramps.skin;
        for (let i = 0; i < hair.steps; i += 1) {
            const from = out[skin.at + Math.min(skin.steps - 1,
                Math.round((i * (skin.steps - 1)) / Math.max(1, hair.steps - 1)))];
            const shaved = [Math.round(from[0] * 0.9), Math.round(from[1] * 0.9), Math.round(from[2] * 0.92)];
            out[hair.at + i] = shaved;
        }
        const near = [0, 1, 1, 2].map(i => out[hair.at + Math.min(i, hair.steps - 1)]);
        ["hair", "hairMid", "hairLight", "hairHighlight"].forEach((n, i) => {
            const at = indices.get(n);
            if (at !== undefined) out[at] = near[i].slice();
        });
    }
    src.paletteKey = fullKey;
    src.paletteRgb = out;
    for (const pose of src.poses.values()) pose.canvases.fill(null);   // канвасы собраны по старой палитре
    return out;
}

/* ---------------------------- лист под пол и причёску ---------------------------- */

/**
 * Пол и причёска — это ФОРМА, а не цвет: `paletteFor` перекрашивает записи, а
 * силуэт берёт из листа, поэтому выбор «Женщина» в редакторе не менял ничего
 * (претензия п.7: «нет реакции на смену пола. На прическу»). Честный ответ —
 * отдельные запечённые листы «кто + какая стрижка» и выбор по образу.
 *
 * Лист весит ~600 КБ, поэтому чужой лист НЕ тянется в старте: он грузится
 * по требованию, и пока не приехал — играет дефолтный. Следующий же кадр
 * собирается из своего источника, поэтому ни игра, ни превью не ждут и не
 * падают, если файла нет (его может и не быть — например, лист «коса» пекарится
 * только вместе с `--hair Hair_Buns`).
 */
const SHEET_FILES = {
    "male/long": null,                                    // heroframes.js — он уже в графе
    "male/short": "./heroframes-male-short.js",
    "male/braid": "./heroframes-male-braid.js",
    "female/long": "./heroframes-female.js",
    "female/short": "./heroframes-female-short.js",
    "female/braid": "./heroframes-female-braid.js"
};
/** Причёска образа → стрижка листа. «Бритые» — короткая стрижка с кожей вместо
 *  волос (см. bald-блок в paletteFor), своего листа не просит. */
const HAIR_CUT = { short: "short", buzz: "short", long: "long", braid: "braid", ponytail: "braid", bun: "braid", bald: "short" };
const SHEET_SOURCES = new Map();
const SHEET_PENDING = new Map();
const SHEET_ERROR = {};

export function hero3dSheetId(look) {
    // Режим сравнения (smooth) играет одним листом: гладкого выхода для каждой
    // причёски нет, и заставлять его молча грузить 600 КБ ради теста стиля —
    // значит нагружать то, что и так спорное.
    if (HERO3D.quality !== "grade") return "male/long";
    const who = look && look.gender === "female" ? "female" : "male";
    const cut = HAIR_CUT[(look && look.hairStyle) || "short"] || "long";
    const id = `${who}/${cut}`;
    return id in SHEET_FILES ? id : "male/long";
}

/** Загрузить лист, который просит образ. true — лист в кэше, false — нет файла. */
export function hero3dSheet(look) {
    const id = hero3dSheetId(look);
    if (id === "male/long") return Promise.resolve(true);
    if (SHEET_SOURCES.has(id)) return Promise.resolve(true);
    if (SHEET_PENDING.has(id)) return SHEET_PENDING.get(id);
    const file = SHEET_FILES[id];
    const job = !file
        ? Promise.resolve(false)
        : import(/* @vite-ignore */ file).then((mod) => {
            if (!mod || !mod.STREAMS || !mod.META) throw new Error("в листе нет STREAMS/META");
            // Ячейка, опора и масштаб у всех листов общие (одна сетка запекки) —
            // иначе посадка предмета и ватерлиния поедут на другом поле.
            const g = SOURCES.grade.meta, m = mod.META;
            if (m.cell.w !== g.cell.w || m.cell.h !== g.cell.h || m.footPad !== g.footPad) {
                throw new Error(`сетка листа ${id} не совпадает с игрой: ${m.cell.w}×${m.cell.h}/${m.footPad}`);
            }
            SHEET_SOURCES.set(id, bindSource({
                name: id, streams: mod.STREAMS, meta: m, paletteHex: mod.PALETTE_HEX,
                poses: new Map(), paletteKey: null
            }));
            HERO3D.sheet = id;
            return true;
        }).catch((err) => {
            SHEET_ERROR[id] = String((err && err.message) || err).slice(0, 180);
            HERO3D.sheetError = SHEET_ERROR[id];
            return false;
        }).finally(() => SHEET_PENDING.delete(id));
    SHEET_PENDING.set(id, job);
    return job;
}

/** Готов ли лист, который просит образ (true — можно рисовать без догрузки). */
export const hero3dSheetReady = (id) => id === "male/long" || SHEET_SOURCES.has(id);

/** Что играет прямо сейчас — для штампа сборки и панели отладки. */
export const hero3dSheetInfo = () => ({
    id: HERO3D.sheet, loaded: SHEET_SOURCES.size + 1, errors: { ...SHEET_ERROR }
});

/** Источник кадра для образа: свой лист либо (пока не приехал) активный. */
function srcFor(look) {
    const id = hero3dSheetId(look);
    if (id === "male/long") return SRC;
    const have = SHEET_SOURCES.get(id);
    if (have) return have;
    if (!SHEET_PENDING.has(id) && SHEET_ERROR[id] === undefined) hero3dSheet(look);
    return SRC;
}

/** Палитра дорожек для произвольного look — наружу ради теста и превью панели внешности. */
export const heroLookPalette = (look) => paletteFor(look, SOURCES.grade);

/**
 * Сколько «мокроты» на долю данной записи палитры. Претензия владельца №3:
 * при промокании слой наливали на ВЕСЬ силуэт, и кожа с лицом уезжали в
 * тёмно-синий — герой выглядел синим человечком, а не мокрым человеком.
 * Мокнет ткань (1.0), слегка — волосы (0.45) и обводка (0.35), кожа почти не
 * меняет тон (0.10), огонь факела не меняется вовсе (0). Считается по ИМЕНИ
 * записи, а не по индексам: имена приносит запекка, и они переживают переезд
 * на другой лист.
 */
const WET_WEIGHT = {
    skin: 0.10, skinLight: 0.10, skinHighlight: 0.08, skinShadow: 0.12, skinDeep: 0.12,
    stubble: 0.12, jawShade: 0.12,
    hair: 0.45, hairMid: 0.45, hairLight: 0.42, hairHighlight: 0.40,
    ink: 0.35, inkSoft: 0.35, inkWarm: 0.35,
    flame: 0, flameMid: 0, flameCore: 0, flameGlow: 0, ember: 0
};
/** Значение кадра = индекс палитры + 1; вес в долях 0..255 (0 для пустоты). */
export function heroWetWeights(src = SOURCES.grade) {
    if (src.wetWeights) return src.wetWeights;
    const n = src.paletteHex.length + 1;
    const w = new Uint8Array(n).fill(255);
    w[0] = 0;
    const byName = new Map((src.meta.palette || []).map(([name], i) => [name, i + 1]));
    for (const [name, value] of Object.entries(WET_WEIGHT)) if (byName.has(name)) w[byName.get(name)] = Math.round(value * 255);
    // Дорожки: у них имени в списке нет, но роль known — skin/hair едут по
    // своей дорожке, cloth/pants мокнут целиком.
    const ramps = src.meta.ramps || {};
    for (const [ramp, meta] of Object.entries(ramps)) {
        const weight = ramp === "skin" ? 0.10 : ramp === "hair" ? 0.45 : 1;
        for (let i = 0; i < meta.steps; i += 1) w[meta.at + i + 1] = Math.round(weight * 255);
    }
    src.wetWeights = w;
    return w;
}

function decodeBase64(b64) {
    if (typeof Buffer !== "undefined") {
        const node = Buffer.from(b64, "base64");
        return new Uint8Array(node.buffer, node.byteOffset, node.length);
    }
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * RLE-поток → индексы палитры на каждый пиксель всех кадров позы.
 * Поток один на всю связку (кадры идут подряд), поэтому декодируем целиком и
 * сразу режем на кадры: 96×104 на кадр, дороже строки из ~600 пар это не стоит.
 */
function decodePose(key, src = SRC) {
    const cached = src.poses.get(key);
    if (cached) return cached;
    const b64 = src.streams[key];
    if (!b64) return null;
    const bytes = decodeBase64(b64);
    const per = src.CELL.w * src.CELL.h;
    let total = 0;
    for (let i = 0; i + 1 < bytes.length; i += 2) total += bytes[i];
    const indices = new Uint8Array(total);
    let at = 0;
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        const run = bytes[i];
        const value = bytes[i + 1];
        indices.fill(value, at, at + run);
        at += run;
    }
    // Значение 0 в потоке — «пусто», реальные индексы палитры сдвинуты на единицу.
    const count = Math.max(1, Math.round(total / per));
    const frames = [];
    for (let f = 0; f < count; f += 1) frames.push(indices.subarray(f * per, (f + 1) * per));
    const pose = { key, frames, canvases: new Array(count).fill(null), count, fps: fpsFor(key, src) };
    src.poses.set(key, pose);
    return pose;
}

function fpsFor(key, src = SRC) {
    const label = key.split("/")[1];
    const meta = src.meta.poses.find(p => p.label === label);
    return meta ? meta.fps : 6;
}

function frameCanvas(pose, index, palette, cell) {
    const existing = pose.canvases[index];
    if (existing) return existing;
    const src = pose.frames[index];
    if (!src) return null;
    const canvas = document.createElement("canvas");
    canvas.width = cell.w;
    canvas.height = cell.h;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(cell.w, cell.h);
    const out = img.data;
    for (let i = 0; i < src.length; i += 1) {
        const value = src[i];
        const o = i * 4;
        if (!value) { out[o + 3] = 0; continue; }
        const c = palette[value - 1];
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    pose.canvases[index] = canvas;
    return canvas;
}

/* ------------------------------ выбор позы и кадра ------------------------------ */

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Какую позу просит состояние актёра. Порядок — по силе признака: удар важнее бега,
 * факел в руке важнее покоя, покой важен только когда герой действительно стоит.
 */
export function heroPose(p, src = SRC) {
    const dir = p.dir === "left" || p.dir === "right" || p.dir === "up" ? p.dir : "down";
    // Клип Idle_Torch_Loop поднимает левую руку — значит он про факел в ЛЕВОЙ
    // руке. Факел в правой — обычная походка, а предмет дорисуется к правой кисти:
    // иначе герой «держит» пустой поднятый кулак, а огонь горит внизу.
    const left = p.leftTool;
    const torchInLeft = left === "torch" || left?.tool === "torch";
    const act = p.actionTimer > 0 ? clamp01(1 - p.actionTimer / 0.35) : -1;
    if (act >= 0) {
        // Рубка, добыча камня и сбор — отдельные клипы: взмах топора и удар киркой
        // выглядят по-разному, и это тот случай, когда анимация дешевле объясняет
        // игрока, чем иконка над головой.
        const kind = { chop: "chop", mine: "mine", gather: "gather" }[p.actionKind] || "attack";
        const label = labelFor(src, src.has(kind) ? kind : "attack");
        const frames = src.framesOf(label);
        return { dir, label, frame: Math.min(1, act) * frames };
    }
    if (p.fallTimer > 0) return { dir, label: labelFor(src, "idle"), frame: 0 };
    const gait = clamp01(p.gait != null ? p.gait : (p.moving ? 1 : 0));
    if (gait > 0.06) {
        const run = clamp01(p.runBlend || 0);
        const label = labelFor(src, run > 0.55 ? "run" : "walk");
        const frames = src.framesOf(label);
        // Фаза игрового шага (радианы) → кадр клипа; цикл клипа = один цикл фазы.
        const phase = ((p.phase || 0) % TAU + TAU) % TAU;
        return { dir, label, frame: (phase / TAU) * frames };
    }
    if (torchInLeft) {
        const label = labelFor(src, "torch");
        return { dir, label, frame: ((p.idleTime || 0) * fpsFor(`${dir}/${label}`, src)) % src.framesOf(label) };
    }
    const label = labelFor(src, "idle");
    return { dir, label, frame: ((p.idleTime || 0) * fpsFor(`${dir}/${label}`, src)) % src.framesOf(label) };
}

/** Спрайт для текущей позы: канвас + геометрия постановки. null — рисовать вектором. */
export function heroSprite(p, look) {
    if (!HERO3D.enabled || !HERO3D.ready || p.sprite === false) return null;
    // Живой кадр, если сцена поднялась. null — значит на этом актёре 3D не
    // сыграет (нет GL, нет позы), и лист закрывает кадр, а не пустота.
    if (HERO3D.live && LIVE_MOD) {
        try {
            const live = LIVE_MOD.liveFrame(p, look || p.look);
            if (live) return live;
            const why = LIVE_MOD.LIVE.reason;
            if (why === "bad-mesh" || why === "empty-frame" || why === "context-lost") {
                // Битая геометрия, пустой кадр или потерянный контекст: повторять
                // бессмысленно — выключаем слой и оставляем причину в штампе, иначе
                // кадр рисовался бы точкой (или пустотой) до конца сессии.
                HERO3D.live = false;
                HERO3D.quality = SRC === SOURCES.smooth ? "smooth" : "grade";
                HERO3D.error = LIVE_MOD.LIVE.error || "живая геометрия не собрана";
                return null;
            }
        } catch (err) {
            // Падение живого кадра — не чёрный экран, а возврат на лист: сцена
            // выключается, причина остаётся в штампе. Без этого одна ошибка в
            // скелете обрушала бы весь кадр (и игру) на глазах у игрока.
            HERO3D.live = false;
            HERO3D.quality = SRC === SOURCES.smooth ? "smooth" : "grade";
            HERO3D.error = `живой кадр упал: ${String(err && err.message || err).slice(0, 160)}`;
            console.warn("[hero3d]", HERO3D.error);
        }
    }
    const src = srcFor(look || p.look);
    const pose = heroPose(p, src);
    const data = decodePose(`${pose.dir}/${pose.label}`, src);
    if (!data) return null;
    const CELL = src.CELL, U = src.U, TOP = src.TOP;
    const index = ((Math.floor(pose.frame) % data.count) + data.count) % data.count;
    const canvas = frameCanvas(data, index, paletteFor(look || p.look, src), CELL);
    if (!canvas) return null;
    const pixels = data.frames[index];
    return {
        canvas, dir: pose.dir, label: pose.label, index, pixels,
        // Веса положены ЛЮБОМУ источнику: у гладкого нет дорожек, и он честно
        // получает «мокнет всё» — то, что было раньше. Раньше фильтр стоял здесь,
        // и в режиме сравнения мокрый слой вообще исчезал (претензия п.3).
        wet: heroWetWeights(src),
        x: -CELL.w / 2 * U, y: TOP, w: src.W, h: src.H,
        /**
         * Кусок спрайта вокруг кисти этого кадра — {src…, dst…} для drawImage.
         * Рантайм возвращает его поверх предмета: пальцы лежат на рукояти, а не
         * предмет поверх пальцев. Координаты перевода (пиксель ячейки → единицы
         * мира) живут здесь, потому что спрайт и его геометрия — тоже здесь.
         */
        grip(hand = "right") {
            const g = src.meta.grips?.[`${pose.dir}/${pose.label}`]?.[hand === "left" ? "l" : "r"]?.[index];
            if (!g) return null;
            return {
                sx: g[0], sy: g[1], sw: g[2], sh: g[3],
                dx: (-CELL.w / 2 + g[0]) * U, dy: TOP + g[1] * U,
                dw: g[2] * U, dh: g[3] * U
            };
        },
        /**
         * Скрыта ли кисть этой руки за телом В ЭТОМ КАДРЕ: 1/0 из запекки
         * (сравнивает глубину кисти с буфером глубины кадра), null — данных нет.
         * Порядок «предмет ↔ тело» обязан решать кадр, а не ракурс и не векторный
         * `rig.behind`: в анимации руки меняются местами каждый кадр, и поэтому
         * клинок спереди уходил за спину, а сзади вылезал поверх корпуса.
         */
        hidden(hand = "right") {
            const o = src.meta.occl?.[`${pose.dir}/${pose.label}`]?.[hand === "left" ? "l" : "r"];
            if (!o || o.length <= index) return null;
            return !!o[index];
        },
        /**
         * Заполнен ли в этом кадре пиксель под мировой точкой (x, y от линии стоп).
         * Спрайт — плоская фигура, поэтому «рука за телом» превращается в «факел
         * исчез»: укрывать предмет за силуэтом можно только пока сам пиксель руки
         * свободен. Проверяем по индексу палитры — картинка уже собрана, данных больше нет.
         */
        covers(x, y) {
            const px = Math.round(x / U + CELL.w / 2), py = Math.round(y / U + (CELL.h - src.meta.footPad));
            if (px < 0 || py < 0 || px >= CELL.w || py >= CELL.h) return false;
            return pixels[py * CELL.w + px] !== 0;
        }
    };
}

/**
 * Запечённая точка хвата кисти, в единицах мира от линии стоп. Формат совпадает с
 * toolAttachment (x, y, angle, intensity, gripX, gripY, behind) — свет факела и
 * предмет в руке берут отсюда координаты, не зная, что герой теперь спрайт.
 */
export function heroHandAnchor(p, hand = "right", extra = {}) {
    // В живом режиме якорь считается по той же кости, что отрисовала кадр, — а не
    // по таблице запекки: иначе предмет в руке ехал бы относительно ладони при
    // любом изменении позы, которого в листе нет.
    if (HERO3D.live && LIVE_MOD) {
        try {
            const live = LIVE_MOD.liveHandAnchor(p, p.look, hand, extra);
            if (live) return live;
        } catch { /* якорь — не причина ронять кадр: рисуем по таблице листа */ }
    }
    // Только вместе со спрайтом: якорь света и нарисованный предмет обязаны брать
    // координаты из одного источника, иначе огонёк уезжает с ладони (это ловит
    // tests/visual-world.test.js на четырёх ракурсах и в падении).
    if (!HERO3D.enabled || !HERO3D.ready || p.sprite === false) return null;
    const src = srcFor(p.look);
    const pose = heroPose(p, src);
    const anchors = src.meta.anchors?.[`${pose.dir}/${pose.label}`];
    if (!anchors) return null;
    const data = decodePose(`${pose.dir}/${pose.label}`, src);
    const count = data ? data.count : anchors.r.length;
    const index = ((Math.floor(pose.frame) % count) + count) % count;
    const side = hand === "left" ? "l" : "r";
    const point = anchors[side]?.[index];
    if (!point) return null;
    // Третий номер в bake — экранное направление предплечья. Если просят `follow`,
    // предмет поворачивается по нему и не зеркалится: ракурс уже учтён запеккой.
    const baked = point.length > 2 ? point[2] : undefined;
    const follow = !!extra.follow && baked !== undefined;
    const angle = follow ? spriteToolAngle(baked, extra.outward ?? toolOutward(pose.dir, hand), extra.bias) : (extra.angle || 0);
    return { x: point[0], y: point[1], gripX: point[0], gripY: point[1], angle, noMirror: follow, intensity: extra.intensity ?? 1, behind: !!extra.behind, hand };
}


// Геометрия общая у обоих выходов (одна запекка, одна сетка), поэтому константа
// снимается с грейда и не зависит от того, какой режим включён в данный момент.
export const HERO_SPRITE_CELL = {
    w: SOURCES.grade.CELL.w, h: SOURCES.grade.CELL.h,
    pxPerUnit: SOURCES.grade.meta.pxPerUnit, footPad: SOURCES.grade.meta.footPad
};

/** Сколько связок есть у активного выхода — «ноль» означает, что модуль пуст. */
export const hero3dLinkCount = () => Object.keys(SRC.streams).length;
