/** Bounded review for notes 014–019 and the relief prototype, not a 55-scene sweep. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
import { ReliefPatch, ReliefWalker } from "../js/world/relief.js";
import { drawRelief } from "../js/render/relief.js";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, ".artifacts/stage58"); fs.mkdirSync(out, { recursive: true });
const scene = (name, args) => execFileSync(process.execPath, ["tools/scene.js", ...args, "--out", path.join(out, name + ".png")], { cwd: root, stdio: "inherit" });
for (const file of fs.readdirSync(path.join(root, "docs/notes")).filter((f) => /^2026-10-07-01[4-9]-.*\.md$/.test(f)).sort()) {
    const num = file.split("-")[3];
    const text = fs.readFileSync(path.join(root, "docs/notes", file), "utf8");
    const args = text.match(/`node tools\/scene\.js ([^`]+)`/)[1].split(/\s+/);
    if (num === "018" || num === "019") args.push("--torch");
    scene(`${num}-context`, args);
    if (["014", "015", "016"].includes(num)) {
        const day = [...args]; day[day.indexOf("--hour") + 1] = "12"; day[day.indexOf("--weather") + 1] = "clear";
        scene(`${num}-daylight`, day);
    }
}
for (const t of [0.15, 0.41]) scene(`torch-night-${t}`, ["--zone", "ashfall", "--at", "1097,442", "--hour", "23", "--day", "85", "--weather", "snow", "--torch", "--dir", "left", "--pose-time", String(t), "--zoom", "3.5", "--seed", "1066618561"]);
scene("mountain-edge", ["--zone", "highland", "--at", "290,70", "--hour", "12", "--weather", "clear", "--zoom", "2.4", "--seed", "1066618561"]);
for (const [name, x, y] of [["relief-bottom", 408, 410], ["relief-top", 480, 230], ["relief-hill", 123, 230]]) {
    const patch = new ReliefPatch(), walker = new ReliefWalker(patch), c = new ShimCanvas(1000, 600);
    walker.x = x; walker.y = y; drawRelief(c.getContext("2d"), patch, walker, { guides: false });
    fs.writeFileSync(path.join(out, name + ".png"), encodePNG(c));
}
for (const flags of [[], ["--torch"]]) execFileSync(process.execPath, ["tools/hero-sheet.js", ...flags], { cwd: root, stdio: "inherit" });
console.log(`Bounded review → ${out}`);
