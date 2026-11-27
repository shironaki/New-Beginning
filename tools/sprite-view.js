/**
 * tools/sprite-view.js — то, что реально лежит в модуле кадров, на шахматной
 * подложке. Фон нужен именно клеткой: если внутри силуэта есть пустой пиксель,
 * он сразу виден как «дырка, сквозь которую светит земля» — ровно тот дефект,
 * который владелец описывает словами «пиксели просвечивают».
 *
 *   node tools/sprite-view.js                                   # down/idle, 8×
 *   node tools/sprite-view.js --key down/walk --zoom 10
 *   node tools/sprite-view.js --module js/render/herosmooth.js --out .artifacts/smooth.png
 *   node tools/sprite-view.js --all --out .artifacts/sprite-all.png     # 4 ракурса × 8 поз
 *
 * Читается STREAMS/META из запечённого модуля — тот же RLE и та же палитра, что
 * использует js/render/hero3d.js, поэтому расхождений с игрой быть не может.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return dflt;
    const next = argv[i + 1];
    return next === undefined || next.startsWith("--") ? true : next;
};
const num = (name, dflt) => {
    const v = opt(name, dflt);
    return typeof v === "boolean" ? dflt : Number(v);
};

const file = String(opt("module", "js/render/heroframes.js"));
const { STREAMS, META } = await import(path.resolve(file));
const CELL = META.cell;
const PAL = (mod => (mod.PALETTE_HEX || mod.META.palette.map(x => x[1])))(await import(path.resolve(file)));
const rgb = PAL.map((hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
const ink = rgb.length - 1;

function decode(b64) {
    const bytes = Buffer.from(b64, "base64");
    const per = CELL.w * CELL.h;
    let total = 0;
    for (let i = 0; i + 1 < bytes.length; i += 2) total += bytes[i];
    const idx = new Uint8Array(total);
    let n = 0;
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        const run = bytes[i];
        const value = bytes[i + 1];
        idx.fill(value, n, n + run);
        n += run;
    }
    const out = [];
    for (let at = 0; at + per <= total; at += per) out.push(idx.subarray(at, at + per));
    if (!out.length) out.push(new Uint8Array(per));
    return out;
}

/** Обводка лежит отдельным индексом; 0 в потоке — «пусто», цвета сдвинуты на 1. */
function paint(ctx, idx, ox, oy, z, holes) {
    for (let y = 0; y < CELL.h; y += 1) {
        for (let x = 0; x < CELL.w; x += 1) {
            const v = idx[y * CELL.w + x];
            const px = ox + x * z, py = oy + y * z;
            if (!v) {
                const cell = ((x >> 1) + (y >> 1)) & 1;
                const c = cell ? [92, 92, 108] : [58, 58, 70];
                for (let dy = 0; dy < z; dy += 1) for (let dx = 0; dx < z; dx += 1) {
                    const o = (((py + dy) * ctx.width) + px + dx) * 4;
                    ctx.data[o] = c[0]; ctx.data[o + 1] = c[1]; ctx.data[o + 2] = c[2]; ctx.data[o + 3] = 255;
                }
                continue;
            }
            const c = rgb[v - 1] || [255, 0, 255];
            for (let dy = 0; dy < z; dy += 1) for (let dx = 0; dx < z; dx += 1) {
                const o = (((py + dy) * ctx.width) + px + dx) * 4;
                ctx.data[o] = c[0]; ctx.data[o + 1] = c[1]; ctx.data[o + 2] = c[2]; ctx.data[o + 3] = 255;
            }
            if (holes) holes.push([x, y, v]);
        }
    }
}

const { ShimCanvas, encodePNG } = await import(path.resolve("tools/canvas-shim.js"));
const z = num("zoom", 8);
const keys = opt("all", false)
    ? Object.keys(STREAMS).filter(k => /^(down|left|right|up)\/(idle|walk|run|attack|chop|mine|gather|torch)$/.test(k))
    : String(opt("key", "down/idle")).split(",").map(x => x.trim()).filter(Boolean);

const framesPerKey = new Map();
let cols = 0;
const shots = [];
for (const key of keys) {
    if (!STREAMS[key]) { console.log(`нет кадра ${key} в ${file}`); continue; }
    const list = decode(STREAMS[key], 1);
    framesPerKey.set(key, list);
    shots.push({ key, idx: list[num("frame", 0) % list.length] });
}
cols = Math.min(6, shots.length);
const rows = Math.ceil(shots.length / cols);
const cw = CELL.w * z, ch = CELL.h * z;
const canvas = new ShimCanvas(cols * (cw + 6) + 6, rows * (ch + 6) + 6);
shots.forEach((shot, i) => {
    paint(canvas, shot.idx, 6 + (i % cols) * (cw + 6), 6 + Math.floor(i / cols) * (ch + 6), z);
});
const out = String(opt("out", ".artifacts/sprite-view.png"));
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, encodePNG(canvas, [30, 30, 36]));
console.log(`SPRITE-VIEW: ${shots.length} кадр(ов) ×${z} → ${out} (${canvas.width}×${canvas.height}), модуль ${file}, обводка ${ink}`);
