/**
 * tools/playtest.js — play the real game headlessly and report what breaks.
 *
 *   npm run play              the full sweep
 *   npm run play -- 3000      with a longer walk per zone (frames)
 *
 * This is not a test suite: tests pin behaviour we already decided on, this
 * walks the actual build around every zone with the actual input layer and
 * shouts about anything that looks wrong on screen or in the simulation.
 * Everything it checks is an INVARIANT a player would notice:
 *
 *   • nothing throws while updating or drawing a frame;
 *   • the hero never stands inside a solid tile, a prop or open water;
 *   • his position, needs and stamina stay finite and in range;
 *   • the same seed and the same keys give the same walk (determinism);
 *   • 30 fps and 60 fps cover the same ground (frame independence);
 *   • a lit fire burns down over minutes, not instantly;
 *   • a save round-trips.
 *
 * Zero dependencies: the software canvas from tools/canvas-shim.js and the
 * fake DOM from tests/dom-harness.js.
 */
import { ShimCanvas } from "./canvas-shim.js";
import { installDOM, key as sendKey } from "../tests/dom-harness.js";

const dom = installDOM();
const baseCreate = globalThis.document.createElement;
globalThis.document.createElement = (tag) =>
    (tag === "canvas" ? new ShimCanvas(300, 150) : baseCreate(tag));

const screen = new ShimCanvas(640, 384);
screen.addEventListener = () => {};
screen.style = {};
const hudRoot = globalThis.document.getElementById("hud");
globalThis.document.getElementById = (id) => (id === "game" ? screen : hudRoot);

const { Game } = await import("../js/main.js");
const { TILE_SIZE, tileInfo } = await import("../js/world/tiles.js");

const WALK = Number(process.argv[2]) || 1200;

const problems = [];
let checks = 0;
function fail(zone, what) {
    const key = `${zone}: ${what}`;
    if (!problems.includes(key)) problems.push(key);
}
function ok(cond, zone, what) { checks++; if (!cond) fail(zone, what); }

function newGame(seed = "ashes-and-grain") {
    const g = new Game({ canvas: screen, hudRoot, seed });
    g.hud.hideStory();
    g.paused = false;
    return g;
}

/** Drive the real input layer: press a key the way a keyboard does. */
function key(game, code, down) { sendKey(dom.win, code, down); }

const DIRS = ["KeyW", "KeyD", "KeyS", "KeyA"];

/** Walk around a zone, rendering every frame, and watch the invariants. */
function roam(game, zoneId, frames) {
    const dt = 1 / 60;
    let held = null;
    for (let i = 0; i < frames; i++) {
        if (i % 40 === 0) {
            if (held) key(game, held, false);
            held = DIRS[(i / 40 + zoneId.length) % DIRS.length | 0];
            key(game, held, true);
        }
        try {
            game.update(dt);
            game.render();
        } catch (e) {
            fail(zoneId, `кадр ${i} упал: ${e && e.message}`);
            break;
        }
        const p = game.player;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
            fail(zoneId, "координаты героя перестали быть числом");
            break;
        }
        // Natural boundaries are continuous now; test the same physical
        // point as the renderer/collider, not the old square authoring cell.
        const info = game.zone.map.infoAt(p.x, p.y);
        if (info.solid) fail(zoneId, `герой стоит в непроходимом тайле (${info.name})`);
        // Wading the shallows is allowed now; swimming is not.
        if (info.liquid && info.solid) fail(zoneId, `герой стоит в глубокой воде (${info.name})`);
        if (game.zone.propBlocksBody && game.zone.propBlocksBody(p.x, p.y, 9)) {
            fail(zoneId, "герой стоит внутри пропа");
        }
        const n = game.needs;
        if (n) {
            for (const k of ["hunger", "thirst", "energy", "warmth", "health"]) {
                if (n[k] === undefined) continue;
                if (!Number.isFinite(n[k]) || n[k] < -0.01 || n[k] > 100.01) {
                    fail(zoneId, `потребность ${k} вышла за 0..100 (${n[k]})`);
                }
            }
        }
        if (p.stamina !== undefined && (p.stamina < -0.01 || p.stamina > 100.01)) {
            fail(zoneId, `стамина вне 0..100 (${p.stamina})`);
        }
    }
    if (held) key(game, held, false);
    checks += frames;
}

/* ---------------------------------------------------------------- 1. zones */
const game = newGame();
const zoneIds = Array.from(game.world.defs ? game.world.defs.keys() : []).length
    ? Array.from(game.world.defs.keys())
    : ["ashfall", "meadow", "forest", "shore", "highland", "swamp", "road", "ruins", "sacred", "mine"];

