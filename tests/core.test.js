/** v3 tests — core: RNG, noise, events, ECS, clock, save, loop. */
import { suite, test, assert, run } from "./tiny.js";
import * as cameraMod from "../js/engine/camera.js";
import * as serveMod from "../serve.js";
import { DEV } from "../js/dev/devtools.js";
import { Tracks, TRACK } from "../js/render/tracks.js";
import { MOVE, GAIT as gaitSpec } from "../js/render/charspec.js";
import { LIGHT, ambientAt } from "../js/render/lighting.js";
import { SUN, SHADOW, setSun, castShadow, setFireLights, setShadowOrigin, propHeight,
         ROCK, pick, rockOutline, BEND, setWalker, plantBend, BREEZE, setBreeze, windLean,
         ASH, PUDDLE, puddleGeom, loneWaterFloor, propTone, PATCH, SCREE, COAST, CORNER } from "../js/render/tilesart.js";
import { Renderer, OCCLUDE, CLOUDS, MIRROR, WATER } from "../js/render/renderer.js";
import { READ, PALETTE, BODY } from "../js/render/charspec.js";
import { moonFactor } from "../js/render/lighting.js";
import { Particles, FX, MATERIAL, materialOf } from "../js/render/particles.js";
import { RNG, hashSeed, mixSeeds, valueNoise2D, fbm2D } from "../js/core/rng.js";
import { EventBus } from "../js/core/events.js";
import { World } from "../js/core/ecs.js";
import { GameClock, SEASONS, MINUTES_PER_DAY } from "../js/core/time.js";
import { SaveManager, MemoryStorage, SAVE_VERSION } from "../js/core/save.js";
import { GameLoop } from "../js/core/loop.js";

suite("rng");

test("same seed produces the same stream", () => {
    const a = new RNG(1234), b = new RNG(1234);
    for (let i = 0; i < 50; i++) assert.eq(a.next(), b.next());
});

test("different seeds diverge", () => {
    const a = new RNG(1), b = new RNG(2);
    assert.ok(a.next() !== b.next());
});

test("values stay inside [0,1)", () => {
    const r = new RNG(7);
    for (let i = 0; i < 500; i++) {
        const v = r.next();
        assert.gte(v, 0); assert.lt(v, 1);
    }
});

test("int() respects inclusive bounds", () => {
    const r = new RNG(99);
    let min = 99, max = -1;
    for (let i = 0; i < 400; i++) {
        const v = r.int(2, 5);
        assert.ok(Number.isInteger(v));
        min = Math.min(min, v); max = Math.max(max, v);
    }
    assert.eq(min, 2); assert.eq(max, 5);
});

test("weighted() never returns a zero-weight entry", () => {
    const r = new RNG(5);
    for (let i = 0; i < 200; i++) assert.eq(r.weighted([["a", 1], ["b", 0]]), "a");
});

test("hashSeed is stable and mixSeeds is order-sensitive", () => {
    assert.eq(hashSeed("ashfall"), hashSeed("ashfall"));
    assert.ok(mixSeeds(1, 2) !== mixSeeds(2, 1));
});

test("value noise is deterministic and bounded", () => {
    for (let i = 0; i < 100; i++) {
        const v = valueNoise2D(42, i * 0.37, i * 0.11);
        assert.gte(v, 0); assert.lte(v, 1);
        assert.eq(v, valueNoise2D(42, i * 0.37, i * 0.11));
    }
});

test("fbm is smooth: neighbours differ only slightly", () => {
    let maxJump = 0;
    for (let x = 0; x < 60; x++) {
        const a = fbm2D(3, x, 10, { scale: 24 });
        const b = fbm2D(3, x + 1, 10, { scale: 24 });
        maxJump = Math.max(maxJump, Math.abs(a - b));
    }
    assert.lt(maxJump, 0.5, `noise jumps too hard: ${maxJump}`);
});

suite("events");

test("on/emit/off and once", () => {
    const bus = new EventBus();
    let n = 0;
    const off = bus.on("tick", () => n++);
    bus.emit("tick"); bus.emit("tick");
    assert.eq(n, 2);
    off();
    bus.emit("tick");
    assert.eq(n, 2);
    bus.once("boom", () => n += 10);
    bus.emit("boom"); bus.emit("boom");
    assert.eq(n, 12);
});

test("a throwing listener does not break the emit", () => {
    const bus = new EventBus();
    let reached = false;
    const origError = console.error; console.error = () => {};
    bus.on("x", () => { throw new Error("bad listener"); });
    bus.on("x", () => { reached = true; });
    bus.emit("x");
    console.error = origError;
    assert.ok(reached);
});

