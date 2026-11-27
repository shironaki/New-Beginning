/**
 * tools/grip-check.js — проверка «предмет в руке» без запуска игры.
 *
 *   node tools/grip-check.js                       # лист до/после в .artifacts/grip-check.png
 *   node tools/grip-check.js --tool knife --hand left --pose chop
 *
 * Зачем: запечённый герой — плоский спрайт, и любой предмет рисуется ПОСЛЕ него,
 * то есть поверх кисти. Со стороны это выглядит как нож, наклеенный на тыльную
 * сторону ладони. Исправление — «патч кулака»: запекка оставляет прямоугольник
 * пикселей вокруг кисти (META.grips), и рантайм возвращает его на место сразу
 * после предмета. Этот лист показывает ровно это: слева предмет поверх пальцев,
 * справа — пальцы поверх предмета, с обводкой того самого прямоугольника.
 *
 * Геометрию хвата не дублируем: берём sprite.grip() и heroHandAnchor() из тех же
 * модулей, которыми пользуется renderer.
 */
import fs from "node:fs";
import path from "node:path";
import { installDOM } from "../tests/dom-harness.js";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
    const i = argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
};

installDOM();
// document.createElement из harness'а отдаёт бумажный canvas; здесь нужен настоящий
// пиксельный буфер — тот же ShimCanvas, чем пользуется tools/scene.js.
const { HERO3D, heroSprite, heroHandAnchor, HERO_SPRITE_CELL } = await import("../js/render/hero3d.js");
const { STREAMS, META, PALETTE_HEX } = await import("../js/render/heroframes.js");
if (!HERO3D.ready) { console.error("спрайты не готовы — прогони node tools/hero-bake.js --emit"); process.exit(1); }

const ZOOM = Number(flag("zoom", 6));
const POSES = String(flag("pose", "idle,walk,run,chop,mine,gather,attack,torch")).split(",");
const DIRS = String(flag("dirs", "down,up,left,right")).split(",");
const TOOL = String(flag("tool", "knife"));
const HAND = flag("hand", "right") === "left" ? "left" : "right";
const OUT = String(flag("out", ".artifacts/grip-check.png"));
const CELL = HERO_SPRITE_CELL;
const CELL_W0 = CELL.w, CELL_H0 = CELL.h;
const baseCreate = globalThis.document.createElement;
globalThis.document.createElement = (tag) => (tag === "canvas" ? new ShimCanvas(CELL_W0, CELL_H0) : baseCreate(tag));

const hero = {
    x: 0, y: 0, dir: "right", facing: "right", moving: false, vx: 0, vy: 0,
    walkPhase: 0, animTime: 0, sleeping: false, hurtTimer: 0, actionKind: null,
    actionTimer: 0, swing: null, eatingHand: null, look: { hair: "buzzed", garment: "tunic", garmentColor: "moss", hairColor: "brown" },
    inventory: { items: [] }
};
hero.currentTool = TOOL;

function frameFor(dir, pose, index) {
    hero.dir = dir; hero.facing = dir === "left" ? "left" : "right";
    hero.animTime = (index + 0.5) / 8;
    hero._label = pose;
    // heroPose() читает связку из состояния игрока; здесь подменяем только кадр,
    // поэтому пользуемся прямым разбором потока, а не героем.
    const key = `${dir}/${pose}`;
    const stream = STREAMS[key];
    if (!stream) return null;
    const bytes = Uint8Array.from(Buffer.from(stream, "base64"));
    const w = CELL.w, h = CELL.h;
    const pixels = new Uint8Array(w * h);
    let i = 0, at = 0;
    while (at < w * h && i + 1 < bytes.length) {
        const cnt = bytes[i++], value = bytes[i++];
        if (!value) { at += cnt; continue; }
        for (let k = 0; k < cnt && at < w * h; k += 1) pixels[at++] = value;
    }
    const canvas = new ShimCanvas(w, h);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let k = 0; k < w * h; k += 1) {
        const v = pixels[k];
        if (!v) { out[k * 4 + 3] = 0; continue; }
        const hex = PALETTE_HEX[v - 1] || "#000000";
        out[k * 4] = parseInt(hex.slice(1, 3), 16);
        out[k * 4 + 1] = parseInt(hex.slice(3, 5), 16);
        out[k * 4 + 2] = parseInt(hex.slice(5, 7), 16);
        out[k * 4 + 3] = 255;
    }
    canvas.data.set(out);
    const anchors = META.anchors?.[key]?.[HAND === "left" ? "l" : "r"];
    const grip = META.grips?.[key]?.[HAND === "left" ? "l" : "r"];
    const pxPerUnit = META.pxPerUnit || 2;
    const anchor = anchors?.[index] || null;
    return { canvas, pixels, anchor, patch: grip?.[index] || null, pxPerUnit };
}

/** Прямоугольник «предмета» в пикселях ячейки: рукоять + клинок вдоль запечённого угла. */
function paintItem(img, anchor, pxPerUnit) {
    if (!anchor) return;
    const U = 1 / pxPerUnit;
    const gx = anchor[0] * U + CELL.w / 2;
    const gy = anchor[1] * U + (CELL.h - (CELL.footPad || 0));   // та же сетка, что у covers()
    const ang = anchor[2] || 0;
    // клинок торчит из кулака наружу, длина ~9 px — ровно как в игре.
    const dx = Math.sin(ang), dy = -Math.cos(ang);
    const fill = (x, y, w, h, color) => {
        for (let py = Math.round(y); py < Math.round(y + h); py += 1) {
            for (let px = Math.round(x); px < Math.round(x + w); px += 1) {
                if (px < 0 || py < 0 || px >= CELL.w || py >= CELL.h) continue;
                const o = (py * CELL.w + px) * 4;
                img[o] = color[0]; img[o + 1] = color[1]; img[o + 2] = color[2]; img[o + 3] = 255;
            }
        }
    };
    for (let t = -3; t < 12; t += 0.5) {
        const w = t < 1 ? 2.4 : 1.6;
        const color = t < 1 ? [110, 74, 44] : [214, 216, 220];
        for (let s = -w / 2; s <= w / 2; s += 0.5) {
            const cx2 = gx + dx * t - dy * s;
            const cy2 = gy + dy * t + dx * s;
            fill(cx2 - 0.5, cy2 - 0.5, 1, 1, color);
        }
    }
}

