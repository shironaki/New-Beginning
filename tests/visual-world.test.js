/** Notes 014–019 and the isolated relief acceptance patch. */
import { suite, test, assert, run } from "./tiny.js";
import { generateZone } from "../js/world/worldgen.js";
import { T, tileInfo } from "../js/world/tiles.js";
import { TileMap } from "../js/world/tilemap.js";
import { TerrainField } from "../js/world/terrain.js";
import { coastDistances } from "../js/world/coast.js";
import { seaColour } from "../js/render/terrain.js";
import { PROPS, requiredTool, rollDrops } from "../js/sandbox/gather.js";
import { RNG } from "../js/core/rng.js";
import { torchFlame, paintTorchFlame } from "../js/render/torch.js";
import { toolAttachment, drawCharacter } from "../js/render/character.js";
import { ShimCanvas } from "../tools/canvas-shim.js";
import { ReliefPatch, ReliefWalker, RELIEF, RELIEF_PROPS } from "../js/world/relief.js";
import { reliefMesh, drawRelief } from "../js/render/relief.js";
import { BODY } from "../js/render/charspec.js";

suite("final coastline and beach");
test("every final coast, including the outer border, starts with shallows on 16 seeds", () => {
    for (const seed of [1066618561, ...Array.from({ length: 15 }, (_, i) => i + 1)]) {
        const z = generateZone("shore", seed), map = z.map;
        let coastal = 0, deep = 0;
        for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
            const id = map.get(x, y); if (id === T.DEEP) deep++;
            if (!tileInfo(id).liquid) continue;
            const land = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
                map.inBounds(x + dx, y + dy) && !tileInfo(map.get(x + dx, y + dy)).liquid);
            if (land) { coastal++; assert.eq(id, T.WATER, `${seed}/${x},${y}: sand to deep`); }
        }
        assert.gt(coastal, 20); assert.gt(deep, 100);
    }
});
test("signed coast distances cross zero at the shoreline, not at chunk edges", () => {
    const map = new TileMap(12, 8, T.DEEP); map.fillRect(0, 0, 4, 8, T.SAND);
    const distances = coastDistances(map);
    assert.eq(distances[4 * 12 + 3], -16); assert.eq(distances[4 * 12 + 4], 16);
    assert.eq(distances[4 * 12 + 5], 48);
    map.terrain = new TerrainField(map, 5, "shore");
    let last = -Infinity;
    for (let x = 64; x <= 250; x += 2) {
        const s = map.terrain.sample(x, 128); assert.gt(s.coast, last); last = s.coast;
    }
});
test("optical depth is continuous, bounded and independent of the solid/deep threshold", () => {
    let last = seaColour(0);
    for (let d = 0.25; d <= 220; d += 0.25) {
        const c = seaColour(d);
        c.forEach((v, i) => { assert.gte(v, 0); assert.lte(v, 255); assert.lt(Math.abs(v - last[i]), 1); });
        last = c;
    }
    assert.gt(seaColour(4)[1], seaColour(130)[1]);
    for (const d of [20, 52, 96, 180]) seaColour(d - 0.001).forEach((v, i) => assert.near(v, seaColour(d + 0.001)[i], 0.01));
});
test("editing the coast rebuilds distance data and invalidates distant affected chunks", () => {
    const map = new TileMap(48, 32, T.DEEP); map.fillRect(0, 0, 8, 32, T.SAND);
    const f = map.terrain = new TerrainField(map, 9, "shore");
    const a = f.sample(1000, 400).coast; map.dirtyChunks.clear(); map.set(31, 12, T.SAND);
    assert.lt(f.sample(1000, 400).coast, a);
    assert.eq(map.dirtyChunks.size, map.chunksX * map.chunksY);
});
test("all-water and all-land fields remain finite", () => {
    for (const id of [T.DEEP, T.SAND]) {
        const f = new TerrainField(new TileMap(6, 6, id), 3, "shore");
        for (const x of [1, 32, 95, 191]) assert.ok(Number.isFinite(f.sample(x, 30).coast));
    }
});
test("beaches generate no large rocks; pebbles keep stone/flint without a pickaxe", () => {
    for (const seed of [1, 5, 1066618561]) {
        const z = generateZone("shore", seed);
        assert.not(z.objects.some((o) => o.kind === "rock" || o.kind === "ore_rock"));
        const pebbles = z.objects.filter((o) => o.kind === "beach_pebbles"); assert.gt(pebbles.length, 0);
        for (const o of pebbles) assert.not(o.block > 0);
        assert.eq(requiredTool("beach_pebbles"), null);
    }
    for (let seed = 1; seed < 30; seed++) assert.deep(rollDrops({ kind: "beach_pebbles" }, new RNG(seed)), rollDrops({ kind: "rock" }, new RNG(seed)));
    assert.eq(PROPS.beach_pebbles.hits, 1);
    assert.ok(generateZone("highland", 1).objects.some((o) => o.kind === "rock"));
});

