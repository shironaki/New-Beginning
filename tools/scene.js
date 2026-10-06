/**
 * tools/scene.js — render ONE arbitrary moment of the game to a PNG.
 *
 * `tools/screenshot.js` renders the fixed gallery of scenes we keep in the
 * repository. This is the other half: a free-form look at any zone, hour,
 * season or weather while working on a specific detail, without editing the
 * gallery and re-rendering 27 frames.
 *
 *   node tools/scene.js --zone mine --hour 2 --zoom 3.2 --torch
 *   node tools/scene.js --zone forest --day 90 --weather snow --out .artifacts/winter.png
 *   node tools/scene.js --list
 *
 * Flags
 *   --zone <id>        zone to enter (default: the starting valley)
 *   --at x,y           world position for the hero (default: the zone spawn)
 *   --near <kind>      stand next to the closest prop of that kind (--gap px)
 *   --hour <0..24>     clock, fractional hours allowed        (default 12)
 *   --day <n>          day number — picks the season          (default 1)
 *   --weather <key>    clear|wind|cloudy|rain|storm|fog|snow  (default clear)
 *   --zoom <n>         camera zoom                            (default 2.6)
 *   --size WxH         canvas size                            (default 960x560)
 *   --frames <n>       frames to simulate before the shot     (default 8)
 *   --walk <dx,dy>     hold this input while simulating (prints, splashes)
 *   --torch            put a lit torch in the hero's hand
 *   --hud              keep the interaction prompt visible
 *   --out <path>       output file (default .artifacts/scene.png)
 */
import fs from "node:fs";
import path from "node:path";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
import { installDOM } from "../tests/dom-harness.js";
import { ZONES } from "../js/world/regions.js";

const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
    const i = args.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = args[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
};
const num = (name, dflt) => {
    const v = flag(name, null);
    return v === null || v === true ? dflt : Number(v);
};

if (flag("list", false)) {
    for (const [id, z] of Object.entries(ZONES)) {
        console.log(`${id.padEnd(12)} ${(z.name || "").padEnd(18)} ${z.w}x${z.h}  ${z.biome}`);
    }
    process.exit(0);
}

const SIZE = String(flag("size", "960x560")).split("x").map(Number);
const OUT = String(flag("out", ".artifacts/scene.png"));
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });

// A DOM whose canvases are real (software) pixel buffers — same rig the
// gallery uses, so what you see here is what the gallery will show.
installDOM();
const baseCreate = globalThis.document.createElement;
globalThis.document.createElement = (tag) =>
    (tag === "canvas" ? new ShimCanvas(300, 150) : baseCreate(tag));

const screen = new ShimCanvas(SIZE[0] || 960, SIZE[1] || 560);
screen.addEventListener = () => {};
screen.style = {};
const hudRoot = globalThis.document.getElementById("hud");
globalThis.document.getElementById = (id) => (id === "game" ? screen : hudRoot);

const { Game } = await import("../js/main.js");
const game = new Game({ canvas: screen, hudRoot, seed: String(flag("seed", "ashes-and-grain")) });
game.hud.hideStory();
game.paused = false;

const zone = flag("zone", null);
if (zone && zone !== true) {
    game.enterZone(String(zone), null, true);
    game.placeSafely(game.zone.spawn.x, game.zone.spawn.y);
}

// --near <kind>: stand the hero right next to the closest prop of that kind,
// which is how you look at one plant, one stump or one fire up close.
const near = flag("near", null);
if (near && near !== true) {
    const want = String(near);
    let best = null, bd = Infinity;
    for (const o of game.zone.objects) {
        if (o.kind !== want) continue;
        const d = (o.x - game.player.x) ** 2 + (o.y - game.player.y) ** 2;
        if (d < bd) { bd = d; best = o; }
    }
    if (!best) { console.error(`no "${want}" in zone ${game.zone.id}`); process.exit(1); }
    game.placeSafely(best.x - num("gap", 11), best.y + 1);
}

const at = flag("at", null);
if (at && at !== true) {
    const [x, y] = String(at).split(",").map(Number);
    game.placeSafely(x, y);
}

game.clock.day = num("day", game.clock.day);
game.clock.minute = Math.max(0, Math.min(24, num("hour", 12))) * 60;
const weather = flag("weather", null);
if (weather && weather !== true) game.weather.current = String(weather);

if (flag("torch", false)) {
    game.inventory.add("torch", 1);
    game.inventory.setActive(game.inventory.list().findIndex((s) => s.id === "torch"));
}
if (!flag("hud", false)) game.findInteractable = () => null;

const walk = flag("walk", null);
if (walk && walk !== true) {
    const [dx, dy] = String(walk).split(",").map(Number);
    game.input.axis = () => ({ x: dx || 0, y: dy || 0 });
    game.input.pressed = () => false;
}

const frames = num("frames", 8);
for (let i = 0; i < frames; i++) { game.update(1 / 60); game.render(); }

game.camera.zoom = num("zoom", 2.6);
game.camera.snapTo(game.player.x, game.player.y - 8);
game.render();

fs.writeFileSync(OUT, encodePNG(screen));
console.log(`📸 ${game.zone.id}  день ${game.clock.day}, ${game.clock.clockString()}, `
    + `${game.weather.current}, zoom ${game.camera.zoom} → ${OUT}`);