function copyCell(target, ox, oy, cell, { patchOnTop, markPatch }) {
    if (!cell) return;
    const w = CELL.w, h = CELL.h;
    const put = (x, y, rgb) => {
        const o = ((oy + y) * target.width + ox + x) * 4;
        target.data[o] = rgb[0]; target.data[o + 1] = rgb[1]; target.data[o + 2] = rgb[2]; target.data[o + 3] = 255;
    };
    // фон под ячейку: тёмно-серый, как земля на скриншоте
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) put(x, y, [24, 30, 26]);
    const blit = (source, skipPatch) => {
        const src = source.data || source;      // ShimCanvas или просто пиксельный буфер
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                const o = (y * w + x) * 4;
                if (src[o + 3] < 8) continue;
                if (skipPatch && cell.patch) {
                    const [gx, gy, gw, gh] = cell.patch;
                    if (x >= gx && x < gx + gw && y >= gy && y < gy + gh) continue;
                }
                put(x, y, [src[o], src[o + 1], src[o + 2]]);
            }
        }
    };
    const item = new Uint8ClampedArray(w * h * 4);
    paintItem(item, cell.anchor, cell.pxPerUnit);
    blit(cell.canvas, false);
    blit(item, false);                                    // предмет поверх спрайта
    if (patchOnTop) {                                      // …и возвращаем кулак
        const back = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
            const o = (y * w + x) * 4;
            if (cell.canvas.data[o + 3] < 8) continue;
            back[o] = cell.canvas.data[o]; back[o + 1] = cell.canvas.data[o + 1];
            back[o + 2] = cell.canvas.data[o + 2]; back[o + 3] = 255;
        }
        const [gx, gy, gw, gh] = cell.patch || [0, 0, 0, 0];
        for (let y = gy; y < gy + gh; y += 1) for (let x = gx; x < gx + gw; x += 1) {
            const o = (y * w + x) * 4;
            if (back[o + 3] < 8) continue;
            put(x, y, [back[o], back[o + 1], back[o + 2]]);
        }
    }
    if (markPatch && cell.patch) {
        const [gx, gy, gw, gh] = cell.patch;
        for (let x = gx; x < gx + gw; x += 1) { put(x, gy, [60, 220, 255]); put(x, gy + gh - 1, [60, 220, 255]); }
        for (let y = gy; y < gy + gh; y += 1) { put(gx, y, [60, 220, 255]); put(gx + gw - 1, y, [60, 220, 255]); }
    }
}

const pad = 4;
const cellW = CELL.w * ZOOM, cellH = CELL.h * ZOOM;
const pairs = [];
for (const dir of DIRS) {
    for (const pose of POSES) {
        const cell = frameFor(dir, pose, 0);
        if (cell) pairs.push({ label: `${dir}/${pose}`, cell });
    }
}
const cols = Number(flag("cols", 4));
const rows = Math.ceil(pairs.length / cols); // на каждой ячейке пара: до / после
const sheet = new ShimCanvas(cols * (cellW * 2 + pad * 3) + pad, rows * (cellH + pad * 2) + pad);
sheet.data.fill(12);
pairs.forEach((entry, i) => {
    const col = i % cols, row = Math.floor(i / cols) * 2;
    [false, true].forEach((after, k) => {
        const ox = pad + col * (cellW * 2 + pad * 3) + k * (cellW + pad);
        const oy = pad + row * (cellH + pad * 2);
        // увеличение nearest-neighbour: рисуем блоками по ZOOM пикселей
        const sub = document.createElement("canvas");
        copyCell(sub, 0, 0, entry.cell, { patchOnTop: after, markPatch: after });
        for (let y = 0; y < CELL.h; y += 1) {
            for (let x = 0; x < CELL.w; x += 1) {
                const o = (y * CELL.w + x) * 4;
                if (sub.data[o + 3] < 8) continue;
                for (let dy = 0; dy < ZOOM; dy += 1) {
                    for (let dx = 0; dx < ZOOM; dx += 1) {
                        const d = ((oy + y * ZOOM + dy) * sheet.width + ox + x * ZOOM + dx) * 4;
                        sheet.data[d] = sub.data[o]; sheet.data[d + 1] = sub.data[o + 1];
                        sheet.data[d + 2] = sub.data[o + 2]; sheet.data[d + 3] = 255;
                    }
                }
            }
        }
    });
});
fs.mkdirSync(path.resolve(path.dirname(OUT)), { recursive: true });
fs.writeFileSync(OUT, encodePNG(sheet, [12, 12, 12]));
const withPatch = Object.values(META.grips || {}).reduce((n, set) => n + [set.r, set.l].flat().filter(Boolean).length, 0);
const withAnchor = Object.values(META.anchors).reduce((n, set) => n + [set.r, set.l].flat().length, 0);
console.log(`GRIP-CHECK: ${pairs.length} кадров ×2 (до/после), патч кулака есть в ${withPatch} из ${withAnchor} рук → ${OUT}`);
void heroSprite; void hero;
