/** v3 tests — core: RNG, noise, events, ECS, clock, save, loop. */
import { suite, test, assert, run } from "./tiny.js";
import { LIGHT, ambientAt } from "../js/render/lighting.js";
import { Particles } from "../js/render/particles.js";
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

test("particles never allocate once the pool is warm", () => {
    const fx = new Particles({ max: 64, maxTexts: 8 });
    const slots = new Set(fx.pool);
    for (let frame = 0; frame < 300; frame++) {
        fx.sparks(10, 10, 5);
        fx.smoke(10, 10, 2);
        fx.chips(10, 10, "#fff", 4);
        fx.dust(10, 10, 2);
        fx.text(0, 0, "+1");
        fx.update(1 / 60);
    }
    assert.eq(fx.pool.length, 64, "the pool must not grow");
    assert.lte(fx.n, 64);
    for (const p of fx.pool) assert.ok(slots.has(p), "a particle object was replaced, not reused");
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

run("v3 core");