test("wildcard listener sees every event with its type", () => {
    const bus = new EventBus();
    const seen = [];
    bus.on("*", (p, type) => seen.push(type));
    bus.emit("a"); bus.emit("b");
    assert.deep(seen, ["a", "b"]);
});

suite("ecs");

test("spawn, query, tag lookup and kill/flush", () => {
    const w = new World();
    const tree = w.spawn({ x: 10, y: 10, hp: 3, tags: ["tree"] });
    w.spawn({ x: 50, y: 50, tags: ["tree"] });
    w.spawn({ x: 0, y: 0, tags: ["npc"], name: "Тихон" });
    assert.eq(w.byTag("tree").length, 2);
    assert.eq(w.query("hp").length, 1);
    assert.eq(w.nearest(12, 12, "tree", 40).id, tree.id);
    w.kill(tree);
    w.flush();
    assert.eq(w.byTag("tree").length, 1);
});

test("systems run in order and can mutate entities", () => {
    const w = new World();
    const e = w.spawn({ x: 0, vx: 5 });
    const order = [];
    w.addSystem("second", () => order.push(2), { order: 10 });
    w.addSystem("first", (world, dt) => {
        order.push(1);
        for (const ent of world.query("vx")) ent.x += ent.vx * dt;
    }, { order: 0 });
    w.tick(2);
    assert.deep(order, [1, 2]);
    assert.eq(e.x, 10);
});

test("serialise/restore keeps tags", () => {
    const w = new World();
    w.spawn({ x: 1, tags: ["a", "b"], fn: () => {} });
    const json = w.toJSON();
    const w2 = new World().load(json);
    assert.eq(w2.size, 1);
    assert.ok(w2.byTag("a").length === 1);
});

suite("clock");

test("minutes roll into days and emit events", () => {
    const bus = new EventBus();
    let days = 0, hours = 0;
    bus.on("time:newday", () => days++);
    bus.on("time:hour", () => hours++);
    const c = new GameClock({ bus, minute: 23 * 60 + 59, day: 1 });
    c.advanceMinutes(2);
    assert.eq(c.day, 2);
    assert.eq(days, 1);
    assert.gte(hours, 1);
});

test("real seconds convert to in-game minutes", () => {
    const c = new GameClock({ minute: 0, day: 1, realSecondsPerMinute: 0.5 });
    const passed = c.update(5);
    assert.eq(passed, 10);
    assert.eq(c.minute, 10);
});

test("daylight ramps from 0 at night to 1 at noon", () => {
    const c = new GameClock({ minute: 0 });
    assert.eq(c.daylight, 0);
    c.minute = 12 * 60;
    assert.eq(c.daylight, 1);
    c.minute = 5 * 60 + 30;
    assert.gt(c.daylight, 0); assert.lt(c.daylight, 1);
    assert.ok(c.isNight === false || c.minute < 300);
});

test("seasons advance every 28 days and wrap after a year", () => {
    const c = new GameClock({ day: 1 });
    assert.eq(c.season.key, "spring");
    c.day = 29; assert.eq(c.season.key, "summer");
    c.day = 85; assert.eq(c.season.key, "winter");
    c.day = 113; assert.eq(c.season.key, "spring");
    assert.eq(c.year, 2);
    assert.eq(SEASONS.length * 28, 112);
    assert.eq(MINUTES_PER_DAY, 1440);
});

suite("save");

test("round-trip through memory storage", () => {
    const storage = new MemoryStorage();
    const state = { gold: 10 };
    const sm = new SaveManager({ storage });
    sm.register("wallet", () => state, (d) => { state.gold = d.gold; });
    assert.ok(sm.write());
    state.gold = 999;
    assert.ok(sm.loadFromStorage());
    assert.eq(state.gold, 10);
    assert.eq(sm.read().version, SAVE_VERSION);
});

test("export/import as a string", () => {
    const a = { v: 1 };
    const sm = new SaveManager({ storage: new MemoryStorage() });
    sm.register("x", () => a, (d) => { a.v = d.v; });
    const str = sm.exportString();
    a.v = 42;
    sm.importString(str);
    assert.eq(a.v, 1);
});

test("corrupt save never throws", () => {
    const storage = new MemoryStorage();
    storage.setItem("minirpg_v3_save", "{not json");
    const sm = new SaveManager({ storage });
    assert.eq(sm.read(), null);
    assert.eq(sm.loadFromStorage(), false);
});

suite("loop");