for (const id of zoneIds) {
    let g;
    try {
        g = newGame();
        g.enterZone(id, null, true);
        // `enterZone` without an edge leaves the hero where he was: in a test
        // harness that means "inside the rock of the next zone". Put him on
        // the zone's own entry point before roaming.
        g.placeSafely(g.zone.spawn.x, g.zone.spawn.y);
    } catch (e) {
        fail(id, `зона не открывается: ${e && e.message}`);
        continue;
    }
    roam(g, id, WALK);
    // The hero must be able to reach the zone's own spawn point.
    const sp = g.zone.spawn;
    ok(sp && Number.isFinite(sp.x) && Number.isFinite(sp.y), id, "у зоны нет точки входа");
    if (sp) {
        const info = tileInfo(g.zone.map.get(Math.floor(sp.x / TILE_SIZE), Math.floor(sp.y / TILE_SIZE)));
        ok(!info.solid, id, `точка входа в непроходимом тайле (${info.name})`);
        ok(!info.liquid, id, `точка входа в воде (${info.name})`);
        ok(!g.zone.propBlocksBody(sp.x, sp.y, 9), id, "точка входа занята пропом");
    }
}

/* -------------------------------------------------- 2. day: every hour draws */
{
    const g = newGame();
    for (let hour = 0; hour < 24; hour++) {
        g.clock.minute = hour * 60;
        try {
            g.update(1 / 60);
            g.render();
        } catch (e) {
            fail("сутки", `${hour}:00 не рисуется: ${e && e.message}`);
        }
    }
    checks += 24;
}

/* ------------------------------------------------------ 3. determinism */
{
    const run = () => {
        const g = newGame();
        key(g, "KeyD", true);
        for (let i = 0; i < 300; i++) g.update(1 / 60);
        key(g, "KeyD", false);
        return `${g.player.x.toFixed(4)},${g.player.y.toFixed(4)}`;
    };
    ok(run() === run(), "движение", "один и тот же ввод даёт разный результат");
}

/* ------------------------------------------- 4. frame-rate independence */
{
    const walk = (dt, steps) => {
        const g = newGame();
        key(g, "KeyD", true);
        for (let i = 0; i < steps; i++) g.update(dt);
        key(g, "KeyD", false);
        return g.player.x - g.zone.spawn.x;
    };
    const at60 = walk(1 / 60, 300);
    const at30 = walk(1 / 30, 150);
    const at120 = walk(1 / 120, 600);
    const spread = Math.max(at60, at30, at120) - Math.min(at60, at30, at120);
    ok(spread < Math.abs(at60) * 0.06 + 1, "движение",
       `за 5 с пройдено по-разному: 30fps ${at30.toFixed(1)}, 60fps ${at60.toFixed(1)}, 120fps ${at120.toFixed(1)}`);
}

/* ------------------------------------------------------------ 5. the fire */
{
    const g = newGame();
    const fire = g.fires.values().next().value;
    if (!fire) {
        fail("костёр", "на старте нет ни одного кострища");
    } else {
        ok(fire.addFuel("firewood"), "костёр", "полено не кладётся в костёр");
        ok(fire.light({ hasFlint: true }), "костёр", "костёр не разжигается");
        const before = fire.fuel;
        // Five real seconds at the game's clock speed — a fire that cannot
        // survive that is a fire you spend the whole evening feeding.
        for (let i = 0; i < 60 * 5; i++) g.update(1 / 60);
        ok(fire.fuel < before, "костёр", "топливо не расходуется");
        ok(fire.lit, "костёр", "костёр потух за пять секунд с целым поленом");
        ok(fire.intensity > 0, "костёр", "горящий костёр без пламени");
        ok(fire.stack.length > 0, "костёр", "в кострище не видно топлива");
        ok(fire.stack[0].burn < 1, "костёр", "полено не обугливается на глазах");
        // And it must actually go out when there is nothing left to burn.
        for (let i = 0; i < 60 * 120; i++) g.update(1 / 60);
        ok(!fire.lit, "костёр", "костёр горит без топлива");
        ok(fire.ashes > 0, "костёр", "после прогорания не осталось золы");
    }
}

/* ------------------------------------------------------------ 6. the save */
{
    const g = newGame();
    key(g, "KeyD", true);
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    key(g, "KeyD", false);
    try {
        ok(g.save.write({ day: g.clock.day }), "сейв", "сохранение не записывается");
        const blob = g.save.read();
        ok(!!blob, "сейв", "сохранение не читается обратно");
        const g2 = newGame();
        ok(g2.save.restore(blob), "сейв", "сохранение не применяется");
        ok(Math.abs(g2.player.x - g.player.x) < 0.5 && Math.abs(g2.player.y - g.player.y) < 0.5,
           "сейв", `после загрузки герой стоит не там (${g2.player.x.toFixed(1)} вместо ${g.player.x.toFixed(1)})`);
        ok(g2.zone.id === g.zone.id, "сейв", "после загрузки другая зона");
        ok(Math.abs(g2.clock.minute - g.clock.minute) < 1, "сейв", "после загрузки другое время суток");
    } catch (e) {
        fail("сейв", `сохранение падает: ${e && e.message}`);
    }
}

/* ------------------------------------------------------------- report */
console.log(`\nПроверок: ${checks}`);
if (!problems.length) {
    console.log("✅ прогон чистый: ни одного нарушения");
} else {
    console.log(`❌ найдено ${problems.length}:`);
    for (const p of problems) console.log("   • " + p);
}
process.exit(problems.length ? 1 : 0);