suite("living boundaries");
test("backdrop is deterministic and separate from harvestable objects / collision index", () => {
    const a = generateZone("ashfall", 1066618561), b = generateZone("ashfall", 1066618561);
    assert.deep(a.edgeScenery, b.edgeScenery); assert.gt(a.edgeScenery.length, 100);
    for (const o of a.edgeScenery) {
        assert.not(a.objects.includes(o)); assert.ok(a.map.solidAt(o.x, o.y));
        assert.not((a.solidIndex.get(`${o.tx},${o.ty}`) || []).includes(o));
    }
});
test("forest and mountain backdrops differ; beach and underground are not given trees", () => {
    assert.ok(generateZone("forest", 4).edgeScenery.some((o) => o.kind === "pine"));
    assert.ok(generateZone("highland", 4).edgeScenery.every((o) => o.kind === "rock"));
    assert.eq(generateZone("shore", 4).edgeScenery.length, 0);
    assert.eq(generateZone("mine", 4).edgeScenery.length, 0);
});
test("decorations stay out of portal approaches across all edge orientations", () => {
    for (const id of ["ashfall", "meadow", "forest", "highland", "pass"]) {
        const z = generateZone(id, 1066618561);
        for (const p of z.portals) for (const o of z.edgeScenery) {
            assert.not(o.x > p.x - 40 && o.x < p.x + p.w + 40 && o.y > p.y - 24 && o.y < p.y + p.h + 100);
        }
    }
});

suite("animated torch and human silhouette");
test("flame varies by absolute time and wind without an RNG/frame dependency", () => {
    const a = torchFlame(0.2), b = torchFlame(0.4);
    assert.not(a.height === b.height && a.width === b.width);
    assert.deep(torchFlame(1.5, 0.7, 1), torchFlame(1.5, 0.7, 1));
    assert.gt(torchFlame(1, 1).lean, torchFlame(1, -1).lean);
    for (let t = 0; t < 10; t += 0.03) {
        const f = torchFlame(t, 2, 1);
        assert.gt(f.height, 5); assert.lt(f.height, 10); assert.gt(f.intensity, 0.65); assert.lt(f.intensity, 0.9);
    }
});
test("flame pixels animate even with a stationary hand", () => {
    const image = (time) => {
        const c = new ShimCanvas(90, 100), ctx = c.getContext("2d");
        ctx.translate(40, 90); ctx.scale(3, 3); paintTorchFlame(ctx, time, 0.7);
        return c.data;
    };
    const a = image(0.15), b = image(0.41); let changed = 0;
    a.forEach((v, i) => { if (v !== b[i]) changed++; }); assert.gt(changed, 60);
});
test("animated flame light point remains on the sprite in four views and falling poses", () => {
    for (const dir of ["left", "right", "down", "up"]) for (const time of [0.12, 0.41, 1.08]) for (const fallTimer of [0, 1]) {
        const c = new ShimCanvas(240, 240), ctx = c.getContext("2d");
        const pose = { dir, idleTime: time, gait: 0.5, phase: 1, slant: 0.5, torchWind: 0.8, fallTimer, tool: "torch" };
        ctx.translate(110, 190); ctx.scale(3, 3); drawCharacter(ctx, pose);
        const p = toolAttachment(pose), x = 110 + p.x * 3, y = 190 + p.y * 3;
        let lit = 0;
        for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
            const i = (Math.round(y + dy) * c.width + Math.round(x + dx)) * 4;
            if (c.data[i] > 220 && c.data[i + 1] > 100 && c.data[i + 2] < 180 && c.data[i + 3] > 150) lit++;
        }
        assert.gt(lit, 2, `${dir}/${time}/${fallTimer}: detached flame light`);
    }
});
test("hero has a narrower head than shoulders and no leaking canvas transforms", () => {
    assert.lt(BODY.headW / BODY.shoulderW, 0.65);
    for (const dir of ["up", "down", "left", "right"]) {
        const c = new ShimCanvas(160, 160), ctx = c.getContext("2d");
        drawCharacter(ctx, { dir, look: { hairStyle: "long", stubble: false }, fallTimer: 1, tool: "torch" });
        ctx.fillStyle = "#ff0000"; ctx.fillRect(150, 150, 2, 2);
        assert.eq(c.data[(150 * 160 + 150) * 4], 255);
    }
});