test("fixed timestep: 1 second of frames = 60 ticks", () => {
    let ticks = 0, renders = 0;
    const loop = new GameLoop({ update: () => ticks++, render: () => renders++ });
    let t = 0;
    loop.lastTime = 0;
    for (let i = 0; i < 60; i++) { t += 1000 / 60; loop.advance(t); }
    // 59 or 60 depending on float accumulation — never fewer, never a spiral.
    assert.gte(ticks, 59);
    assert.lte(ticks, 60);
    assert.eq(renders, 60);
});

test("a long freeze does not spiral", () => {
    let ticks = 0;
    const loop = new GameLoop({ update: () => ticks++, render: () => {} });
    loop.lastTime = 0;
    loop.advance(10000);          // 10 second stall
    assert.lte(ticks, 8, "death spiral guard failed");
});

suite("light & fx");

test("the day curve is a 24-hour table with no visible steps", () => {
    assert.eq(LIGHT.lut.length, 24, "the table must cover every hour");
    for (let h = 0; h < 24; h++) {
        const a = LIGHT.lut[h], b = LIGHT.lut[(h + 1) % 24];
        assert.lte(Math.abs(b.a - a.a), 0.26, `hour ${h}→${h + 1} jumps too hard`);
    }
    // And the interpolation itself must be smooth: no step larger than the
    // hour gap divided over its minutes.
    let prev = ambientAt(0, "clear").alpha;
    for (let m = 1; m <= 24 * 60; m++) {
        const now = ambientAt(m / 60, "clear").alpha;
        assert.lte(Math.abs(now - prev), 0.01, `click at minute ${m}`);
        prev = now;
    }
});

test("noon is daylight, midnight is dark but never black", () => {
    assert.eq(ambientAt(12, "clear").alpha, 0, "midday must not be tinted at all");
    for (const h of [10, 11, 13, 14, 15, 16]) {
        assert.lte(ambientAt(h, "clear").alpha, 0.02, `${h}:00 should read as day`);
    }
    const night = ambientAt(0, "clear").alpha;
    assert.gte(night, 0.7, "night must actually be night");
    // The floor keeps a lit pixel above 14 % — a black screen is not a mood.
    assert.lt(Math.min(1 - LIGHT.floor, night), 0.9);
    assert.gte(LIGHT.floor, 0.1);
});

test("weather only ever adds darkness, and never past the floor", () => {
    for (const w of ["rain", "storm", "fog", "snow"]) {
        for (const h of [0, 6, 12, 19]) {
            const clear = ambientAt(h, "clear").alpha;
            const bad = ambientAt(h, w).alpha;
            assert.gte(bad, clear, `${w} at ${h}:00 should not brighten the world`);
            assert.lte(bad, 0.9, `${w} at ${h}:00 is past the floor`);
        }
    }
    assert.eq(ambientAt(3, "clear", true).alpha, LIGHT.underground.a, "caves use their own value");
});

test("the sun keeps every shadow in the lower right, all day", () => {
    // Props are shaded for a key light at the upper left at every hour. A
    // cast shadow that crossed to the other side in the evening would fight
    // the shading on the object throwing it.
    for (let h = 5; h <= 20.5; h += 0.25) {
        setSun(h, 1);
        assert.gte(SUN.dx, 0.15, `${h}:00 throws its shadow the wrong way`);
        assert.gt(SUN.dy, 0, `${h}:00 throws its shadow upwards`);
    }
});

test("shadows are long at the horizon, short at noon, gone at night", () => {
    setSun(12, 1);
    const noon = SUN.len;
    setSun(6.5, 1);
    const dawn = SUN.len;
    setSun(19, 1);
    const dusk = SUN.len;
    assert.lt(noon, dawn, "noon shadows must be the shortest");
    assert.lt(noon, dusk);
    assert.lte(noon, SHADOW.lenNoon + 0.02);
    for (const h of [0, 2, 4.4, 21, 23]) {
        setSun(h, 0);
        assert.lte(SUN.alpha, 0.04, `${h}:00 has sunlight`);
    }
});

test("the sun never jumps between one minute and the next", () => {
    let prev = null;
    for (let m = 0; m <= 24 * 60; m++) {
        const h = m / 60;
        setSun(h, h <= 4 || h >= 22 ? 0 : 1);
        const now = { dx: SUN.dx, dy: SUN.dy, len: SUN.len, alpha: SUN.alpha };
        if (prev) {
            assert.lte(Math.abs(now.dx - prev.dx), 0.02, `dx jumps at ${h}`);
            assert.lte(Math.abs(now.len - prev.len), 0.02, `length jumps at ${h}`);
            assert.lte(Math.abs(now.alpha - prev.alpha), 0.03, `strength jumps at ${h}`);
        }
        prev = now;
    }
});

