/** Integrated notes 004–013: shared terrain, hands/light, weather/fire and ice. */
import { createHash } from "node:crypto";
import { suite, test, assert, run } from "./tiny.js";
import { TerrainField } from "../js/world/terrain.js";
import { TileMap } from "../js/world/tilemap.js";
import { T, tileInfo } from "../js/world/tiles.js";
import { generateZone, Zone } from "../js/world/worldgen.js";
import { ZONES } from "../js/world/regions.js";
import { armRig, toolAttachment, drawCharacter } from "../js/render/character.js";
import { Campfire } from "../js/survival/campfire.js";
import { fireExposure } from "../js/survival/fire-weather.js";
import { Player } from "../js/entities/player.js";
import { EventBus } from "../js/core/events.js";
import { frozenPuddleAt, surfacePuddle, advanceWet } from "../js/world/surface.js";
import { ShimCanvas } from "../tools/canvas-shim.js";
import { installDOM } from "./dom-harness.js";

suite("continuous natural terrain");
test("coasts and cliffs use the same classifier as collision and material speed", () => {
    const map = new TileMap(6, 6, T.SAND);
    map.set(2, 2, T.DEEP); map.set(3, 3, T.CLIFF);
    map.terrain = new TerrainField(map, 33);
    let rounded = 0;
    for (let y = 40; y < 150; y += 2) for (let x = 40; x < 150; x += 2) {
        const s = map.terrain.sample(x, y), info = tileInfo(s.id);
        assert.eq(map.solidAt(x, y), info.solid);
        assert.eq(map.speedAt(x, y), info.speed);
        assert.eq(map.infoAt(x, y).liquid, info.liquid);
        if (s.id !== map.get(Math.floor(x / 32), Math.floor(y / 32))) rounded++;
    }
    assert.gt(rounded, 50, "still square raw-tile geometry");
});
test("water occupancy and ground weights are continuous across chunk seams", () => {
    const z = generateZone("shore", 1066618561);
    for (let x = 512; x < z.map.widthPx; x += 512) for (let y = 25; y < z.map.heightPx - 25; y += 13) {
        const a = z.terrain.sample(x - 0.001, y), b = z.terrain.sample(x + 0.001, y);
        assert.near(a.water, b.water, 0.001);
        assert.near(a.cliff, b.cliff, 0.001);
        assert.near(a.weights.reduce((v, [, w]) => v + w, 0), 1);
    }
});
test("built floors stay deliberately square and tile edits invalidate diagonal neighbours", () => {
    const map = new TileMap(48, 48, T.DEEP);
    map.terrain = new TerrainField(map, 1);
    map.set(15, 15, T.PLANK);
    assert.eq(map.at(15 * 32 + 1, 15 * 32 + 1), T.PLANK);
    map.dirtyChunks.clear(); map.set(15, 15, T.SAND);
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.ok(map.dirtyChunks.has(map.chunkKey(x, y)));
    assert.eq(map.at(15 * 32 + 16, 15 * 32 + 16), T.SAND);
});
test("sea route is removed at the note coordinate, land and objects survive", () => {
    const z = generateZone("shore", 1066618561);
    assert.eq(z.map.data.filter((t) => t === T.PLANK).length, 0);
    assert.ok(tileInfo(z.map.at(2008, 926)).liquid, "note 009 still has a road");
    assert.gt(z.map.data.filter((t) => !tileInfo(t).liquid).length, 500);
    assert.gt(z.objects.length, 100);
    assert.ok(z.objects.some((o) => o.kind === "firewood"));
    assert.ok(z.portals.length);
});
test("shore keeps all 321 original prop/loot payloads, including overseas supplies", () => {
    const z = generateZone("shore", 1066618561);
    const payload = z.objects.map(({ x, y, tx, ty, ...keep }) => keep);
    // Golden digest captured from unmodified 7503f9b, not the new generator.
    assert.eq(createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
        "04587bf9578fbfce8d707c06e9a4c0adae75080f95032c7129da537e2a832791");
    assert.eq(z.objects.length, 321);
    assert.ok(z.objects.some((o) => o.kind === "firewood" && o.x === 720 && o.y === 240 && o.amount === 3));
    assert.ok(z.objects.some((o) => o.kind === "herb" && o.x === 1040 && o.y === 496 && o.herbType === "yarrow"));
});
test("all zones / 16 seeds have shared geometry and safe spawn bodies", () => {
    for (let seed = 1; seed <= 16; seed++) for (const id of Object.keys(ZONES)) {
        const z = generateZone(id, seed);
        assert.eq(z.terrain, z.map.terrain);
        for (const [dx, dy] of [[0, 0], [9, 0], [-9, 0], [0, 9], [0, -9]]) {
            assert.not(z.solidAt(z.spawn.x + dx, z.spawn.y + dy), `${id}/${seed}: spawn body trapped`);
        }
    }
});
test("height field changes uphill movement, caves stay level", () => {
    const hill = new TerrainField(new TileMap(32, 32, T.STONE), 33, "highland");
    const cave = new TerrainField(hill.map, 33, "cave");
    let high = -Infinity, low = Infinity, climbs = 0;
    for (let y = 64; y < 900; y += 32) for (let x = 64; x < 900; x += 32) {
        const h = hill.elevation(x, y); high = Math.max(high, h); low = Math.min(low, h);
        if (hill.slope(x, y, 1, 0) < 0.96) climbs++;
        assert.eq(cave.elevation(x, y), 0); assert.eq(cave.slope(x, y, 1, 0), 1);
    }
    assert.gt(high - low, 40); assert.gt(climbs, 20);
});

