/** Bounded, reproducible 021/023 telemetry + running/fall pose sequences.
 * --probe-only --out <dir> also works against the preceding JS snapshot. */
import fs from "node:fs";
import path from "node:path";
import { Player } from "../js/entities/player.js";
import { generateZone } from "../js/world/worldgen.js";
import { drawCharacter, posture } from "../js/render/character.js";
import { ATTACH } from "../js/render/charspec.js";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
const args = process.argv.slice(2), i = args.indexOf("--out");
const out = path.resolve(i < 0 ? ".artifacts/stage60" : args[i + 1]);
fs.mkdirSync(out, { recursive: true });
const zone = generateZone("ashfall", 1066618561), metrics = [], strips = [];
for (const [note, x, y, stamina] of [["021", 792, 1079, 100], ["023-low", 824, 965, 6.05], ["023-full", 824, 965, 100]]) {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const p = new Player({ x, y }); p.stamina = stamina;
        let prev = null, flips = 0, maxBobStep = 0, maxLeanStep = 0, maxBob = -Infinity, minBob = Infinity;
        const shots = [];
        for (let n = 0; n < 480; n++) {
            // Dry-ground control isolates locomotion from stochastic ice falls.
            // Cold/wet surface integration has separate tests and scene review.
            p.update(1 / 120, { x: dx, y: dy }, zone, { wantRun: true });
            const pose = posture(p);
            if (prev) {
                if (p.running !== prev.running) flips++;
                maxBobStep = Math.max(maxBobStep, Math.abs(pose.bob - prev.bob));
                maxLeanStep = Math.max(maxLeanStep, Math.abs(pose.lean - prev.lean));
            }
            minBob = Math.min(minBob, pose.bob); maxBob = Math.max(maxBob, pose.bob);
            prev = { running: p.running, bob: pose.bob, lean: pose.lean };
            if (n >= 60 && n < 156 && n % 8 === 0) shots.push({ ...p, phase: p.anim });
        }
        metrics.push({ note, direction: [dx, dy], flips, maxBobStep, maxLeanStep, bobRange: maxBob - minBob, end: [p.x, p.y] });
        if (dy === 1 && dx === 1) strips.push({ name: note, shots });
    }
}
fs.writeFileSync(path.join(out, "motion.json"), JSON.stringify(metrics, null, 2) + "\n");
console.log(JSON.stringify(metrics, null, 2));
if (!args.includes("--probe-only")) {
    const strip = (name, rows) => {
        const cw = 135, ch = 160, c = new ShimCanvas(rows[0].length * cw, rows.length * ch), ctx = c.getContext("2d");
        ctx.fillStyle = "#899781"; ctx.fillRect(0, 0, c.width, c.height);
        rows.forEach((row, y) => row.forEach((p, x) => {
            ctx.save(); ctx.translate(x * cw + cw / 2, y * ch + 136); ctx.scale(2.8, 2.8);
            drawCharacter(ctx, { ...p, tool: { id: "torch", tool: "torch" }, idleTime: x / 15 }); ctx.restore();
        }));
        fs.writeFileSync(path.join(out, name + ".png"), encodePNG(c));
    };
    for (const row of strips) strip("motion-" + row.name, [row.shots]);
    const duration = ATTACH.fallTime || 1.1;
    strip("falls-four-directions", ["left", "right", "up", "down"].map((dir) =>
        Array.from({ length: 12 }, (_, n) => ({ dir, fallTimer: Math.max(0, duration - n * duration / 11),
            fallDirX: dir === "left" ? -1 : dir === "right" ? 1 : 0,
            fallDirY: dir === "up" ? -1 : dir === "down" ? 1 : 0, gait: 1, runBlend: 1 }))));
}