/** A context that writes down the ellipses it is asked to draw. */
function recorder() {
    const shapes = [];
    return {
        shapes,
        fillStyle: "", globalAlpha: 1,
        save() {}, restore() {}, beginPath() {}, fill() {},
        ellipse(x, y, rx, ry) { shapes.push({ x, y, rx, ry }); }
    };
}

test("a fire throws every shadow away from itself", () => {
    setSun(1, 0);                       // night: the sun is out of the way
    setFireLights([{ x: 100, y: 100, r: 150, i: 1 }]);
    for (const [ox, oy] of [[140, 100], [60, 100], [100, 150], [100, 55]]) {
        setShadowOrigin(ox, oy);
        const c = recorder();
        castShadow(c, 10, 4, 1, 40, 0);
        assert.gt(c.shapes.length, 0, `no shadow at ${ox},${oy}`);
        const far = c.shapes[c.shapes.length - 1];
        assert.gte(Math.sign(far.x) * Math.sign(ox - 100), 0, "shadow falls towards the fire");
        if (oy !== 100) assert.gt(far.y * Math.sign(oy - 100), 0, "wrong side");
    }
    setFireLights([]);
});

test("firelight shadows are longer close in and gone far out", () => {
    setSun(1, 0);
    setFireLights([{ x: 0, y: 0, r: 120, i: 1 }]);
    const reach = (d) => {
        setShadowOrigin(d, 0);
        const c = recorder();
        castShadow(c, 10, 4, 1, 40, 0);
        return c.shapes.length ? c.shapes[c.shapes.length - 1].x : 0;
    };
    assert.gt(reach(20), reach(70), "a near object should throw the longer shadow");
    assert.eq(reach(130), 0, "nothing is lit beyond the fire's radius");
    setSun(12, 1);                      // noon washes firelight out
    setShadowOrigin(20, 0);
    const c = recorder();
    castShadow(c, 10, 4, 1, 40, 0);
    const sunward = c.shapes.every((sh) => sh.x >= 0);
    assert.ok(sunward, "at noon only the sun throws shadows");
    setFireLights([]);
});

test("every prop height is a number from one table", () => {
    assert.gt(propHeight("pine"), propHeight("bush"));
    assert.gt(propHeight("pine", 1.2), propHeight("pine", 1));
    assert.eq(propHeight("tent", 1.2), propHeight("tent", 1), "built things do not grow");
    assert.gt(propHeight("whatever_new_prop"), 0, "unknown props still get a height");
});

test("a tree in front of the hero steps out of the way, gently", () => {
    const occlude = Renderer.prototype._occlude;
    const hero = { x: 200, y: 200 };
    const pine = { kind: "pine", size: 1, x: 200, y: 214 };
    const first = occlude.call(null, pine, hero, 1 / 60);
    assert.gt(first, 0, "a pine covering the hero must start fading");
    assert.lt(first, 0.3, "and must not pop");
    for (let i = 0; i < 120; i++) occlude.call(null, pine, hero, 1 / 60);
    assert.gte(pine._fade, 0.95, "after a second it is fully faded");
    for (let i = 0; i < 180; i++) occlude.call(null, pine, hero, 1 / 60);
    const behind = { kind: "pine", size: 1, x: 200, y: 180 };
    occlude.call(null, behind, hero, 1 / 60);
    assert.eq(behind._fade, 0, "a tree the hero walks in front of stays solid");
    const bush = { kind: "bush", size: 1, x: 200, y: 214 };
    occlude.call(null, bush, hero, 1 / 60);
    assert.eq(bush._fade, 0, "short props hide nobody");
    const aside = { kind: "pine", size: 1, x: 200 + 50 * OCCLUDE.spread + OCCLUDE.bodyHalf + 1, y: 214 };
    occlude.call(null, aside, hero, 1 / 60);
    assert.eq(aside._fade, 0, "a pine beside the hero is not in the way");
});

test("a field of stones is a field of different stones", () => {
    const shape = (tx, ty) => rockOutline([], ROCK.radius, ROCK.radius * 0.8, 9,
                                          0.1, ROCK.jitter, tx, ty)
        .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("|");
    const seen = new Set();
    for (let tx = 0; tx < 8; tx++) for (let ty = 0; ty < 8; ty++) seen.add(shape(tx, ty));
    assert.eq(seen.size, 64, "two boulders share an outline");
    assert.eq(shape(3, 4), shape(3, 4), "the same tile must redraw identically");
});