suite("anatomical right hand and torch source");
test("handedness is not camera-near handedness in any direction", () => {
    assert.lt(armRig({ dir: "down" }).right.sx, 0);
    assert.gt(armRig({ dir: "up" }).right.sx, 0);
    assert.ok(armRig({ dir: "left" }).behind);
    assert.not(armRig({ dir: "right" }).behind);
    assert.ok(armRig({ dir: "up" }).behind);
    assert.not(armRig({ dir: "down" }).behind);
});
test("attachment follows gait, diagonal squash and action; every pose is finite", () => {
    for (const dir of ["down", "up", "left", "right"]) for (const phase of [0, 1, 2, 3, 4, 5]) {
        for (const fallTimer of [0, 1]) {
            const p = { dir, phase, gait: 1, runBlend: 1, slant: 0.7, actionTimer: 0.18, idleTime: 2, fallTimer };
            const a = toolAttachment(p);
            assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
            assert.gt(Math.hypot(a.x, a.y + 8), 6, "light is still at the player's centre");
        }
    }
});
test("software sprite flame lands at the shared light attachment in four views", () => {
    for (const dir of ["down", "up", "left", "right"]) {
        const cv = new ShimCanvas(160, 180), ctx = cv.getContext("2d");
        const p = { dir, tool: "torch", idleTime: 1, phase: 1, gait: 0.4, slant: 0.5 };
        ctx.translate(80, 155); ctx.scale(3, 3); drawCharacter(ctx, p);
        const a = toolAttachment(p), cx = 80 + a.x * 3, cy = 155 + a.y * 3;
        let flame = 0;
        for (let y = Math.floor(cy - 10); y <= cy + 10; y++) for (let x = Math.floor(cx - 10); x <= cx + 10; x++) {
            const i = (y * cv.width + x) * 4;
            if (cv.data[i] > 220 && cv.data[i + 1] > 100 && cv.data[i + 2] < 160 && cv.data[i + 3] > 150) flame++;
        }
        assert.gt(flame, 2, `${dir}: light not at visible flame`);
    }
});

