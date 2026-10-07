/** Regressions for field notes 2026-10-07: snow, rain aftermath and the dirt square. */
import { suite, test, assert, run } from "./tiny.js";
import { T } from "../js/world/tiles.js";
import { advanceWet, rainPuddle, surfaceTile, receivesSnow } from "../js/world/surface.js";
import { WeatherSystem } from "../js/world/weather.js";
import { GameClock } from "../js/core/time.js";
import { generateZone } from "../js/world/worldgen.js";
import { hashSeed } from "../js/core/rng.js";
import { groundWeights, paintProp, paintSnowGround, setSun } from "../js/render/tilesart.js";
import { drawWetGround } from "../js/render/surface.js";
import { ShimCanvas } from "../tools/canvas-shim.js";
import { noteMarkdown } from "../serve.js";
import { installDOM } from "./dom-harness.js";

suite("surface simulation");

test("rain accumulates, storm fills faster; bounded and independent of step size", () => {
    const wet = advanceWet(0, 20, "rain");
    assert.gt(wet, 0); assert.lt(wet, 1);
    assert.gt(advanceWet(0, 20, "storm"), wet);
    let split = 0;
    for (let i = 0; i < 20; i++) split = advanceWet(split, 1, "rain");
    assert.near(split, wet);
    assert.eq(advanceWet(0, 10000, "rain"), 1);
});

test("puddles remain after rain then dry; wind dries faster and cold slower", () => {
    const wet = advanceWet(1, 30, "clear");
    assert.gt(wet, 0); assert.lt(wet, 1);
    assert.lt(advanceWet(1, 30, "wind"), wet);
    assert.gt(advanceWet(1, 30, "clear", "winter"), wet);
    assert.eq(advanceWet(wet, 10000, "clear"), 0);
});

test("snow and fog are not liquid rainfall; bad inputs stay finite", () => {
    for (const weather of ["snow", "fog", "cloudy"]) assert.eq(advanceWet(0, 60, weather), 0);
    assert.eq(advanceWet(0.4, -5, "rain"), 0.4);
    assert.eq(advanceWet(0.4, NaN, "rain"), 0.4);
    assert.eq(advanceWet(NaN, 0, "rain"), 0);
});

test("wetness round-trips with weather; old and malformed saves load safely", () => {
    const w = new WeatherSystem({ clock: new GameClock() });
    w.current = "rain"; w.updateSurface(30);
    const loaded = new WeatherSystem().load(JSON.parse(JSON.stringify(w.toJSON())));
    assert.near(loaded.groundWet, w.groundWet);
    assert.eq(loaded.current, "rain");
    loaded.load({ current: "clear" }); assert.eq(loaded.groundWet, 0);
    loaded.load({ groundWet: 8 }); assert.eq(loaded.groundWet, 1);
    loaded.load({ groundWet: "bad" }); assert.eq(loaded.groundWet, 0);
});

test("footprints use snow, slush and wet soil, but not underground", () => {
    assert.eq(surfaceTile(T.ASH, "winter"), T.SNOW);
    assert.eq(surfaceTile(T.GRASS, "winter", 0.8), T.MUD);
    assert.eq(surfaceTile(T.PATH, "autumn", 0.8), T.MUD);
    assert.eq(surfaceTile(T.STONE, "winter", 0.8, true), T.STONE);
    assert.eq(surfaceTile(T.WATER, "winter"), T.WATER);
    assert.not(receivesSnow(T.CLIFF)); assert.not(receivesSnow(T.VOID));
});

test("puddles are seeded, grow in place and never cross a tile into water", () => {
    let count = 0;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
        const p = rainPuddle(x, y, T.ASH, 1);
        if (!p) continue;
        count++;
        assert.deep(p, rainPuddle(x, y, T.ASH, 1));
        const smaller = rainPuddle(x, y, T.ASH, 0.5);
        assert.eq(smaller.x, p.x); assert.eq(smaller.y, p.y);
        assert.lt(smaller.rx, p.rx); assert.lt(smaller.ry, p.ry);
        assert.gte(p.x - p.rx - 2, x * 32);
        assert.lte(p.x + p.rx + 2, (x + 1) * 32);
        assert.gte(p.y - p.ry - 1, y * 32);
        assert.lte(p.y + p.ry + 1, (y + 1) * 32);
    }
    assert.gt(count, 20); assert.lt(count, 150);
    for (const t of [T.WATER, T.DEEP, T.VOID, T.CLIFF, T.PLANK]) assert.eq(rainPuddle(1, 1, t, 1), null);
    assert.eq(rainPuddle(1, 1, T.ASH, 0), null);
});

suite("software renderer clipping");

const pixel = (cv, x, y) => [...cv.data.slice((y * cv.width + x) * 4, (y * cv.width + x) * 4 + 4)];

