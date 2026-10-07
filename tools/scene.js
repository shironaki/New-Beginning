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
 *   --puddle           stand by the closest lone tile of water
 *   --shore            stand on a bank with water to the south
 *   --hour <0..24>     clock, fractional hours allowed        (default 12)
 *   --day <n>          day number — picks the season          (default 1)
 *   --weather <key>    clear|wind|cloudy|rain|storm|fog|snow  (default clear)
 *   --wet <0..1>      ground moisture (default 0; does not imply instant rain)
 *   --zoom <n>         camera zoom                            (default 2.6)
 *   --size WxH         canvas size                            (default 960x560)
 *   --frames <n>       frames to simulate before the shot     (default 8)
 *   --walk <dx,dy>     hold this input while simulating (prints, splashes)
 *   --dir <direction>  face down|up|left|right for attachment review
 *   --fallen           freeze a fallen pose after simulation
 *   --light-fire       light the closest campfire with a log
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
const seedArg = flag("seed", "ashes-and-grain");
const seed = /^\d+$/.test(String(seedArg)) ? Number(seedArg) : String(seedArg);
const game = new Game({ canvas: screen, hudRoot, seed });
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

// --puddle: stand next to the closest lone tile of water (mine puddles).
if (flag("puddle", false)) {
    const { TILES, TILE_SIZE } = await import("../js/world/tiles.js");
    const map = game.zone.map;
    const liquid = (x, y) => { const t = TILES[map.get(x, y)]; return !!(t && t.liquid); };
    let best = null, bd = Infinity;
    for (let y = 1; y < map.h - 1; y++) {
        for (let x = 1; x < map.w - 1; x++) {
            if (!liquid(x, y)) continue;
            if (liquid(x + 1, y) || liquid(x - 1, y) || liquid(x, y + 1) || liquid(x, y - 1)) continue;
            const wx = x * TILE_SIZE + 16, wy = y * TILE_SIZE + 16;
            const d = (wx - game.player.x) ** 2 + (wy - game.player.y) ** 2;
            if (d < bd) { bd = d; best = [wx, wy]; }
        }
    }
    if (!best) { console.error("no lone puddle in " + game.zone.id); process.exit(1); }
    console.error(`puddle at ${best[0]},${best[1]}`);
    game.placeSafely(best[0] - num("gap", 26), best[1] + 10);
}

// --shore: stand on the bank with water to the south (reflections, surf).
if (flag("shore", false)) {
    const { TILES, TILE_SIZE } = await import("../js/world/tiles.js");
    const map = game.zone.map;
    const liquid = (x, y) => { const t = TILES[map.get(x, y)]; return !!(t && t.liquid); };
    // A bank that reflects is one with something tall on it and water to the
    // SOUTH — in a 3/4 view a reflection falls towards the viewer.
    const { propHeight } = await import("../js/render/tilesart.js");
    let best = null, bh = 0;
    for (const o of game.zone.objects) {
        if (propHeight(o.kind, o.size || 1) < 20) continue;
        if (!liquid(o.tx, o.ty + 1) && !liquid(o.tx, o.ty + 2)) continue;
        const hgt = propHeight(o.kind, o.size || 1);
        if (hgt > bh) { bh = hgt; best = o; }
    }
    if (!best) { console.error("no reflecting bank in " + game.zone.id); process.exit(1); }
    game.placeSafely(best.x - num("gap", 40), best.y - 6);
}

const at = flag("at", null);
if (at && at !== true) {
    const [x, y] = String(at).split(",").map(Number);
    game.placeSafely(x, y);
}

game.clock.day = num("day", game.clock.day);
game.clock.minute = Math.min(1439, Math.round(Math.max(0, Math.min(24, num("hour", 12))) * 60));
const weather = flag("weather", null);
if (weather && weather !== true) game.weather.current = String(weather);
game.weather.groundWet = Math.max(0, Math.min(1, num("wet", 0)));

if (flag("torch", false)) {
    game.inventory.add("torch", 1);
    game.inventory.setActive(game.inventory.list().findIndex((s) => s.id === "torch"));
}
if (flag("light-fire", false)) {
    const fires = game.zone.objects.filter((o) => o.kind === "campfire" && !o.removed);
    fires.sort((a, b) => Math.hypot(a.x - game.player.x, a.y - game.player.y) - Math.hypot(b.x - game.player.x, b.y - game.player.y));
    if (fires[0]) {
        const f = game.fires.get(game.fireKey(game.zone, fires[0]));
        f.addFuel("log"); f.setExposure(game.fireEnvironment(game.zone, fires[0]));
        for (let i = 0; i < 6 && !f.lit; i++) f.light();
    }
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

const dir = flag("dir", null);
if (["down", "up", "left", "right"].includes(dir)) game.player.dir = dir;
if (flag("fallen", false)) game.player.fallTimer = 1;
game.camera.zoom = num("zoom", 2.6);
game.camera.snapTo(game.player.x, game.player.y - 8);
game.render();

fs.writeFileSync(OUT, encodePNG(screen));
console.log(`📸 ${game.zone.id}  день ${game.clock.day}, ${game.clock.clockString()}, `
    + `${game.weather.current}, zoom ${game.camera.zoom} → ${OUT}`);