suite("weather affects fire and cooking");
const fire = (environment = {}) => {
    const f = new Campfire(); f.addFuel("log"); f.addFuel("firewood"); f.setExposure(environment);
    for (let i = 0; i < 6 && !f.lit; i++) f.light();
    return f;
};
test("winter and precipitation require more ignition attempts, but no random lockout", () => {
    for (const env of [{ weather: "rain" }, { weather: "storm" }, { season: "winter" }]) {
        const f = new Campfire(); f.addFuel("firewood"); f.setExposure(env);
        assert.not(f.light()); assert.ok(f.lastFailure.includes("попытка"));
        for (let i = 0; i < 6 && !f.lit; i++) f.light();
        assert.ok(f.lit);
    }
    const f = new Campfire(); f.addFuel("firewood"); assert.ok(f.light());
});
test("roof/cave shelter removes precipitation penalties; missing flint still fails", () => {
    const e = fireExposure({ weather: "storm", season: "winter", sheltered: true });
    assert.eq(e.rain, 0); assert.eq(e.burn, 1); assert.eq(e.ignition, 1);
    const f = new Campfire(); f.addFuel("firewood"); f.setExposure({ weather: "storm" });
    for (let i = 0; i < 9; i++) assert.not(f.light({ hasFlint: false }));
    assert.eq(f.ignitionProgress, 0);
});
test("rain burns MORE fuel, produces LESS heat and cooks slower, not slower time", () => {
    const dry = fire(), rain = fire({ weather: "rain", season: "winter" });
    dry.putOnSpit("fish_raw"); rain.putOnSpit("fish_raw");
    dry.update(120); rain.update(120);
    assert.lt(rain.fuel, dry.fuel); assert.lt(rain.warmth, dry.warmth);
    assert.lt(rain.spit[0].progress, dry.spit[0].progress);
    assert.near(rain.flicker, dry.flicker);
});
test("rain extinguishes wet dying embers; fresh fuel dries the exposed pile", () => {
    const f = fire({ weather: "rain" }); f.damp = 0.9; f.fuel = 300;
    f.update(5); assert.not(f.lit); assert.gt(f.fuel, 0);
    const damp = f.damp; f.addFuel("log"); assert.lt(f.damp, damp);
    for (let i = 0; i < 6 && !f.lit; i++) f.light();
    f.update(60); assert.ok(f.lit);
});
test("sleep-sized fire updates match small substeps and save restores damp/ignition", () => {
    const a = fire({ weather: "storm", season: "winter" }), b = new Campfire().load(a.toJSON());
    b.setExposure({ weather: "storm", season: "winter" });
    a.update(600); for (let i = 0; i < 120; i++) b.update(5);
    assert.near(a.fuel, b.fuel); assert.near(a.damp, b.damp); assert.eq(a.lit, b.lit);
    a.extinguish(); a.light();
    const saved = new Campfire().load(JSON.parse(JSON.stringify(a.toJSON())));
    assert.near(saved.damp, a.damp); assert.eq(saved.ignitionProgress, a.ignitionProgress);
    const legacy = new Campfire().load({ fuel: 300, lit: true });
    assert.eq(legacy.damp, 0); assert.ok(Number.isFinite(legacy.intensity));
});
test("bad dt does not create fuel or hang the fire simulation", () => {
    const f = fire(), before = f.toJSON();
    for (const dt of [-3, NaN, Infinity, 0]) f.update(dt);
    assert.deep(f.toJSON(), before);
});