test("stone archetypes and palettes come from a weighted table", () => {
    assert.eq(pick(ROCK.kinds, 0)[0], "boulder");
    assert.eq(pick(ROCK.kinds, 1)[0], "cluster");
    const tally = {};
    for (let i = 0; i < 1000; i++) {
        const k = pick(ROCK.kinds, i / 1000)[0];
        tally[k] = (tally[k] || 0) + 1;
    }
    assert.eq(Object.keys(tally).length, ROCK.kinds.length, "an archetype is unreachable");
    for (const [name, weight] of ROCK.kinds) {
        assert.near(tally[name] / 1000, weight / 100, 0.02, `${name} is mis-weighted`);
    }
    assert.gt(pick(ROCK.stone, 0.5)[1].length, 2, "a stone palette is an rgb triple");
});

test("the hero stays readable: seams, edges and far limbs", () => {
    // These are the numbers that keep a 60 px figure from turning into one
    // brown column; a regression here is invisible in a unit test otherwise.
    assert.gt(READ.legSeam, 0, "the legs need a seam between them");
    assert.lt(READ.legSeam, BODY.legGap + BODY.legW, "the seam must not eat a leg");
    assert.gt(READ.legSeamA, 0.2);
    assert.gt(READ.bootTopA, 0.2, "the boot needs a lit top edge");
    assert.gt(READ.footAOA, 0.2, "the boot needs a contact line");
    assert.lt(PALETTE.pantsFar, -30, "the far leg must be clearly darker");
    assert.lt(PALETTE.shirtFar, -30, "the far arm must be clearly darker");
    assert.lt(PALETTE.skinDeep, PALETTE.skinShade, "the far hand must be the darkest skin");
});

test("night is dark blue and legible, never a black screen", () => {
    const night = ambientAt(1, "clear");
    const noon = ambientAt(12, "clear");
    assert.gt(night.alpha, 0.8, "midnight must be dark");
    assert.lte(night.alpha, 0.9, "…but never opaque");
    assert.lt(night.rgb[0], night.rgb[2], "night tints blue, not brown");
    assert.near(noon.alpha, 0, 0.001, "noon is untouched daylight");
    assert.gt(LIGHT.floor, 0.1, "the darkest pixel keeps some of its colour");
    // Moonlight: paced by the phase, present even at a new moon, gone in a storm.
    const phases = [];
    for (let d = 0; d < LIGHT.moon.phaseDays; d++) phases.push(moonFactor(d));
    assert.gte(Math.min(...phases), LIGHT.moon.phaseFloor - 1e-9, "a new moon still glows");
    assert.near(Math.max(...phases), 1, 0.01, "a full moon reaches full strength");
    assert.lt(LIGHT.moon.cloud.storm, LIGHT.moon.cloud.clear, "clouds eat the moon");
    // Fires light a circle, they do not fog the valley.
    assert.lt(LIGHT.presets.campfire.r, 130);
    assert.lt(LIGHT.presets.torch.r, LIGHT.presets.campfire.r);
    assert.lt(LIGHT.halo.scale, 1, "the warm halo stays inside the lit circle");
});

test("particles never allocate once the pool is warm", () => {
    const fx = new Particles({ max: 64, maxTexts: 8 });
    const slots = new Set(fx.pool);
    for (let frame = 0; frame < 300; frame++) {
        fx.sparks(10, 10, 5);
        fx.smoke(10, 10, 2);
        fx.chips(10, 10, "#fff", 4);
        fx.dust(10, 10, 2);
        fx.leaves(10, 10, "#7fa24f", 3);
        fx.impact(10, 10, 6);
        fx.text(0, 0, "+1");
        fx.update(1 / 60);
    }
    assert.eq(fx.pool.length, 64, "the pool must not grow");
    assert.lte(fx.n, 64);
    for (const p of fx.pool) assert.ok(slots.has(p), "a particle object was replaced, not reused");
});

test("wind pushes smoke, not stone chips", () => {
    const fx = new Particles({ max: 32, maxTexts: 4 });
    fx.setWind(0, 1);                                  // straight east
    assert.near(fx.windX, 1, 1e-9);
    fx.smoke(0, 0, 1);
    const smoke = fx.pool[0];
    const vx0 = smoke.vx;
    fx.update(0.5);
    assert.gt(smoke.vx, vx0, "smoke is a sail");
    fx.clear();
    fx.chips(0, 0, "#fff", 1);
    const chip = fx.pool[0];
    const cvx = chip.vx;
    fx.update(0.5);
    assert.near(chip.vx, cvx, 1e-9, "a chip of stone ignores the breeze");
    assert.eq(FX.wind.chip, 0, "…and the contract says so");
});

