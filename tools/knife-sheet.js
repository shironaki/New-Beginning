/**
 * tools/knife-sheet.js — close-up of the hero holding a knife.
 *
 *   node tools/knife-sheet.js
 *
 * The hero sheet uses an axe; the knife is the smallest tool and the one that
 * exposes grip bugs, so it gets its own, bigger sheet.
 */
import fs from "node:fs";
import path from "node:path";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
import { drawCharacter } from "../js/render/character.js";

const OUT = path.resolve(".artifacts");
fs.mkdirSync(OUT, { recursive: true });

const DIRS = ["down", "left", "right", "up"];
const COLS = [
    { phase: 0, gait: 0, act: 0 },
    { phase: Math.PI / 2, gait: 1, act: 0 },
    { phase: Math.PI, gait: 1, act: 0 },
    { phase: Math.PI * 1.5, gait: 1, act: 0 },
    { phase: 0, gait: 0, act: 0.16 }
];

const S = 9, CW = 46 * S / 1.6, CH = 48 * S / 1.6;
const canvas = new ShimCanvas(Math.round(CW * COLS.length), Math.round(CH * DIRS.length));
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#6b7a56";
ctx.fillRect(0, 0, canvas.width, canvas.height);

DIRS.forEach((dir, row) => COLS.forEach((col, i) => {
    ctx.save();
    ctx.translate(i * CW + CW / 2, row * CH + CH - 10);
    ctx.scale(S / 1.6, S / 1.6);
    drawCharacter(ctx, {
        dir, phase: col.phase, gait: col.gait, runBlend: 0,
        actionTimer: col.act, idleTime: 1.2,
        tool: { id: "knife_flint", tool: "knife" }
    });
    ctx.restore();
}));

const file = path.join(OUT, "knife-sheet.png");
fs.writeFileSync(file, encodePNG(canvas));
console.log(`🔪 ${DIRS.length}×${COLS.length} поз с ножом → ${path.relative(process.cwd(), file)}`);
