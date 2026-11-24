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
import { STREAMS, META, PALETTE_HEX } from "./heroframes.js";
import { RAMPS, shadeHex, spriteToolAngle, toolOutward } from "./charspec.js";

const TAU = Math.PI * 2;
const U = 1 / (META.pxPerUnit || 2);        // пиксель спрайта → единицы мира
const CELL = META.cell;
const TOP = -(CELL.h - META.footPad) * U;   // верх ячейки относительно линии стоп
const W = CELL.w * U;
const H = CELL.h * U;

/** Готово ли включать спрайтовый режим. `false` у actor (`p.sprite === false`) выключает его точечно. */
export const HERO3D = {
    enabled: true,
    get ready() { return typeof document !== "undefined" && Object.keys(STREAMS).length > 0; }
};

/* ------------------------------- декодирование ------------------------------ */

/**
 * Палитра. Модуль приносит 72 цвета: общие (те, что в лаборатории стиля), обводку
 * и три цветовые дорожки — куртка, кожа, волосы. Дорожки в игре ПЕРЕСОБИРАЮТСЯ из
 * `look`: кадр помнит не цвет, а slot дорожки, поэтому сменить цвет куртки — это
 * заменить пять записей палитры, а не перепекать 188 кадров.
 */
const toRgb = (hex) => {
    const c = String(hex).replace("#", "");
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
};
const BASE_PALETTE = PALETTE_HEX.map(toRgb);
let paletteKey = null;
let paletteRgb = BASE_PALETTE;

function paletteFor(look) {
    const ramps = META.ramps;
    if (!ramps) return BASE_PALETTE;
    const names = Object.keys(ramps);
    const key = names.map(name => String((look && look[RAMPS[name] && RAMPS[name].look]) || "")).join("|");
    if (key === paletteKey) return paletteRgb;
    const out = BASE_PALETTE.map(rgb => rgb.slice());
    for (const name of names) {
        const meta = ramps[name];
        const spec = RAMPS[name];
        if (!spec) continue;
        const base = (look && look[spec.look]) || PALETTE_HEX[meta.at];
        const steps = Math.min(meta.steps, spec.offsets.length);
        for (let i = 0; i < steps; i += 1) out[meta.at + i] = toRgb(shadeHex(base, spec.offsets[i]));
    }
    paletteKey = key;
    paletteRgb = out;
    for (const pose of poses.values()) pose.canvases.fill(null);   // канвасы собраны по старой палитре
    return out;
}

/** Палитра дорожек для произвольного look — наружу ради теста и превью панели внешности. */
export const heroLookPalette = paletteFor;

const poses = new Map();                   // "down/walk" → {frames: Uint8Array[], count, fps}

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
function decodePose(key) {
    const cached = poses.get(key);
    if (cached) return cached;
    const b64 = STREAMS[key];
    if (!b64) return null;
    const bytes = decodeBase64(b64);
    const per = CELL.w * CELL.h;
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
    const pose = { key, frames, canvases: new Array(count).fill(null), count, fps: fpsFor(key) };
    poses.set(key, pose);
    return pose;
}

function fpsFor(key) {
    const label = key.split("/")[1];
    const meta = META.poses.find(p => p.label === label);
    return meta ? meta.fps : 6;
}