test("material decides what flies off a struck prop", () => {
    assert.eq(materialOf("rock"), MATERIAL.stone);
    assert.eq(materialOf("ore_rock"), MATERIAL.stone);
    assert.eq(materialOf("ruin_wall"), MATERIAL.stone);
    assert.eq(materialOf("burnt_stump"), MATERIAL.ash);
    assert.eq(materialOf("bush"), MATERIAL.plant);
    assert.eq(materialOf("oak"), MATERIAL.wood, "anything unknown is wood");
    assert.ok(MATERIAL.plant.leaf, "only plants shed leaves");
    assert.eq(MATERIAL.stone.leaf, null);
    // Shake stays modest: a chop is not an earthquake.
    assert.lt(FX.shake.hit, FX.shake.fell);
    assert.lt(FX.shake.hit, 2);
});

test("dead particles are swapped out, not spliced", () => {
    const fx = new Particles({ max: 8, maxTexts: 4 });
    fx.spawn({ x: 1, y: 1, life: 0.05 });
    fx.spawn({ x: 2, y: 2, life: 10 });
    fx.update(0.1);
    assert.eq(fx.n, 1, "the dead one should be gone");
    assert.eq(fx.pool[0].x, 2, "the survivor moved into the free slot");
    assert.eq(fx.count, 1);
});


suite("camera");

test("the view leads a running hero and recentres when he stops", () => {
    const { Camera } = cameraMod;
    const cam = new Camera({ width: 320, height: 200, zoom: 1, deadzone: 0 });
    cam.snapTo(0, 0);
    for (let i = 0; i < 120; i++) cam.follow(0, 0, 1 / 60, 118, 0);
    assert.gt(cam.x + cam.viewW / 2, 4, "the camera never looked ahead");
    assert.lte(cam.x + cam.viewW / 2, Camera.LEAD.max + 0.001, "it ran away from the hero");
    for (let i = 0; i < 240; i++) cam.follow(0, 0, 1 / 60, 0, 0);
    assert.near(cam.x + cam.viewW / 2, 0, 0.5, "the lead never decayed");
    cam.motionScale = 0;                       // reduced motion: no lead either
    for (let i = 0; i < 120; i++) cam.follow(0, 0, 1 / 60, 118, 0);
    assert.near(cam.x + cam.viewW / 2, 0, 0.5);
});

test("reduced motion switches the camera shake off", () => {
    const { Camera } = cameraMod;
    const cam = new Camera({ width: 320, height: 200 });
    cam.shake(4, 0.3);
    assert.gt(cam.shakeTime, 0);
    cam.shakeTime = 0; cam.shakePower = 0;
    cam.motionScale = 0;
    cam.shake(4, 0.3);
    assert.eq(cam.shakeTime, 0);
    cam.update(1 / 60);
    assert.eq(cam.offsetX, 0);
    cam.followReducedMotion({});               // no matchMedia: must not throw
    assert.eq(cam.motionScale, 0);
});

suite("cloud shadows");

test("cloud shadows follow the weather and the sun", () => {
    // No sun under ground, none at night, strongest on an overcast day.
    assert.eq(CLOUDS.byWeather.fog, 0);
    assert.gt(CLOUDS.byWeather.cloudy, CLOUDS.byWeather.clear);
    assert.lt(CLOUDS.parallax, 1);                 // shadows must lag the ground
    assert.gt(CLOUDS.parallax, 0.5);
    assert.lte(CLOUDS.alpha, 0.25);                // a shadow, not a blackout
    assert.gte(CLOUDS.minDaylight, 0.2);
});

suite("plant bending");

test("plants lean away from the walker and spring back", () => {
    const plant = { x: 100, y: 100, tx: 3, ty: 3 };
    setWalker(100, 100, false);
    assert.eq(plantBend(plant, "grass_tuft", 0), 0);         // nobody near

    setWalker(94, 100, true);                                 // walker on the left
    const lean = plantBend(plant, "grass_tuft", 1);
    assert.gt(lean, 0);                                       // top goes right, away
    assert.lte(Math.abs(lean), BEND.maxLean);

    setWalker(0, 0, false);                                   // walker gone
    const after = plantBend(plant, "grass_tuft", 1 + BEND.releaseTau * 4);
    assert.lt(Math.abs(after), Math.abs(lean) * 0.2);         // sprang back

    setWalker(100, 100, true);
    assert.eq(plantBend({ x: 100, y: 100, tx: 1, ty: 1 }, "pine", 0), 0);   // trunks do not bend
    assert.eq(plantBend({ x: 100, y: 100, tx: 1, ty: 1 }, "rock", 0), 0);
});

test("the farther the walker the softer the push", () => {
    const near = { x: 100, y: 100 }, far = { x: 100 + BEND.radius * 0.8, y: 100 };
    setWalker(100 - 4, 100, true);
    const a = plantBend(near, "reed", 0);
    const b = plantBend(far, "reed", 0);
    assert.gt(Math.abs(a), Math.abs(b));
    setWalker(0, 0, false);
});

