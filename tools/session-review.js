/** Bounded stage-61 visual review; pure software Canvas, not browser acceptance. */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const out = ".artifacts/stage61"; fs.mkdirSync(out, { recursive: true });
const scenes = [
    ["relief-day", ["--relief", "--at", "466,260", "--light-fire"]],
    ["relief-night", ["--relief", "--at", "466,260", "--hour", "22", "--torch", "--light-fire"]],
    ["relief-rain", ["--relief", "--at", "408,332", "--hour", "18", "--weather", "rain", "--wet", "1", "--torch"]],
    ["relief-winter", ["--relief", "--at", "408,332", "--day", "86", "--hour", "9", "--weather", "snow", "--wet", "1", "--walk", "0,-1", "--frames", "60"]],
    ["relief-phone", ["--relief", "--size", "390x740", "--at", "466,260", "--hour", "22", "--torch", "--light-fire"]],
    ["main-021", ["--zone", "ashfall", "--at", "792,1079", "--seed", "1066618561", "--hour", "18.3", "--weather", "cloudy", "--walk", "1,1", "--run", "--frames", "25"]]
];
for (const [name, args] of scenes) execFileSync(process.execPath,
    ["tools/scene.js", ...args, "--out", `${out}/${name}.png`], { stdio: "inherit" });