test("clip is transformed, nested and restored for fill, stroke, images and clear", () => {
    const cv = new ShimCanvas(24, 24), c = cv.getContext("2d");
    c.save(); c.translate(2, 2); c.beginPath(); c.rect(2, 2, 12, 12); c.clip();
    c.fillStyle = "white"; c.fillRect(-100, -100, 300, 300);
    assert.eq(pixel(cv, 3, 3)[3], 0); assert.eq(pixel(cv, 4, 4)[3], 255);
    c.save(); c.beginPath(); c.rect(8, 8, 20, 20); c.clip();
    c.fillStyle = "red"; c.fillRect(-100, -100, 300, 300);
    assert.deep(pixel(cv, 8, 8), [255, 255, 255, 255]);
    assert.deep(pixel(cv, 12, 12), [255, 0, 0, 255]);
    c.restore();
    c.strokeStyle = "red"; c.lineWidth = 8; c.beginPath(); c.moveTo(-10, 3); c.lineTo(30, 3); c.stroke();
    assert.eq(pixel(cv, 2, 5)[3], 0);
    const img = new ShimCanvas(2, 2); img.getContext("2d").fillRect(0, 0, 2, 2);
    c.drawImage(img, -5, -5, 30, 30);
    assert.eq(pixel(cv, 18, 18)[3], 0);
    c.clearRect(-100, -100, 300, 300);
    assert.eq(pixel(cv, 8, 8)[3], 0);
    c.restore(); c.fillStyle = "white"; c.fillRect(0, 0, 1, 1);
    assert.eq(pixel(cv, 0, 0)[3], 255);
});

test("empty clip paints nothing and does not survive restore", () => {
    const cv = new ShimCanvas(8, 8), c = cv.getContext("2d");
    c.save(); c.beginPath(); c.clip(); c.fillRect(0, 0, 8, 8);
    assert.eq(cv.data.reduce((a, b) => a + b, 0), 0);
    c.restore(); c.fillRect(0, 0, 8, 8); assert.eq(pixel(cv, 1, 1)[3], 255);
});

suite("visual regressions");

test("snow stays inside seeded stone silhouettes at different sizes, including ore and clusters", () => {
    setSun(12, 1);
    let snowyPixels = 0;
    for (let i = 0; i < 32; i++) {
        const obj = { kind: i % 2 ? "rock" : "ore_rock", ore: "copper", tx: 3 + i, ty: 7 + i * 2, size: 0.7 + (i % 4) * 0.3 };
        const images = ["summer", "winter"].map((season) => {
            const cv = new ShimCanvas(180, 150), c = cv.getContext("2d");
            c.translate(90, 100); c.scale(2, 2); paintProp(c, obj, 0, season); return cv;
        });
        for (let p = 0; p < images[0].data.length; p += 4) {
            const a = images[0].data, b = images[1].data;
            if (b[p] > a[p] + 30 && b[p + 1] > a[p + 1] + 30) {
                snowyPixels++;
                assert.eq(a[p + 3], 255, `floating snow: seed ${i}, pixel ${p / 4}`);
            }
        }
    }
    assert.gt(snowyPixels, 1000);
});

test("snow covers ash but never paints liquid or solid cave tiles", () => {
    for (const id of [T.WATER, T.DEEP, T.CLIFF, T.VOID]) {
        const cv = new ShimCanvas(32, 32);
        paintSnowGround(cv.getContext("2d"), id, 0, 0, 32, 18, 36);
        assert.eq(cv.data.reduce((a, b) => a + b, 0), 0);
    }
    const cv = new ShimCanvas(32, 32);
    paintSnowGround(cv.getContext("2d"), T.ASH, 0, 0, 32, 18, 36);
    assert.gt(pixel(cv, 16, 16)[3], 160);
});

test("winter herbs and flowers stay visible without their summer bloom", () => {
    for (const kind of ["flower", "herb"]) {
        const buffers = ["summer", "winter"].map((season) => {
            const cv = new ShimCanvas(80, 80), ctx = cv.getContext("2d");
            ctx.translate(40, 60); ctx.scale(2, 2);
            paintProp(ctx, { kind, tx: 4, ty: 5, x: 128, y: 160 }, 0, season);
            return cv.data;
        });
        assert.not(buffers[0].every((v, i) => v === buffers[1][i]));
        assert.gt(buffers[1].filter((v, i) => i % 4 === 3 && v > 0).length, 30);
    }
});

test("note 003 is four dirt tiles, now blended continuously on all four sides", () => {
    const zone = generateZone("ashfall", hashSeed("ashes-and-grain"));
    const map = zone.map;
    for (const [x, y] of [[18, 36], [19, 36], [18, 37], [19, 37]]) assert.eq(map.get(x, y), T.DIRT);
    const dirt = (wx, wy) => groundWeights(map, wx, wy).reduce((v, [t, w]) => v + (t === T.DIRT ? w : 0), 0);
    for (const [x, y, dx, dy] of [[576, 1184, 0.01, 0], [640, 1184, 0.01, 0], [608, 1152, 0, 0.01], [608, 1216, 0, 0.01]]) {
        assert.near(dirt(x - dx, y - dy), dirt(x + dx, y + dy), 0.002);
        const weights = groundWeights(map, x, y);
        assert.near(weights.reduce((v, [, w]) => v + w, 0), 1);
    }
});

