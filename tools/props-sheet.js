/**
 * tools/props-sheet.js — contact sheet of every prop the world can spawn.
 *
 *   npm run sheet
 *
 * Draws each kind on a neutral ground so art problems (a missing crown, a
 * floating shadow, a silhouette that reads as a scribble) are obvious at a
 * glance instead of being hunted for in-game.
 */
import fs from "node:fs";
import path from "node:path";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
import { paintProp, paintFlames, setSun } from "../js/render/tilesart.js";

const KINDS = [
    "pine", "spruce", "oak", "birch", "willow", "ancient_oak",
    "palm", "dead_tree", "burnt_tree", "burnt_stump", "burnt_beam",
    "rock", "ore_rock", "beach_pebbles", "ruin_wall", "bush", "herb",
    "firewood", "reed", "grass_tuft", "flower", "driftwood", "tent",
    "hearth_ruin", "diary", "chest_old", "campfire"
];

const COLS = 7, CELL = 150, ROWS = Math.ceil(KINDS.length / COLS);
const cv = new ShimCanvas(COLS * CELL, ROWS * CELL);
const ctx = cv.getContext("2d");

ctx.fillStyle = "#6f7a5e";
ctx.fillRect(0, 0, cv.width, cv.height);
ctx.fillStyle = "rgba(0,0,0,0.12)";
for (let i = 1; i < COLS; i++) ctx.fillRect(i * CELL, 0, 1, cv.height);
for (let i = 1; i < ROWS; i++) ctx.fillRect(0, i * CELL, cv.width, 1);

setSun(12, 1);

KINDS.forEach((kind, i) => {
    const cx = (i % COLS) * CELL + CELL / 2;
    const cy = Math.floor(i / COLS) * CELL + CELL * 0.78;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1.6, 1.6);
    const obj = {
        kind, tx: 3 + i, ty: 7 + i * 2, size: 1,
        berries: true, ore: "copper", variant: i % 4, herbType: "sage", amount: 2
    };
    paintProp(ctx, obj, 1.2, "spring");
    if (kind === "campfire") paintFlames(ctx, 1, 1.2, [{ id: "log", burn: 0.6, seed: 3 }, { id: "firewood", burn: 1, seed: 7 }]);
    ctx.restore();
});

const out = path.resolve(".artifacts/props-sheet.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePNG(cv));
console.log(`🧾 ${KINDS.length} пропов → ${path.relative(process.cwd(), out)}`);
