/** Reproduce the three field notes and their seasonal/weather regressions. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scenes = [
    ["01-note-snow", "ashfall", "785,1122", 85, 19 + 1 / 60, "snow", 0],
    ["02-note-rain", "ashfall", "804,1104", 57, 20, "rain", 0.85],
    ["03-note-ground", "ashfall", "607,1190", 57, 20 + 28 / 60, "rain", 0],
    ["04-ground-noon", "ashfall", "607,1190", 57, 12, "clear", 0],
    ["05-winter-camp", "ashfall", "995,1110", 85, 12, "snow", 0],
    ["06-after-rain", "ashfall", "804,1104", 57, 12, "clear", 0.65],
    ["07-dried", "ashfall", "804,1104", 57, 12, "clear", 0],
    ["08-slush", "ashfall", "804,1104", 85, 12, "rain", 0.85],
    ["09-mine-winter", "mine", null, 85, 12, "snow", 1]
];
for (const [name, zone, at, day, hour, weather, wet] of scenes) {
    const args = ["tools/scene.js", "--zone", zone, "--day", String(day), "--hour", String(hour),
        "--weather", weather, "--wet", String(wet), "--zoom", "2.4", "--out", `.artifacts/surface/${name}.png`];
    if (at) args.push("--at", at);
    execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
}
