/** Bounded note-020 review: four diagonals and the five guided lab milestones. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
import { ReliefWalker } from "../js/world/relief.js";
import { ReliefGuide } from "../js/dev/relief-guide.js";
import { drawRelief, reliefMesh } from "../js/render/relief.js";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), out = path.join(root, ".artifacts/stage59");
fs.mkdirSync(out, { recursive: true });
const scene = (name, args) => execFileSync(process.execPath, ["tools/scene.js", "--zone", "ashfall", "--at", "137,861", "--seed", "1066618561", "--zoom", "2.4", "--day", "1", ...args, "--out", path.join(out, name + ".png")], { cwd: root, stdio: "inherit" });
scene("020-context", ["--hour", "19.916666666666668", "--weather", "cloudy"]);
for (const [name, dir] of [["nw", "-1,-1"], ["ne", "1,-1"], ["sw", "-1,1"], ["se", "1,1"]])
    scene(`020-run-${name}`, ["--hour", "12", "--weather", "clear", "--walk", dir, "--run", "--frames", "25", "--stamina", "6.05"]);
for (const flags of [[], ["--torch"]]) execFileSync(process.execPath, ["tools/hero-sheet.js", "--diagonal", ...flags], { cwd: root, stdio: "inherit" });
const w = new ReliefWalker(), g = new ReliefGuide(), mesh = reliefMesh(w.patch); g.demo = true;
let last = -1;
for (let i = 0; i < 25 * 60; i++) {
    w.update(1 / 60, g.demoInput(w)); g.observe(w);
    if (g.step !== last) {
        const c = new ShimCanvas(1000, 600); drawRelief(c.getContext("2d"), w.patch, w, { mesh, collected: g.collected, routeStep: g.step });
        fs.writeFileSync(path.join(out, `relief-step-${g.step}.png`), encodePNG(c)); last = g.step;
    }
    if (g.complete) break;
}
if (!g.complete) throw new Error("Relief demonstration failed to finish");
console.log(`Motion/guide review → ${out}`);