test("the real game passes elapsed frame time to flames at 30/60/120 Hz", async () => {
    const { installDOM } = await import("./dom-harness.js");
    const saved = Object.fromEntries(["document", "window", "requestAnimationFrame", "localStorage"].map((k) => [k, globalThis[k]]));
    const dom = installDOM();
    try {
        const { Game } = await import("../js/main.js");
        for (const fps of [30, 60, 120]) {
            const g = new Game({ canvas: dom.doc.getElementById("game"), hudRoot: dom.doc.getElementById("hud"), seed: 1066618561 }); let time = 0;
            g.loop.update = () => {}; // inspect render clock, not simulation
            g.renderer.render = (_state, dt) => { time += dt; };
            for (let i = 1; i <= fps; i++) g.loop.advance(i * 1000 / fps);
            assert.near(time, 1, 1e-9);
        }
    } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
    }
});

suite("isolated relief patch");
test("projected feet and object bases use their actual terrain height", () => {
    const p = new ReliefPatch();
    assert.eq(p.heightAt(480, 180), RELIEF.platform); assert.eq(p.heightAt(50, 400), 0);
    for (const o of RELIEF_PROPS) {
        assert.eq(p.project(o.x, o.y).y, o.y * RELIEF.scaleY - p.heightAt(o.x, o.y));
    }
    assert.eq(p.heightAt(123, 230), 25);
});
test("ramp joins lower ground and terrace continuously at both ends", () => {
    const p = new ReliefPatch();
    assert.near(p.heightAt(408, 392 - 0.001), p.heightAt(408, 392 + 0.001), 0.001);
    assert.near(p.heightAt(408, 280 - 0.001), p.heightAt(408, 280 + 0.001), 0.001);
    for (let y = 300; y < 386; y += 1) assert.ok(p.canStand(408, y, 408, y + 0.5));
});
test("walker can climb ramp, reach terrace and walk down again", () => {
    const p = new ReliefPatch(), w = new ReliefWalker(p);
    for (let i = 0; i < 360; i++) w.update(1 / 60, { x: 0, y: -1 });
    assert.eq(p.heightAt(w.x, w.y), 44); assert.lt(w.y, 280);
    for (let i = 0; i < 480; i++) w.update(1 / 60, { x: 0, y: 1 });
    assert.eq(p.heightAt(w.x, w.y), 0); assert.gt(w.y, 392);
});
test("the separate hill is walkable without teleporting onto its crest", () => {
    const p = new ReliefPatch(), w = new ReliefWalker(p); w.x = 123; w.y = 355; let peak = 0;
    for (let i = 0; i < 240; i++) {
        w.update(1 / 60, { x: 0, y: -1 });
        peak = Math.max(peak, p.heightAt(w.x, w.y)); assert.ok(p.canStand(w.x, w.y));
    }
    assert.gt(peak, 24); assert.lt(w.y, 210);
});
test("cliff cannot be crossed either up or down and props retain their footprints", () => {
    const p = new ReliefPatch(), w = new ReliefWalker(p); w.x = 300; w.y = 330;
    for (let i = 0; i < 300; i++) w.update(1 / 60, { x: 0, y: -1 });
    assert.gt(w.y, 280 + RELIEF.radius); assert.eq(p.heightAt(w.x, w.y), 0);
    w.x = 300; w.y = 250;
    for (let i = 0; i < 300; i++) w.update(1 / 60, { x: 0, y: 1 });
    assert.lt(w.y, 280 - RELIEF.radius + 1); assert.eq(p.heightAt(w.x, w.y), 44);
    for (const o of RELIEF_PROPS.filter((o) => o.block)) assert.not(p.canStand(o.x, o.y));
});
test("a nearby item on a different level cannot be picked through the cliff", () => {
    const p = new ReliefPatch();
    assert.not(p.canReach({ x: 350, y: 289 }, { x: 350, y: 275 }));
    assert.ok(p.canReach({ x: 470, y: 254 }, { x: 464, y: 250 }));
});
test("relief movement is deterministic at 30/60/120 FPS", () => {
    const play = (fps) => {
        const w = new ReliefWalker();
        for (let i = 0; i < fps * 4; i++) w.update(1 / fps, { x: 0, y: -1 });
        return [w.x, w.y, w.phase, w.patch.heightAt(w.x, w.y)];
    };
    const a = play(30);
    for (const fps of [60, 120]) play(fps).forEach((v, i) => assert.near(v, a[i], 1e-7));
});
test("mesh and live objects render without NaNs or modifying the production world", () => {
    const p = new ReliefPatch(), w = new ReliefWalker(p), mesh = reliefMesh(p), c = new ShimCanvas(480, 320);
    for (const face of mesh) for (const v of face.points) assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
    drawRelief(c.getContext("2d"), p, w, { mesh });
    assert.gt(c.data.filter((v) => v > 0).length, 10000);
    const z = generateZone("ashfall", 1066618561);
    assert.not(z.terrain instanceof ReliefPatch);
});
await run("visual-world");