suite("dev server");

test("parseArgs reads flags, positionals and the environment", () => {
    const { parseArgs, SERVE } = serveMod;
    assert.eq(parseArgs([], {}).port, SERVE.port);
    assert.eq(parseArgs(["8080"], {}).port, 8080);
    assert.eq(parseArgs(["--port", "4100"], {}).port, 4100);
    assert.eq(parseArgs([], { PORT: "5050" }).port, 5050);
    assert.eq(parseArgs(["--host", "0.0.0.0"], {}).host, "0.0.0.0");
    assert.eq(parseArgs([], {}).reload, true);
    assert.eq(parseArgs(["--no-reload"], {}).reload, false);
    assert.eq(parseArgs(["--port", "4100"], { PORT: "5050" }).port, 4100);   // flag wins
});

suite("wind");

test("one wind field drives every plant", () => {
    setBreeze(0, 1.4);                                   // a storm blowing east
    const a = windLean(0, 0, 0);
    const b = windLean(0, 0, 0, BREEZE.treeScale);
    assert.lte(Math.abs(a), BREEZE.maxLean);
    assert.lt(Math.abs(b), Math.abs(a));                 // trunks give less than stems
    // The gust travels: two plants far apart are not at the same point of it.
    assert.not(Math.abs(windLean(0, 0, 0) - windLean(900, 0, 0)) < 1e-6);
    setBreeze(Math.PI, 1.4);                             // the other way round
    assert.lt(windLean(0, 0, 0) * a, 0);
    setBreeze(0, 0);
    assert.eq(windLean(0, 0, 0), 0);                     // dead calm, nothing moves
    setBreeze(0, 0.35);
});

test("a run flattens grass harder than a stroll", () => {
    const plant = { x: 100, y: 100 };
    setWalker(94, 100, true, 0);
    const slow = plantBend(plant, "grass_tuft", 0);
    const plant2 = { x: 100, y: 100 };
    setWalker(94, 100, true, BEND.runAt);
    const fast = plantBend(plant2, "grass_tuft", 0);
    assert.gt(fast, slow);
    assert.lte(fast, BEND.maxLean);
    setWalker(0, 0, false, 0);
});

suite("the burn and the puddles");

test("ash has warm and cold patches, not one grey", () => {
    // Scorched earth keeps the fire in it, cold ash goes blue: red minus blue
    // must point opposite ways for the two.
    assert.gt(ASH.scorch[0] - ASH.scorch[2], 40);
    assert.lt(ASH.coldAsh[0] - ASH.coldAsh[2], -20);
    assert.gt(ASH.washA, 0);
    assert.lt(ASH.washFrom, 1);
    assert.eq(ASH.cells, 8);
});

test("a lone tile of water is a puddle on the floor", () => {
    const W = 5, H = 5, floor = 4, water = 9;
    const data = new Uint8Array(W * H).fill(floor);
    data[2 * W + 2] = water;                              // one tile of water
    const map = { w: W, h: H, get: (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[y * W + x]) };
    assert.eq(loneWaterFloor(map, 2, 2), floor);          // it is a puddle, on dirt
    assert.eq(loneWaterFloor(map, 1, 1), -1);             // dry ground is not
    data[2 * W + 3] = water;                              // give it a neighbour
    assert.eq(loneWaterFloor(map, 2, 2), -1);             // now it is a pond

    const g = puddleGeom(3, 7, 32);
    assert.gt(g.rx, 0); assert.lt(g.rx, 32);              // the blob fits its tile
    assert.lt(g.ry, g.rx);                                // flattened by the 3/4 view
    assert.near(g.cx, 16, 32 * PUDDLE.offset + 0.01);
});

suite("fixed step");

test("the hero walks on a fixed step that divides every frame rate", () => {
    // 1/120 s is the step; 30, 60 and 120 FPS are all whole multiples of it,
    // which is what lets tools/replay.js hold them to the same pixel.
    for (const fps of [30, 60, 120]) {
        const steps = (1 / fps) / MOVE.step;
        assert.near(steps, Math.round(steps), 1e-12);
    }
    assert.gt(MOVE.maxCatchUp, MOVE.step * 4);   // a hitch is dropped, not replayed
    assert.lte(MOVE.maxCatchUp, 1);
});

suite("acceleration lean");

test("the torso leans into a start and hangs back on the brakes", () => {
    const GAIT = gaitSpec;
    assert.gt(GAIT.leanAccel, 0);
    assert.gt(GAIT.accelRef, 100);               // px/s², a real acceleration
    assert.lt(GAIT.leanAccel, 6);                // px — a hint, not a cartoon
});