suite("frozen pools and recovery");
const emptyZone = () => new Zone({ id: "test", underground: false }, new TileMap(100, 60, T.ASH));
test("only rendered puddles freeze, not dry winter ground, roofed soil, cave or sea", () => {
    const z = emptyZone(); let p;
    for (let y = 3; y < 30 && !p; y++) for (let x = 3; x < 30 && !p; x++) p = surfacePuddle(z, x, y, 1);
    assert.ok(p); assert.ok(frozenPuddleAt(z, p.x, p.y, "winter", 1));
    assert.not(frozenPuddleAt(z, p.x + 16, p.y + 16, "winter", 1));
    assert.not(frozenPuddleAt(z, p.x, p.y, "spring", 1));
    assert.not(frozenPuddleAt(z, p.x, p.y, "winter", 0));
    z.def.underground = true; assert.not(frozenPuddleAt(z, p.x, p.y, "winter", 1)); z.def.underground = false;
    z.objects.push({ kind: "tent", x: p.x, y: p.y });
    assert.not(frozenPuddleAt(z, p.x, p.y, "winter", 1)); z.objects.length = 0;
    z.map.set(Math.floor(p.x / 32), Math.floor(p.y / 32), T.DEEP);
    assert.not(frozenPuddleAt(z, p.x, p.y, "winter", 1)); assert.ok(z.map.solidAt(p.x, p.y));
});
test("winter stores frozen moisture, thawed pools can dry in spring", () => {
    assert.eq(advanceWet(0.8, 5000, "clear", "winter"), 0.8);
    assert.eq(advanceWet(0.8, 5000, "clear", "spring"), 0);
});
test("walking is safe, running on ice can fall and recover without input lock", () => {
    const z = emptyZone(), bus = new EventBus(); let falls = 0;
    bus.on("player:slipped", () => falls++);
    const p = new Player({ x: 300, y: 300, bus }), opts = { surfaceAt: () => ({ ice: true }) };
    for (let i = 0; i < 180; i++) p.update(1 / 60, { x: 1, y: 0 }, z, opts);
    assert.eq(falls, 0);
    for (let i = 0; i < 300 && !falls; i++) p.update(1 / 60, { x: 1, y: 0 }, z, { ...opts, wantRun: true });
    assert.gt(falls, 0); assert.gt(p.fallTimer, 0);
    const x = p.x;
    for (let i = 0; i < 240; i++) p.update(1 / 60, { x: 1, y: 0 }, z, opts);
    assert.eq(p.fallTimer, 0); assert.gt(p.x, x + 30);
});
test("ice braking carries momentum but collisions still stop at walls", () => {
    const z = emptyZone(); for (let y = 0; y < 60; y++) z.map.set(14, y, T.CLIFF);
    const p = new Player({ x: 300, y: 300 }), opts = { surfaceAt: () => ({ ice: true }) };
    for (let i = 0; i < 60; i++) p.update(1 / 60, { x: 1, y: 0 }, z, opts);
    const x = p.x;
    for (let i = 0; i < 120; i++) p.update(1 / 60, { x: 0, y: 0 }, z, opts);
    assert.gt(p.x, x + 10); assert.lt(p.x, 14 * 32 - p.radius + 1);
});
test("slip RNG, falls, distance and recovery agree at 30/60/120 FPS", () => {
    const play = (fps) => {
        const z = emptyZone(), bus = new EventBus(); let falls = 0; bus.on("player:slipped", () => falls++);
        const p = new Player({ x: 900, y: 600, bus });
        for (let i = 0; i < fps * 15; i++) {
            const t = i / fps;
            p.update(1 / fps, { x: t < 6 ? 1 : t < 10 ? -1 : 0, y: t >= 10 ? 1 : 0 }, z,
                { wantRun: true, surfaceAt: () => ({ ice: true }) });
        }
        return [p.x, p.y, p.dist, p.fallTimer, p.slipChecks, falls];
    };
    const a = play(30); assert.gt(a[5], 0);
    for (const fps of [60, 120]) play(fps).forEach((v, i) => assert.near(v, a[i], 1e-7));
});
test("save during fall recovers; old player saves default to no fall", () => {
    const p = new Player(); p.fallTimer = 1; p.slipCooldown = 4; p.slipChecks = 12;
    const q = new Player().load(JSON.parse(JSON.stringify(p.toJSON())));
    for (let i = 0; i < 120; i++) q.update(1 / 60, { x: 0, y: 0 }, emptyZone());
    assert.eq(q.fallTimer, 0); assert.eq(q.slipChecks, 12);
    assert.eq(new Player().load({ x: 200, y: 200 }).fallTimer, 0);
    assert.eq(new Player().load({ fallTimer: Infinity, slipChecks: NaN }).fallTimer, 0);
});
test("software pixel writes obey Canvas raw-image semantics", () => {
    const cv = new ShimCanvas(4, 4), c = cv.getContext("2d"), image = c.createImageData(2, 2);
    image.data.fill(123); c.translate(10, 10); c.globalAlpha = 0; c.putImageData(image, 1, 1);
    assert.eq(cv.data[(1 * 4 + 1) * 4], 123); assert.eq(cv.data[0], 0);
});

suite("live game wiring");
const dom = installDOM();
const { Game } = await import("../js/main.js");
const boot = () => new Game({ canvas: dom.doc.getElementById("game"), hudRoot: dom.doc.getElementById("hud"), seed: 1066618561 });
test("all point-light consumers get the actual torch tip", () => {
    const g = boot(); g.inventory.add("torch", 1);
    for (const dir of ["down", "up", "left", "right"]) {
        g.player.dir = dir; g.player.anim = 1; g.player.gait = 0.7;
        const state = { zone: g.zone, player: g.player, playerLight: 120 };
        const lights = g.renderer._collectLights(state), a = toolAttachment({ ...g.player, phase: g.player.anim, idleTime: g.renderer.time });
        assert.near(lights[0].x, g.player.x + a.x); assert.near(lights[0].y, g.player.y + a.y);
    }
});
test("Game advances fires at true game-time with outdoor exposure, including sleep", () => {
    const dry = boot(), wet = boot(); dry.weather.current = "clear"; wet.weather.current = "rain";
    const ignite = (g) => {
        const o = g.zone.objects.find((x) => x.kind === "campfire");
        const f = g.fires.get(g.fireKey(g.zone, o)); f.addFuel("log"); f.light(); return f;
    };
    const a = ignite(dry), b = ignite(wet);
    dry.simulateMinutes(3, true); wet.simulateMinutes(3, true);
    assert.lt(b.fuel, a.fuel); assert.lt(b.intensity, a.intensity);
});
test("roofed and underground fire environments are independent of player's location", () => {
    const g = boot(); g.weather.current = "storm"; g.clock.day = 85;
    assert.ok(g.fireEnvironment(g.world.get("mine"), null).sheltered);
    assert.ok(g.fireEnvironment(g.zone, { sheltered: true }).sheltered);
    assert.not(g.fireEnvironment(g.zone, {}).sheltered);
});
await run("environment");