test("wet layer persists in clear weather; disabled underground and when dry", () => {
    const zone = { map: { w: 8, h: 8, get: () => T.ASH }, objects: [] };
    const cam = { x: 0, y: 0, viewW: 256, viewH: 256, zoom: 1, worldToScreen: (x, y) => ({ x, y }) };
    const render = (wet, underground = false) => {
        const cv = new ShimCanvas(256, 256);
        drawWetGround(cv.getContext("2d"), cam, { zone, groundWet: wet, underground, weather: "clear" }, 1);
        return cv.data.reduce((a, b) => a + b, 0);
    };
    assert.gt(render(0.8), 0); assert.eq(render(0), 0); assert.eq(render(0.8, true), 0);
});

suite("live Game wiring");
const dom = installDOM();
const { Game } = await import("../js/main.js");
const boot = () => new Game({ canvas: dom.doc.getElementById("game"), hudRoot: dom.doc.getElementById("hud"), seed: "surface-test" });

test("dev season jump rebakes once, then reuses chunks; returning to spring rebakes", () => {
    const g = boot(); g.render();
    const before = g.renderer.stats.baked;
    g.clock.day = 85; g.render(); assert.gt(g.renderer.stats.baked, before);
    const winter = g.renderer.stats.baked;
    g.render(); g.render(); assert.eq(g.renderer.stats.baked, winter);
    g.clock.day = 1; g.render(); assert.gt(g.renderer.stats.baked, winter);
});

test("natural winter boundary and restored winter save both invalidate the palette", () => {
    const g = boot(); g.clock.day = 84; g.clock.minute = 1439; g.render();
    const autumn = g.renderer.stats.baked;
    g.clock.advanceMinutes(1); g.render(); assert.gt(g.renderer.stats.baked, autumn);
    const saved = g.save.snapshot();
    g.clock.day = 1; g.render(); const spring = g.renderer.stats.baked;
    g.save.restore(saved); g.render(); assert.gt(g.renderer.stats.baked, spring);
    assert.eq(g.renderer.season, "winter");
});

test("paused simulation and repeated rendering do not create water; sleep does", () => {
    const g = boot(); g.weather.current = "rain"; g.paused = true;
    g.update(10); g.render(); g.render(); assert.eq(g.weather.groundWet, 0);
    g.simulateMinutes(30, true); assert.gt(g.weather.groundWet, 0.5);
    const wet = g.weather.groundWet, baked = g.renderer.stats.baked;
    g.render(); g.render(); assert.eq(g.weather.groundWet, wet);
    assert.eq(g.renderer.stats.baked, baked);
    const saved = g.save.snapshot(); g.weather.groundWet = 0;
    g.save.restore(saved); assert.near(g.weather.groundWet, wet);
});

test("live footsteps use winter material and soak boots on rainy soil", () => {
    const g = boot(); g.paused = false;
    g.shelteredAt = () => false;
    g.player.update = () => { g.player.stepEvent = true; };
    g.clock.day = 85; g.weather.groundWet = 0; g.update(1 / 60);
    const winter = g.tracks.items.find((p) => p.alive);
    assert.ok(winter); assert.eq(winter.life, 34); assert.not(winter.wet);
    g.tracks.clear(); g.clock.day = 57; g.weather.groundWet = 0.85;
    g.update(1 / 60);
    assert.ok(g.tracks.items.find((p) => p.alive && p.wet));
    assert.gt(g.player.wet, 0);
});

test("winter cave uses a non-seasonal palette and no weather layer", () => {
    const g = boot(); g.clock.day = 85; g.weather.groundWet = 1; g.weather.current = "snow";
    g.enterZone("mine", null, true);
    let skies = 0; g.renderer.drawWeather = () => { skies++; };
    g.render(); assert.eq(g.renderer.season, "spring"); assert.eq(skies, 0);
});

test("note command keeps day, minute precision, numeric seed and moisture", () => {
    const text = noteMarkdown({ text: "test", zone: "ashfall", x: 785, y: 1122,
        day: 85, time: "19:01", season: "winter", weather: "snow", zoom: 2.4,
        groundWet: 0.73, seed: 12345 }, "");
    assert.ok(text.includes("--day 85")); assert.ok(text.includes("--hour 19.016666666666666"));
    assert.ok(text.includes("--wet 0.73")); assert.ok(text.includes("--seed 12345"));
    const legacy = noteMarkdown({ text: "old", zone: "ashfall", x: 1, y: 2, time: "bad" }, "");
    assert.ok(legacy.includes("--day 1 --hour 12")); assert.not(legacy.includes("NaN"));
});

await run("surface");
