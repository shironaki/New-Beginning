/** Notes 004–013, exact numeric seed/context, plus daylight inspection views. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scenes = [
    ["004-fire-rain", "ashfall", "1107,1202", 85, 20.8, "rain", 1, "--light-fire"],
    ["005-hero", "ashfall", "1082,1262", 1, 17.95, "cloudy", 0],
    ["006-right-hand", "ashfall", "1088,1261", 1, 18 + 58 / 60, "cloudy", 0],
    ["007-cliff", "ashfall", "303,161", 1, 20 + 44 / 60, "cloudy", 0],
    ["008-coast", "shore", "2180,787", 1, 23 + 31 / 60, "cloudy", 0],
    ["009-sea-route", "shore", "2008,926", 1, 9 + 58 / 60, "cloudy", 0],
    ["010-coast-rain", "shore", "2348,1265", 1, 11 + 39 / 60, "rain", 1],
    ["011-relief-base", "ashfall", "175,819", 1, 13.2, "rain", 1],
    ["012-torch", "ashfall", "564,1051", 85, 2 + 11 / 60, "snow", 0.6252083333333386, "--torch"],
    ["013-ice", "ashfall", "848,887", 85, 15.5, "snow", 0.7964583333333349],
    ["014-cliff-noon", "ashfall", "303,161", 1, 12, "clear", 0],
    ["015-coast-noon", "shore", "2180,787", 1, 12, "clear", 0],
    ["016-fire-dry", "ashfall", "1107,1202", 1, 20.8, "clear", 0, "--light-fire"],
    ["017-fallen", "ashfall", "848,887", 85, 15.5, "snow", 0.7964583333333349, "--fallen", "--torch"],
    ["018-torch-left", "ashfall", "564,1051", 85, 2 + 11 / 60, "snow", 0.6252083333333386, "--torch", "--dir", "left"],
    ["019-torch-right", "ashfall", "564,1051", 85, 2 + 11 / 60, "snow", 0.6252083333333386, "--torch", "--dir", "right"],
    ["020-torch-back", "ashfall", "564,1051", 85, 2 + 11 / 60, "snow", 0.6252083333333386, "--torch", "--dir", "up"]
];
for (const [name, zone, at, day, hour, weather, wet, ...flags] of scenes) {
    execFileSync(process.execPath, ["tools/scene.js", "--zone", zone, "--at", at, "--day", String(day),
        "--hour", String(hour), "--weather", weather, "--wet", String(wet), "--zoom", "2.4", "--seed", "1066618561",
        "--out", `.artifacts/environment/${name}.png`, ...flags], { cwd: root, stdio: "inherit" });
}
execFileSync(process.execPath, ["tools/hero-sheet.js", "--torch"], { cwd: root, stdio: "inherit" });
