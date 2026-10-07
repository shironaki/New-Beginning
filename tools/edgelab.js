/**
 * tools/edgelab.js — a bench for ONE seam.
 *
 * Chasing a straight edge inside a full frame never works: a dozen layers
 * overlap and the eye cannot tell which of them drew the line. So this builds
 * a tiny synthetic map — a block of water in a block of land — paints it at a
 * huge zoom, and can switch the layers on one at a time.
 *
 *   node tools/edgelab.js                        all layers, water in sand
 *   node tools/edgelab.js --layer base           only the flat tiles
 *   node tools/edgelab.js --layer edges          tiles + paintEdges
 *   node tools/edgelab.js --pair grass,dirt      a dry seam instead
 *   node tools/edgelab.js --scale 12 --out x.png
 *
 * Output goes to .artifacts/_edgelab*.png. Zero dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
import { T, TILE_SIZE } from "../js/world/tiles.js";
import { paintTile, paintEdges } from "../js/render/tilesart.js";

const arg = (name, dflt) => {
    const i = process.argv.indexOf("--" + name);
    return i < 0 ? dflt : process.argv[i + 1];
};

const LAYER = String(arg("layer", "all"));          // base | edges | all
const SCALE = Number(arg("scale", 8));              // px per world pixel
const PAIR = String(arg("pair", "sand,water"));
const OUT = String(arg("out", `.artifacts/_edgelab-${LAYER}.png`));

const NAMES = { water: T.WATER, deep: T.DEEP, sand: T.SAND, grass: T.GRASS,
                dirt: T.DIRT, ash: T.ASH, soot: T.SOOT, mud: T.MUD,
                stone: T.STONE, cliff: T.CLIFF, gravel: T.GRAVEL };
const [outerName, innerName] = PAIR.split(",");
const OUTER = NAMES[outerName], INNER = NAMES[innerName];
if (OUTER === undefined || INNER === undefined) {
    console.error(`--pair: ищу имена из ${Object.keys(NAMES).join(", ")}`);
    process.exit(1);
}

/* A 9 x 7 field: a 5 x 3 block of INNER, the rest OUTER. The block has four
   perfectly straight sides and four right angles — exactly the thing the
   painter has to hide. */
const W = 9, H = 7;
const data = new Uint8Array(W * H).fill(OUTER);
for (let y = 2; y < 5; y++) for (let x = 2; x < 7; x++) data[y * W + x] = INNER;

const map = {
    w: W, h: H, data,
    get: (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? OUTER : data[y * W + x]),
    inBounds: (x, y) => x >= 0 && y >= 0 && x < W && y < H
};

const canvas = new ShimCanvas(W * TILE_SIZE * SCALE, H * TILE_SIZE * SCALE);
const ctx = canvas.getContext("2d");
ctx.save();
ctx.scale(SCALE, SCALE);

for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
        paintTile(ctx, map.get(x, y), x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, x, y, "spring");
    }
}
if (LAYER === "edges" || LAYER === "all") {
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            paintEdges(ctx, map, x, y, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, "spring");
        }
    }
}
ctx.restore();

// The tile grid on top, so it is obvious whether an edge follows it.
if (process.argv.includes("--grid")) {
    ctx.strokeStyle = "rgba(255,0,0,0.35)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x++) {
        ctx.beginPath();
        ctx.moveTo(x * TILE_SIZE * SCALE, 0);
        ctx.lineTo(x * TILE_SIZE * SCALE, H * TILE_SIZE * SCALE);
        ctx.stroke();
    }
    for (let y = 0; y <= H; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * TILE_SIZE * SCALE);
        ctx.lineTo(W * TILE_SIZE * SCALE, y * TILE_SIZE * SCALE);
        ctx.stroke();
    }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, encodePNG(canvas));
console.log(`🔬 ${PAIR}, слой «${LAYER}», ×${SCALE} → ${OUT}`);