function frameCanvas(pose, index, palette) {
    const existing = pose.canvases[index];
    if (existing) return existing;
    const src = pose.frames[index];
    if (!src) return null;
    const canvas = document.createElement("canvas");
    canvas.width = CELL.w;
    canvas.height = CELL.h;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(CELL.w, CELL.h);
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
export function heroPose(p) {
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
        const label = META.poses.some(x => x.label === kind) ? kind : "attack";
        const frames = META.poses.find(x => x.label === label)?.frames || 6;
        return { dir, label, frame: Math.min(1, act) * frames };
    }
    if (p.fallTimer > 0) return { dir, label: "idle", frame: 0 };
    const gait = clamp01(p.gait != null ? p.gait : (p.moving ? 1 : 0));
    if (gait > 0.06) {
        const run = clamp01(p.runBlend || 0);
        const label = run > 0.55 ? "run" : "walk";
        const frames = META.poses.find(x => x.label === label)?.frames || 6;
        // Фаза игрового шага (радианы) → кадр клипа; цикл клипа = один цикл фазы.
        const phase = ((p.phase || 0) % TAU + TAU) % TAU;
        return { dir, label, frame: (phase / TAU) * frames };
    }
    if (torchInLeft) {
        const frames = META.poses.find(x => x.label === "torch")?.frames || 4;
        return { dir, label: "torch", frame: ((p.idleTime || 0) * fpsFor(`${dir}/torch`)) % frames };
    }
    const frames = META.poses.find(x => x.label === "idle")?.frames || 4;
    return { dir, label: "idle", frame: ((p.idleTime || 0) * fpsFor(`${dir}/idle`)) % frames };
}

/** Спрайт для текущей позы: канвас + геометрия постановки. null — рисовать вектором. */
export function heroSprite(p, look) {
    if (!HERO3D.enabled || !HERO3D.ready || p.sprite === false) return null;
    const pose = heroPose(p);
    const data = decodePose(`${pose.dir}/${pose.label}`);
    if (!data) return null;
    const index = ((Math.floor(pose.frame) % data.count) + data.count) % data.count;
    const canvas = frameCanvas(data, index, paletteFor(look || p.look));
    if (!canvas) return null;
    const pixels = data.frames[index];
    return {
        canvas, dir: pose.dir, label: pose.label, index,
        x: -CELL.w / 2 * U, y: TOP, w: W, h: H,
        /**
         * Заполнен ли в этом кадре пиксель под мировой точкой (x, y от линии стоп).
         * Спрайт — плоская фигура, поэтому «рука за телом» превращается в «факел
         * исчез»: укрывать предмет за силуэтом можно только пока сам пиксель руки
         * свободен. Проверяем по индексу палитры — картинка уже собрана, данных больше нет.
         */
        covers(x, y) {
            const px = Math.round(x / U + CELL.w / 2), py = Math.round(y / U + (CELL.h - META.footPad));
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
    // Только вместе со спрайтом: якорь света и нарисованный предмет обязаны брать
    // координаты из одного источника, иначе огонёк уезжает с ладони (это ловит
    // tests/visual-world.test.js на четырёх ракурсах и в падении).
    if (!HERO3D.enabled || !HERO3D.ready || p.sprite === false) return null;
    const pose = heroPose(p);
    const anchors = META.anchors?.[`${pose.dir}/${pose.label}`];
    if (!anchors) return null;
    const data = decodePose(`${pose.dir}/${pose.label}`);
    const count = data ? data.count : anchors.r.length;
    const index = ((Math.floor(pose.frame) % count) + count) % count;
    const side = hand === "left" ? "l" : "r";
    const point = anchors[side]?.[index];
    if (!point) return null;
    // Третий номер в бake — экранное направление предплечья. Если просят `follow`,
    // предмет поворачивается по нему и не зеркалится: ракурс уже учтён запеккой.
    const baked = point.length > 2 ? point[2] : undefined;
    const follow = !!extra.follow && baked !== undefined;
    const angle = follow ? spriteToolAngle(baked, extra.outward ?? toolOutward(pose.dir, hand), extra.bias) : (extra.angle || 0);
    return { x: point[0], y: point[1], gripX: point[0], gripY: point[1], angle, noMirror: follow, intensity: extra.intensity ?? 1, behind: !!extra.behind, hand };
}

/** Позиция хвата в кадре отражения/подсветки — то же самое, но без предмета. */
export function heroHandPositions(p) {
    const right = heroHandAnchor(p, "right");
    const left = heroHandAnchor(p, "left");
    return { right, left };
}

export const HERO_SPRITE_CELL = { w: CELL.w, h: CELL.h, pxPerUnit: META.pxPerUnit, footPad: META.footPad };