suite("reflections and mist");

test("a reflection is shorter, dimmer and rougher than the thing it mirrors", () => {
    assert.lt(MIRROR.squash, 1);                 // shorter than the prop
    assert.lt(MIRROR.alpha, 0.5);                // never a mirror
    assert.lt(MIRROR.byWeather.storm, MIRROR.byWeather.clear);   // chop breaks it up
    assert.lt(MIRROR.barFill, 1);                // water shows between the bars
    assert.gt(MIRROR.gap, 0);
    assert.lt(MIRROR.gapFade, 1);                // standing back from the bank dims it
    assert.gt(MIRROR.minHeight, 0);
});

test("every prop has a colour its reflection can be made of", () => {
    for (const kind of ["pine", "oak", "palm", "rock", "reed", "crate", "tent"]) {
        const tone = propTone(kind);
        assert.ok(/^#[0-9a-f]{6}$/i.test(tone), `${kind} -> ${tone}`);
    }
    assert.not(propTone("pine") === propTone("rock"));
});

test("mist sits on the water at first light and burns off", () => {
    assert.lt(WATER.mistFrom, WATER.mistPeak);
    assert.lt(WATER.mistPeak, WATER.mistTo);
    assert.lte(WATER.mistTo, 12);                // gone well before noon
    assert.lt(WATER.mistA, 0.5);                 // a veil, not a wall
});

suite("no right angles");

test("the border between two grounds leaves the grid", () => {
    // The seam is displaced by up to most of a tile, so a patch boundary
    // cannot follow the 32 px grid even if the tiles do.
    assert.gt(PATCH.amp, 16);
    assert.lt(PATCH.amp, 32);
    assert.gt(PATCH.points, 4);                 // enough samples for a curve
    assert.gt(PATCH.slow, PATCH.fast);          // big meanders carry small ones
    assert.gt(SCREE.far, SCREE.near);           // rubble thins outward
    assert.lt(SCREE.farA, SCREE.nearA);
    assert.gt(COAST.tongue, 16);                // the bank reaches into water
    assert.gt(CORNER.dry, 1);                   // dry corners are bitten too
});

test("prints land under the boots, not below them", () => {
    // The world is seen at three quarters: a sideways offset on the ground
    // must cover less screen height than it does width.
    assert.lt(TRACK.vScale, 1);
    assert.gt(TRACK.vScale, 0.3);
    assert.eq(TRACK.footDrop, 0);
    const t = new Tracks();
    t.add(100, 100, 1, 0, 1, 8);                // walking east, right foot
    const p = t.items.find((q) => q.alive);
    assert.ok(p, "a print on sand");
    assert.lt(Math.abs(p.y - 100), TRACK.sideGap);   // squashed, not full offset
});

suite("notes from the game");

test("an area note keeps its size and points the scene tool at its middle", () => {
    const note = { text: "рамка вокруг пруда", kind: "area", zone: "shore", zoneName: "Берег",
                   x: 1200, y: 1400, w: 260, h: 180, day: 1, time: "14:00",
                   season: "spring", weather: "clear", zoom: 2.4, at: "2026-10-06T12:00:00.000Z" };
    const md = serveMod.noteMarkdown(note, "shot.png");
    assert.ok(md.includes("260×180"), "the size of the area");
    assert.ok(md.includes("--at 1330,1490"), "the scene tool aims at the middle");
    assert.ok(md.includes("тайлы 37,43"), "tiles, for looking at the map");
    assert.ok(md.includes("![кадр](shot.png)"));
    const point = serveMod.noteMarkdown({ ...note, kind: "point", w: 0, h: 0 }, "");
    assert.ok(point.includes("**точка:** x 1200"));
    assert.not(point.includes("область"));
});

test("a note file name is sortable, safe and says where it came from", () => {
    const stem = serveMod.noteStem({ text: "Вода у пруда — квадрат!", zone: "shore",
                                     at: "2026-10-06T12:00:00.000Z" }, 7);
    assert.ok(stem.startsWith("2026-10-06-007-shore-"), stem);
    assert.not(/[\s/\\:*?"<>|]/.test(stem), "no character a filesystem hates");
});

test("notes queue instead of raining files when there is no server", () => {
    assert.gt(DEV.queueMax, 10);           // a session of bug hunting fits
    assert.gt(DEV.shotMax, 600);           // the frame is still readable
    assert.gt(DEV.dragMin, 2);             // a click is not a tiny drag
    assert.ok(DEV.queueKey.startsWith("minirpg"));
});

run("v3 core");
