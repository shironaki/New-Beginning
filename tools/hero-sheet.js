/**
 * tools/hero-sheet.js — contact sheet of the hero's animation.
 *
 *   npm run hero
 *
 * Rows: facing down / left / right / up.
 * Columns: idle, four phases of the walk cycle, and three frames of a tool
 * swing — enough to judge the animation without opening a browser.
 */
import fs from "node:fs";
import path from "node:path";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
import { drawCharacter } from "../js/render/character.js";

const torch = process.argv.includes("--torch");
const OUT = path.resolve(".artifacts");
fs.mkdirSync(OUT, { recursive: true });

const DIRS = ["down", "left", "right", "up"];
const COLS = [
    { label: "idle",    phase: 0,            gait: 0, run: 0, act: 0 },
    { label: "walk 1",  phase: 0,            gait: 1, run: 0, act: 0 },
    { label: "walk 2",  phase: Math.PI / 2,  gait: 1, run: 0, act: 0 },
    { label: "walk 3",  phase: Math.PI,      gait: 1, run: 0, act: 0 },
    { label: "walk 4",  phase: Math.PI * 1.5, gait: 1, run: 0, act: 0 },
    { label: "run 1",   phase: Math.PI / 2,  gait: 1, run: 1, act: 0 },
    { label: "run 2",   phase: Math.PI * 1.5, gait: 1, run: 1, act: 0 },
    { label: "swing 1", phase: 0,            gait: 0, run: 0, act: 0.3 },
    { label: "swing 2", phase: 0,            gait: 0, run: 0, act: 0.16 },
    { label: "swing 3", phase: 0,            gait: 0, run: 0, act: 0.05 }
];

const S = 6;                       // zoom
const CW = 44 * S / 1.6, CH = 46 * S / 1.6;
const canvas = new ShimCanvas(Math.round(CW * COLS.length), Math.round(CH * DIRS.length));
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#6b7a56";
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.strokeStyle = "rgba(0,0,0,0.12)";
for (let i = 1; i < COLS.length; i++) {
    ctx.beginPath(); ctx.moveTo(i * CW, 0); ctx.lineTo(i * CW, canvas.height); ctx.stroke();
}
for (let j = 1; j < DIRS.length; j++) {
    ctx.beginPath(); ctx.moveTo(0, j * CH); ctx.lineTo(canvas.width, j * CH); ctx.stroke();
}

DIRS.forEach((dir, row) => {
    COLS.forEach((col, i) => {
        ctx.save();
        ctx.translate(i * CW + CW / 2, row * CH + CH - 6);
        ctx.scale(S / 1.6, S / 1.6);
        drawCharacter(ctx, {
            dir, phase: col.phase, gait: col.gait, runBlend: col.run,
            actionTimer: col.act, idleTime: 1.2 + row * 0.7,
            tool: torch ? { id: "torch", tool: "torch" } : { id: "axe_stone", tool: "axe" }
        });
        ctx.restore();
    });
});

const file = path.join(OUT, torch ? "hero-torch-sheet.png" : "hero-sheet.png");
fs.writeFileSync(file, encodePNG(canvas));
console.log(`🧍 ${DIRS.length}×${COLS.length} поз героя → ${path.relative(process.cwd(), file)}`);
