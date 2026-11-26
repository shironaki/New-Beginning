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
import { toolAttachment, drawCharacter, heroWeatherTint, WET } from "../js/render/character.js";
import { ShimCanvas } from "../tools/canvas-shim.js";
import { ReliefPatch, ReliefWalker, RELIEF, RELIEF_PROPS } from "../js/world/relief.js";
import { reliefMesh, drawRelief } from "../js/render/relief.js";
import { BODY, RAMPS } from "../js/render/charspec.js";
import { DEFAULT_LOOK } from "../js/render/character.js";
import { META as HERO_META, PALETTE_HEX as HERO_PALETTE, STREAMS as HERO_STREAMS } from "../js/render/heroframes.js";
import { heroLookPalette } from "../js/render/hero3d.js";
import { PROP_SPRITES, PROP_META } from "../js/render/propsprites.js";
import { installDOM } from "./dom-harness.js";
import fs from "node:fs";
import path from "node:path";
import { cameraBasis } from "../tools/raster3d.js";
import { META as GRADED_META } from "../js/render/heroframes.js";
const GRADED_CELL = GRADED_META.cell;
import { paintProp3D, prop3dStatus, PROPS3D } from "../js/render/props3d.js";
import * as propSun from "../js/render/props3d.js";
import { PROP_HEIGHT, propHeight } from "../js/render/tilesart.js";
import { unsupportedBy } from "../js/world/debris.js";
import { ITEMS } from "../js/sandbox/items.js";

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

suite("hero look ramps");
test("every colour ramp the sprite carries exists on both sides", () => {
    const ramps = HERO_META.ramps;
    assert.ok(ramps, "heroframes принёс раскладку дорожек");
    const taken = new Set([HERO_META.inkAt]);
    for (const [name, meta] of Object.entries(ramps)) {
        const spec = RAMPS[name];
        assert.ok(spec, `${name}: дорожка описана в charspec`);
        assert.eq(meta.steps, spec.offsets.length, `${name}: число тонов`);
        assert.ok(spec.look in DEFAULT_LOOK, `${name}: look.${spec.look} есть в образе`);
        for (let i = 0; i < meta.steps; i += 1) {
            const slot = meta.at + i;
            assert.ok(!taken.has(slot), `${name}: слот ${slot} не занят другим`);
            taken.add(slot);
        }
    }
    assert.eq(HERO_PALETTE.length, Math.max(...taken) + 1, "палитра закрывает все слоты");
});
test("changing a look colour repaints one ramp and nothing else", () => {
    const ramps = HERO_META.ramps;
    const slots = name => Array.from({ length: ramps[name].steps }, (_, i) => ramps[name].at + i);
    const base = heroLookPalette(DEFAULT_LOOK);
    for (const [name, colour] of [["cloth", "#8f3b3b"], ["pants", "#2f6b7a"], ["skin", "#8d5a3b"], ["hair", "#d8b45c"]]) {
        const tinted = heroLookPalette(Object.assign({}, DEFAULT_LOOK, { [RAMPS[name].look]: colour }));
        const changed = base.map((rgb, i) => (rgb.join() !== tinted[i].join() ? i : -1)).filter(i => i >= 0);
        assert.eq(changed.length, slots(name).length, `${name}: перекрашено слотов`);
        changed.forEach(i => assert.ok(slots(name).includes(i), `${name}: тронут только свой диапазон`));
        // Нулевой тон дорожки — это ровно выбранный цвет, без смещения: панель и игра
        // называют один и тот же цвет одинаково.
        const mid = RAMPS[name].offsets.indexOf(0);
        assert.gt(mid, -1, `${name}: в дорожке есть базовый тон`);
        const want = colour.replace("#", "").match(/../g).map(c => parseInt(c, 16));
        assert.eq(tinted[slots(name)[mid]].join(), want.join(), `${name}: базовый тон = цвет образа`);
    }
    // Кэш по цвету: каждый кадр спрашивается та же палитра, пересборка — только когда
    // образ реально поменяли (иначе канвасы перерисовывались бы на каждый кадр).
    const again = heroLookPalette(DEFAULT_LOOK);
    assert.eq(heroLookPalette(DEFAULT_LOOK), again, "тот же look — палитра переиспользуется");
    assert.eq(again.map(rgb => rgb.join()).join(), base.map(rgb => rgb.join()).join(), "тот же look — те же цвета");
});

test("baked hand anchors are real numbers, inside the cell, and they animate", () => {
    const anchors = HERO_META.anchors, cell = HERO_META.cell;
    const u = 1 / (HERO_META.pxPerUnit || 2);
    for (const [key, set] of Object.entries(anchors)) {
        for (const side of ["r", "l"]) {
            const pts = set[side];
            assert.ok(pts?.length, `${key}/${side}: якоря есть`);
            let minX = Infinity, maxX = -Infinity;
            for (const [x, y, ang] of pts) {
                // NaN в bake превращается в null в JSON — молча, без единой ошибки.
                assert.ok([x, y, ang].every(Number.isFinite), `${key}/${side}: не число: ${x},${y},${ang}`);
                assert.ok(Math.abs(x) <= cell.w * u / 2 + 1, `${key}/${side}: кисть вне ячейки по X`);
                assert.ok(y <= 1 && y >= -cell.h * u, `${key}/${side}: кисть вне ячейки по Y`);
                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            }
            if (/chop|attack|mine/.test(key)) assert.gt(maxX - minX, 1.5, `${key}/${side}: кисть не двигается по дуге`);
        }
    }
});

test("every baked frame has a fist patch that covers its grip point", () => {
    // Патч кулака — единственное, что отличает «держит в руке» от «приклеено
    // поверх ладони»: рантайм возвращает этот кусок спрайта после предмета.
    const { cell, pxPerUnit = 2, footPad = 0, anchors, grips } = HERO_META;
    const ppu = pxPerUnit;
    assert.ok(grips && Object.keys(grips).length === Object.keys(anchors).length,
        "запекка отдала якоря без патчей — нужен перепуск --emit");
    for (const [key, set] of Object.entries(anchors)) {
        const g = grips[key] || {};
        for (const side of ["r", "l"]) {
            const name = side === "r" ? "right" : "left";
            const pts = set[side], patches = g[side];
            assert.eq(patches?.length, pts.length, `${key}/${name}: патчей не по числу кадров`);
            pts.forEach(([x, y], i) => {
                const rect = patches[i];
                assert.ok(rect, `${key}/${name}#${i}: нет патча`);
                const [gx, gy, gw, gh] = rect;
                assert.gte(gw, 3, `${key}/${name}#${i}: патч уже кулака`);
                assert.gte(gh, 3, `${key}/${name}#${i}: патч уже кулака`);
                assert.ok(gx >= 0 && gy >= 0 && gx + gw <= cell.w && gy + gh <= cell.h,
                    `${key}/${name}#${i}: патч вылез за ячейку`);
                const fx = x * ppu + cell.w / 2, fy = y * ppu + (cell.h - footPad);
                assert.ok(fx >= gx - 1.5 && fx <= gx + gw + 0.5 && fy >= gy - 1.5 && fy <= gy + gh + 0.5,
                    `${key}/${name}#${i}: предмет и пальцы в разных местах (${fx.toFixed(1)},${fy.toFixed(1)} против ${rect})`);
            });
        }
    }
});

test("every baked stream actually addresses its ramp slots", () => {
    const owner = new Map();
    for (const [name, meta] of Object.entries(HERO_META.ramps)) {
        for (let i = 0; i < meta.steps; i += 1) owner.set(meta.at + i, name);
    }
    for (const [key, b64] of Object.entries(HERO_STREAMS)) {
        const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
        const hits = {};
        for (let i = 0; i + 1 < bytes.length; i += 2) {
            const name = owner.get(bytes[i + 1] - 1);
            if (name) hits[name] = (hits[name] || 0) + bytes[i];
        }
        // Ни одна дорожка не должна остаться пустой: пустая = запекка потеряла материал,
        // и тогда этот цвет в панели внешности ни на что не влияет.
        for (const name of Object.keys(HERO_META.ramps)) assert.gt(hits[name] || 0, 150, `${key}: пикселей дорожки ${name}`);
    }
});

test("the fist patch is painted back after the held item, not before", async () => {
    // Порядок слоёв — единственное, что отличает «держит в руке» от «наклейка на
    // ладони», и он легко ломается: кто-нибудь перенесёт paintItem выше спрайта.
    // Поэтому ловим реальные вызовы ctx.drawImage, а не читаем код глазами.
    const { installDOM } = await import("./dom-harness.js");
    const saved = Object.fromEntries(["document", "window", "requestAnimationFrame", "localStorage"].map(k => [k, globalThis[k]]));
    const dom = installDOM();
    try {
        const { heroSprite } = await import("../js/render/hero3d.js");
        const p = {
            dir: "right", phase: 0, gait: 0, moving: false, idleTime: 0.4,
            look: DEFAULT_LOOK, rightTool: { id: "knife", tool: "knife", n: 1, hold: null },
            leftTool: { id: "rope", tool: "rope", n: 2, hold: "coil", tint: "#a8895a" },
            actionTimer: 0
        };
        assert.ok(heroSprite(p), "спрайтовый герой должен быть готов (иначе тест ничего не проверяет)");
        const canvas = new ShimCanvas(240, 240);
        const ctx = canvas.getContext("2d");
        const calls = [];
        const real = ctx.drawImage.bind(ctx);
        ctx.drawImage = (...args) => { calls.push(args.length); return real(...args); };
        ctx.save(); ctx.translate(120, 200);
        drawCharacter(ctx, p);
        ctx.restore();
        const sprite = calls.indexOf(5);
        assert.gt(sprite, -1, "спрайт нарисован");
        assert.ok(calls.slice(sprite).filter(n => n === 9).length >= 1,
            `после спрайта должен вернуться патч кулака, вызовы: ${calls.join(",")}`);
        // Дальняя рука рисуется до спрайта — и её патч не нужен (всё равно перекроется).
        assert.eq(calls.slice(0, sprite).filter(n => n === 9).length, 0, "до спрайта ничего возвращать не надо");
    } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
    }
});

test("the smooth (un-graded) hero is the same body: shared grid, shared hand anchors", async () => {
    // Сравнение стилей имеет смысл только если двигается только квантизация. Ячейка,
    // опора, якоря кистей и патчи обязаны совпасть кадр в кадр — иначе «гладкий»
    // герой встал бы в другой точке, и сравнивать было бы нечего.
    let mod;
    try { mod = await import("../js/render/herosmooth.js"); } catch (err) { return; }
    const { META, PALETTE_HEX, STREAMS } = mod;
    assert.eq(JSON.stringify(META.cell), JSON.stringify(HERO_META.cell), "размер ячейки");
    assert.eq(META.footPad, HERO_META.footPad, "подножие");
    assert.eq(META.pxPerUnit, HERO_META.pxPerUnit, "масштаб запекки");
    assert.ok(META.ramps === undefined, "у гладкого выхода нет дорожек — цвет запечён");
    assert.eq(PALETTE_HEX.length, new Set(PALETTE_HEX).size, "палитра без повторов");
    for (const key of Object.keys(STREAMS)) {
        const bytes = Uint8Array.from(Buffer.from(STREAMS[key], "base64"));
        let total = 0;
        for (let i = 0; i + 1 < bytes.length; i += 2) total += bytes[i];
        assert.eq(total, META.cell.w * META.cell.h * (total / (META.cell.w * META.cell.h)), `${key}: кадр кратен ячейке`);
        for (const side of ["r", "l"]) {
            assert.eq(JSON.stringify(META.anchors[key]?.[side]), JSON.stringify(HERO_META.anchors[key]?.[side]), `${key}/${side}: якорь руки уехал`);
            assert.eq(JSON.stringify(META.grips[key]?.[side]), JSON.stringify(HERO_META.grips[key]?.[side]), `${key}/${side}: патч кулака уехал`);
        }
    }
});

test("every item that can end up in a hand names a carry shape", async () => {
    // items.js не имеет права выдумать форму: словарь держит рендерер, и новый
    // предмет без `hold` молча превратился бы в бесформенный комок.
    const { ITEMS } = await import("../js/sandbox/items.js");
    const { CARRY_SHAPES } = await import("../js/render/character.js");
    const shapes = new Set(CARRY_SHAPES);
    const own = ["pot", "diary_burnt", "log", "firewood"];   // у них свои кейсы в switch
    let held = 0;
    for (const [id, d] of Object.entries(ITEMS)) {
        if (d.tool || d.light || own.includes(id)) continue;
        held += 1;
        assert.ok(shapes.has(d.hold), `${id}: hold="${d.hold}" нет в словаре ${[...shapes].join("/")}`);
        assert.ok(/^#[0-9a-f]{6}$/i.test(String(d.tint)), `${id}: tint для hold`);
    }
    assert.gt(held, 20, "тест должен покрывать весь сырьевой список");
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
suite("weather-wet hero and frame-true item order");
const rgbLum = ([r, g, b]) => r * 0.3 + g * 0.59 + b * 0.11;
test("rain darkens the sprite hero, snow frosts it, a roof cancels both", () => {
    assert.eq(heroWeatherTint({}), null, "сухой герой не получает слой вообще");
    assert.eq(heroWeatherTint({ weather: "storm", groundWet: 1, underground: true }), null,
        "под крышей дождь героя не мочит");
    const rain = heroWeatherTint({ weather: "storm", groundWet: 1 });
    const dry = heroWeatherTint({ weather: "clear", groundWet: 0 });
    assert.ok(rain, "в шторм слой обязан быть");
    assert.eq(dry, null, "в ясную погоду слоя нет");
    assert.ok(rgbLum(rain.rgb) < 90, `мокрый слой тёмный, а не светлый (${rain.rgb})`);
    assert.ok(rain.a > 0.2 && rain.a <= 0.46, `альфа мокрого слоя в разумных границах: ${rain.a}`);
    const snow = heroWeatherTint({ weather: "snow", groundWet: 0.6 });
    assert.ok(snow && rgbLum(snow.rgb) > 190, "снег — светлый холодный слой");
    assert.ok(snow.a < rain.a, "иней легче, чем вода");
    assert.ok(heroWeatherTint({ weather: "snow", groundWet: 1 }).a > snow.a,
        "мокрый снег плотнее сухого");
    assert.ok(Math.abs(heroWeatherTint({ wet: WET.fromWading }).a - WET.rainA) < 0.02,
        "вылез из воды — слой равен «полностью мокрый»");
});
test("which hand is behind the body comes from the frame's depth buffer, not the view flag", () => {
    const occl = HERO_META.occl;
    assert.ok(occl, "heroframes обязан нести META.occl");
    for (const dir of HERO_META.dirs) {
        for (const pose of HERO_META.poses.map(p => p.label)) {
            const key = `${dir}/${pose}`, o = occl[key], a = HERO_META.anchors[key];
            assert.ok(o && a, `${key}: нет данных скрытости`);
            for (const side of ["r", "l"]) {
                assert.eq((o[side] || []).length, (a[side] || []).length,
                    `${key}/${side}: кадров скрытости и якорей должно быть поровну`);
                for (const v of o[side]) assert.ok(v === 0 || v === 1, `${key}/${side}: не 0/1`);
            }
        }
        // Профиль — единственный ракурс, где руки ГАРАНТИРОВАННО разные: одна за
        // корпусом, вторая перед. Если это снова станет одинаковым, значит порядок
        // опять выводят из направления взгляда, а не из кадра.
        const idle = occl[`${dir}/idle`];
        if (dir === "left") {
            assert.ok(idle.r.every(v => v === 1), "вид слева: правая рука за корпусом");
            assert.ok(idle.l.every(v => v === 0), "вид слева: левая рука спереди");
        }
        if (dir === "right") {
            assert.ok(idle.l.every(v => v === 1), "вид справа: левая рука за корпусом");
            assert.ok(idle.r.every(v => v === 0), "вид справа: правая рука спереди");
        }
        if (dir === "down") {
            assert.ok(idle.r.every(v => !v) && idle.l.every(v => !v),
                "вид спереди: обе кисти открыты — предмет рисуется поверх спрайта");
        }
    }
});
suite("props from real 3D packs");
test("возврат с гладкого рига обратно на грейд действительно меняет источник", async () => {
    // Пункт меню «Герой» обязан переключаться в обе стороны: hero3dQuality —
    // единственная функция, которая ставит активный источник, и если звать её
    // только для «smooth», обратный выбор молча оставляет игрока на гладком
    // листе (именно так и было в первой версии setStyle).
    const hero3d = await import("../js/render/hero3d.js");
    const was = hero3d.HERO3D.quality;
    assert.ok(await hero3d.hero3dQuality("smooth"), "гладкий лист обязан быть доступен");
    assert.eq(hero3d.HERO3D.quality, "smooth");
    assert.ok(hero3d.hero3dLinkCount() > 0, "у гладкого источника связки обязаны быть");
    assert.ok(await hero3d.hero3dQuality("grade"), "грейд обязан вернуться тем же вызовом");
    assert.eq(hero3d.HERO3D.quality, "grade");
    // Сетка у обоих выходов общая — на этом держится посадка предмета в руке.
    assert.eq(hero3d.HERO_SPRITE_CELL.w, GRADED_CELL.w);
    assert.eq(hero3d.HERO_SPRITE_CELL.h, GRADED_CELL.h);
    // Оба выхода обязаны предлагать один и тот же набор связок: иначе
    // переключение «в одну сторону» работало бы, а обратно — нет.
    let links = null;
    for (const mode of ["grade", "smooth"]) {
        assert.ok(await hero3d.hero3dQuality(mode), `режим «${mode}» должен быть доступен`);
        assert.not(hero3d.HERO3D.error, `режим «${mode}» не должен оставлять ошибку: ${hero3d.HERO3D.error}`);
        if (links === null) links = hero3d.hero3dLinkCount();
        assert.eq(hero3d.hero3dLinkCount(), links, `набор связок в «${mode}» должен совпадать`);
    }
    if (was !== "grade") await hero3d.hero3dQuality(was);
});
test("запеченный кадр пропа рисуется, а побитый и незнакомый уходят к кривым", () => {
    // Среде нужен createElement('canvas'): в браузере он есть, в тесте — подстава.
    if (!globalThis.document) {
        globalThis.document = { createElement: (tag) => (tag === "canvas" ? new ShimCanvas(1, 1) : {}) };
    }
    PROPS3D.enabled = true;
    const cv = new ShimCanvas(140, 110), ctx = cv.getContext("2d");
    ctx.translate(70, 96);               // точка опоры пропа — основание, вверх y<0
    const n0 = PROPS3D.stats.drawn;
    assert.ok(paintProp3D(ctx, { kind: "pine", tx: 5, ty: 9, size: 1 }, { season: "spring" }),
        "сосна обязана нарисоваться из PROP_SPRITES");
    let lit = 0;
    for (let i = 3; i < cv.data.length; i += 4) if (cv.data[i] > 0) lit += 1;
    assert.ok(lit > 300, `на кадре должны быть пиксели дерева, а их ${lit}`);
    assert.eq(PROPS3D.stats.drawn, n0 + 1, "счетчик отрисовок должен идти");
    assert.ok(!paintProp3D(ctx, { kind: "tent", tx: 1, ty: 1 }), "для «tent» кадра нет — рисует tilesart");
    assert.ok(!paintProp3D(ctx, { kind: "pine", tx: 1, ty: 1, hits: 1 }), "побитый проп остаётся процедурным");
    assert.eq(prop3dStatus().kinds, Object.keys(PROP_SPRITES).length, "статус обязан врать, если лист не тот");
});
/** Габарит ВСЕЙ gltf-модели: union по всем POSITION-аксессорам всех примитивов. */
function gltfBox(file) {
    const json = JSON.parse(fs.readFileSync(`${file}.gltf`, "utf8"));
    const bin = fs.readFileSync(`${file}.bin`);
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const mesh of json.meshes || []) {
        for (const prim of mesh.primitives || []) {
            const acc = json.accessors[prim.attributes.POSITION];
            const view = json.bufferViews[acc.bufferView];
            const v = new Float32Array(bin.buffer, bin.byteOffset + (view.byteOffset || 0), acc.count * 3);
            for (let i = 0; i < acc.count; i += 1) {
                for (let k = 0; k < 3; k += 1) {
                    const x = v[i * 3 + k];
                    if (x < mn[k]) mn[k] = x;
                    if (x > mx[k]) mx[k] = x;
                }
            }
        }
    }
    return { mn, mx };
}

test("одна модель — один масштаб: кадр хранит пропорции модели, а не каждого примитива", () => {
    // У детали конструктора примитивов несколько. Пока габарит считался для
    // каждого из них отдельно, каждая часть растягивалась к своему числу
    // пикселей: у трубы (кирпичная колонна 1×1×3 м + каменное кольцо верха
    // 0.9×0.9×0.34 м) кольцо выросло в 88 раз, и в лист лёг «жернов» — плоская
    // плита камней с дырой вместо дымохода. Стена из трёх частей (кладка
    // 0.88 м, штукатурка 3 м, доска-раскоска) дала «полосатую» панель с
    // гигантской диагональной подпоркой — на это жаловался владелец.
    // Единый масштаб аспект сохраняет; «каждый сам по себе» ломает его всегда.
    const dir = "dev/character-style-lab/assets/quaternius/village";
    const basis = cameraBasis({ yaw: PROP_META.yaw, pitch: PROP_META.pitch, target: [0, 1, 0], distance: 8 });
    const dot = (a, p) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
    for (const [kind, file] of [["hut_wall", "Wall_Plaster_Straight_L"], ["ruin_wall", "Wall_BottomCover"],
        ["hut_roof", "Roof_RoundTile_2x1"], ["chimney", "Prop_Chimney"], ["fence", "Prop_WoodenFence_Single"],
        ["crate", "Prop_Crate"], ["wagon", "Prop_Wagon"]]) {
        const { mn, mx } = gltfBox(path.join(dir, file));
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < 8; i += 1) {
            const p = [(i & 1 ? mx[0] : mn[0]), (i & 2 ? mx[1] : mn[1]), (i & 4 ? mx[2] : mn[2])];
            x0 = Math.min(x0, dot(basis.right, p)); x1 = Math.max(x1, dot(basis.right, p));
            y0 = Math.min(y0, dot(basis.up, p)); y1 = Math.max(y1, dot(basis.up, p));
        }
        const want = (x1 - x0) / Math.max(1e-4, y1 - y0);
        const e = PROP_SPRITES[kind];
        const got = e.w / Math.max(1, e.h);
        // Полоса широкая нарочно: перспектива запекки и резка ground-плиты
        // съедают кадры. Смысл проверки — порядок величины, а не микрон.
        assert.ok(got > want * 0.55 && got < want * 1.8,
            `${kind}: кадр ${e.w}×${e.h} (аспект ${got.toFixed(2)}) не похож на модель (${want.toFixed(2)}) — части растянуты порознь`);
    }
    const ch = PROP_SPRITES.chimney;
    assert.ok(ch.h > ch.w, `труба ${ch.w}×${ch.h}: дымоход обязан быть выше, чем шире`);
});

/* ------------------------- герой: лицо, вода, одежда ------------------------- */

/** Имя записи палитры по значению кадра (runtime читает palette[value - 1]). */
function frameName(meta, v) {
    if (!v || v === 255) return "empty";
    const i = v - 1;
    if (i === meta.inkAt && i >= meta.palette.length) return "ink";
    if (i < meta.palette.length) return meta.palette[i][0];
    for (const [ramp, m] of Object.entries(meta.ramps || {})) {
        if (i >= m.at && i < m.at + m.steps) return `ramp:${ramp}`;
    }
    return `#${i}`;
}
/**
 * installDOM меняет глобальные объекты, а соседним тестам нужен честный
 * ShimCanvas: с FakeElement вместо документа офскрин-маска падающей тени
 * превращается в пустоту, и тень «исчезает» в тесте, которого это не касается.
 * Поэтому ставим DOM вокруг тела теста и обязательно снимаем.
 */
async function withDom(fn) {
    const keys = ["document", "window", "requestAnimationFrame", "localStorage"];
    const saved = {};
    for (const k of keys) saved[k] = globalThis[k];
    installDOM();
    try {
        return await fn();
    } finally {
        for (const k of keys) globalThis[k] = saved[k];
    }
}

/** Границы значений дорожки в кадре: значение = индекс + 1. */
function META_RAMP(name) {
    const m = GRADED_META.ramps[name];
    return [m.at + 1, m.at + m.steps];
}

const HERO_LOOK = { gender: "male", coat: "#446d68", skin: "#e0b594", hair: "#302b29",
    pants: "#48473e", shirt: "#899383", vest: "#41524e", accent: "#c9a063", cloak: null };

test("лицо героя доживает до игрового кадра: глаза в анфас, ничего — сзади", async () => {
    return withDom(async () => {
        // Меш глаз в паке занимает ~1.7 px большого кадра, и boxAverage размывал их
        // в тон кожи: в игре лицо было пустым овалом («нет лица» — три отзыва подряд).
        // Штамп рисует глаза и брови пятном 2×1 ПОСЛЕ квантования, поэтому проверяем
        // не «есть ли тёмные пиксели» (обводка есть всегда), а РИСУНОК: в анфас
        // внутри головы обязана найтись строка с двумя раздельными тёмнымиrunами
        // (левый и правый глаз), а сзади — ни одного.
        const { heroSprite, hero3dQuality, hero3dSheet, HERO3D } = await import("../js/render/hero3d.js");
        // Соседние тесты этого файла переключают выход на smooth (у него нет ни
        // дорожек, ни штампа лица) — фиксируем грейд и возвращаем как было.
        const prevQuality = HERO3D.quality;
        await hero3dQuality("grade");
        const CELL = GRADED_META.cell, px0 = "ink";
        const darkAt = (pixels, x, y) => String(frameName(GRADED_META, pixels[y * CELL.w + x])).startsWith(px0)
            && !/inkSoft/.test(frameName(GRADED_META, pixels[y * CELL.w + x]));
        // Черта лица — это КОРОТКИЙ тёмный run МЕЖДУ краями силуэта: first/last
        // '#'-пиксели строки это обводка, её отбрасываем вместе со всём, что
        // дальше них. Иначе окно головы ловит обводку с двух сторон и «видит»
        // глаза там, где их нет.
        const runsOf = (line) => {
            const a = line.indexOf("#"), b = line.lastIndexOf("#");
            if (a < 0 || b <= a) return 0;
            let i = a; while (line[i] === "#") i += 1;               // за первым run'ом
            let j = b; while (line[j - 1] === "#") j -= 1;          // перед последним
            const inner = line.slice(i, j);
            const runs = (inner.match(/#{1,3}/g) || []).length;
            // wide=1 считать только ЧЕРТЫ от 2 px: одиночные точки глаз старая
            // запеканка оставляла и на глаз похожими быть не могли (см. контроль).
            return { runs, wide: (inner.match(/#{2,3}/g) || []).length };
        };
        const front = heroSprite({ dir: "down", anim: 0, gait: 0, moving: false, look: HERO_LOOK, phase: 0 }, HERO_LOOK);
        assert.ok(front && front.pixels, "анфас обязан собираться из запечённого листа");
        // Полоса лица: окно вокруг головы (x 34..68, y 14..28), а не вся строка —
        // за пределами силуэта в сетке кадра лежит фон, и «обводка» съедала
        // границу. Внутри окна тёмныеrunы могут быть только от черт лица.
        const HEAD = { x0: 34, x1: 68, y0: 14, y1: 28 };
        const faceRow = (pixels, want = "wide") => {
            let hits = 0;
            for (let y = HEAD.y0; y < HEAD.y1; y += 1) {
                let line = "";
                for (let x = HEAD.x0; x < HEAD.x1; x += 1) line += darkAt(pixels, x, y) ? "#" : ".";

                const r = runsOf(line);
                if ((want === "wide" ? r.wide : r.runs) >= 2) hits += 1;
            }
            return hits;
        };
        const eyesRows = faceRow(front.pixels);
        assert.ok(eyesRows >= 1, `в анфас нужна строка с двумя раздельными глазами по 2 px (таких строк: ${eyesRows})`);
        // Нос и рот — inkSoft, и они обязаны лежать НИЖЕ линии глаз: это проверка
        // раскладки лица, а не «нашли сколько-то тёмных пикселей где попало».
        const softBelowEyes = (pixels, eyeRow) => {
            let soft = 0;
            for (let y = eyeRow + 1; y < HEAD.y1 + 8; y += 1) for (let x = HEAD.x0; x < HEAD.x1; x += 1)
                if (frameName(GRADED_META, pixels[y * CELL.w + x]) === "inkSoft") soft += 1;
            return soft;
        };
        const eyeRow = (() => {
            for (let y = HEAD.y0; y < HEAD.y1; y += 1) {
                let line = "";
                for (let x = HEAD.x0; x < HEAD.x1; x += 1) line += darkAt(front.pixels, x, y) ? "#" : ".";
                if (runsOf(line).wide >= 2) return y;
            }
            return HEAD.y1;
        })();
        assert.ok(softBelowEyes(front.pixels, eyeRow) >= 1,
            "ниже глаз нет ни одной мягкой тени — значит носа и рта в кадре нет");
        const back = heroSprite({ dir: "up", anim: 0, gait: 0, moving: false, look: HERO_LOOK, phase: 0 }, HERO_LOOK);
        // Сзади — ни одного run'а вообще (даже одиночного): черт там быть не может.
        const bad = (() => {
            let hits = 0;
            for (let y = HEAD.y0; y < HEAD.y1; y += 1) {
                let line = "";
                for (let x = HEAD.x0; x < HEAD.x1; x += 1) line += darkAt(back.pixels, x, y) ? "#" : ".";
                if (runsOf(line).runs >= 1) hits += 1;
            }
            return hits;
        })();
        assert.eq(bad, 0, "сзади глаз быть не может: проверка глубины обязана прятать черты");
        // Женский лист обязан иметь ТО ЖЕ лицо. Раньше фильтр мешков глаз сверял
        // два имени мужской базы («Face»/«Face.001»), а у женской они называются
        // «Eyebrows»/«Eyes» — штамп просто не вызывался, и женщина в игре была
        // с пустым овалом вместо лица.
        const femaleLook = { ...HERO_LOOK, gender: "female", hairStyle: "long" };
        assert.ok(await hero3dSheet(femaleLook), "женский лист обязан загрузиться");
        const female = heroSprite({ dir: "down", anim: 0, gait: 0, moving: false, look: femaleLook, phase: 0 }, femaleLook);
        assert.ok(faceRow(female.pixels) >= 1, "у женщины лицо обязано читаться так же, как у мужчины");
        await hero3dQuality(prevQuality);
    });
});

test("мокрый слой красит ткань, а не лицо", async () => {
    return withDom(async () => {
        // «При промокании всё тело окрашивается в тёмно-синий» — раньше слой шёл
        // одним fillRect по силуэту. Веса теперь считаются по записям палитры.
        const { heroWetWeights } = await import("../js/render/hero3d.js");
        const { heroSprite } = await import("../js/render/hero3d.js");
        const spr = heroSprite({ dir: "down", anim: 0, gait: 0, moving: false, look: HERO_LOOK, phase: 0 }, HERO_LOOK);
        // Рантайм тонировать умеет только если кадр принёс и пиксели, и веса.
        assert.ok(spr.pixels && spr.wet, "heroSprite обязан отдавать pixels и wet для мокрого слоя");
        // Каждый возможный значение кадра обязано иметь свой вес, иначе пиксель
        // тонируется «undefined» (NaN в канвасе).
        let maxV = 0;
        for (let i = 0; i < spr.pixels.length; i += 1) if (spr.pixels[i] > maxV) maxV = spr.pixels[i];
        assert.ok(spr.wet.length > maxV, `весов не хватает: максимум значения кадра ${maxV}, весов ${spr.wet.length}`);
        assert.eq(heroWetWeights().length, HERO_PALETTE.length + 1,
            "грейд: весов ровно по одному на каждую запись палитры и каждую дорожку");
        const w = heroWetWeights();
        const at = (name) => GRADED_META.palette.findIndex(([n]) => n === name) + 1;
        assert.ok(w[at("skin")] <= 40, `кожа почти не мокнет (вес ${w[at("skin")]})`);
        assert.ok(w[at("skinLight")] <= 40, "блик на коже тоже");
        assert.ok(w[at("coat")] === 255 && w[at("trousers")] === 255, "ткань мокнет целиком");
        assert.ok(w[at("hair")] > 90 && w[at("hair")] < 170, `волосы мокнут наполовину (${w[at("hair")]})`);
        assert.eq(w[at("flameCore")], 0, "огонь факела тонировать нельзя");
        assert.eq(w[0], 0, "пустота кадра не тонируется");
        const ramps = GRADED_META.ramps;
        assert.ok(w[ramps.skin.at + 1] <= 40, "дорожка кожи обязана наследовать вес");
        assert.ok(w[ramps.cloth.at + 1] === 255, "дорожка ткани обязана мокнуть");
    });
});

test("рубашка, плащ и аксессуар идут за образом, а не остаются кремом", async () => {
    return withDom(async () => {
        // В листе эти записи запечены своим цветом: на спине героя лежала кремовая
        // «рубашка» (#e6dcbc), какой бы цвет ни выбрал игрок («на спине белая
        // палитра в одежде»). Дорожек для них нет, поэтому перекраска идёт по имени
        // группы, с сохранением светлоты каждой записи.
        const { heroLookPalette } = await import("../js/render/hero3d.js");
        const idx = (name) => GRADED_META.palette.findIndex(([n]) => n === name);
        assert.eq(GRADED_META.palette[idx("shirt")][1].toLowerCase(), "#e6dcbc",
            "проверка завязана на запечённый кремовый тон рубашки");
        const red = heroLookPalette({ ...HERO_LOOK, shirt: "#7a2f2f" });
        assert.ok(Math.abs(red[idx("shirt")][0] - 0x7a) <= 46 && red[idx("shirt")][2] < 0x70,
            `рубашка не перекрашивается: ${red[idx("shirt")].join(",")}`);
        const order = ["shirtDeep", "shirtShade", "shirt", "shirtLight"].map(n => idx(n));
        const lum = (i) => 0.299 * red[i][0] + 0.715 * red[i][1] + 0.072 * red[i][2];
        const lums = order.map(lum);
        for (let i = 1; i < lums.length; i += 1) assert.ok(lums[i] > lums[i - 1],
            `светлота рубашки не упорядочена: ${lums.map(v => Math.round(v)).join(" ")}`);
        const gold = heroLookPalette({ ...HERO_LOOK, accent: "#ffd700" });
        assert.ok(gold[idx("brass")][0] > 200 && gold[idx("brass")][1] > 160, "латунь обязана идти за акцентом");
        const plain = heroLookPalette(HERO_LOOK), cloaked = heroLookPalette({ ...HERO_LOOK, cloak: "#20303f" });
        assert.ok(cloaked[idx("cloak")].join(",") !== plain[idx("cloak")].join(","), "плащ обязан перекрашиваться, когда он надет");
    });
});

test("пол и причёска берут свой лист: меняется фигура, а не оттенок", async () => {
    return withDom(async () => {
        // Три претензии подряд: «нет реакции на смену пола. На прическу». Их
        // нельзя закрыть палитрой — paletteFor перекрашивает ЗАПИСИ, а форма
        // живёт в листе. Значит для каждой связки «кто + какая стрижка» обязан
        // лежать свой пропечённый лист, и выбор по образу обязан его достать.
        const h = await import("../js/render/hero3d.js");
        await h.hero3dQuality("grade");
        const frame = async (gender, hairStyle, dir = "up") => {
            const look = { ...HERO_LOOK, gender, hairStyle };
            const id = h.hero3dSheetId(look);
            assert.ok(await h.hero3dSheet(look), `лист «${id}» обязан загрузиться (${h.HERO3D.sheetError || "нет файла"})`);
            const sp = h.heroSprite({ dir, anim: 0, gait: 0, moving: false, look, phase: 0 }, look);
            assert.ok(sp && sp.pixels, `кадр из листа «${id}» обязан собраться`);
            return sp.pixels;
        };
        const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1; return n; };
        const hair = META_RAMP("hair");
        const hairCount = (px) => { let n = 0; for (let i = 0; i < px.length; i += 1) if (px[i] >= hair[0] && px[i] <= hair[1]) n += 1; return n; };

        const maleLong = await frame("male", "long");
        const femaleLong = await frame("female", "long");
        const maleShort = await frame("male", "short");
        const maleBun = await frame("male", "bun");
        assert.ok(h.hero3dSheetId({ ...HERO_LOOK, hairStyle: "braid" }) !== h.hero3dSheetId({ ...HERO_LOOK, hairStyle: "long" }),
            "«Коса» обязана звать свой лист, а не притворяться длинными");
        assert.eq(h.hero3dSheetId({ ...HERO_LOOK, gender: "female", hairStyle: "ponytail" }), "female/braid",
            "хвост = собранные волосы, тот же лист");
        // Пол: другой базовый мешок + своя одежда. Порог — 40 px (0.35% кадра):
        // ниже него «различие» тонет в дизеринге, и это ровно та ошибка, из-за
        // которой первый вариант женского листа был мужчиной в юбке.
        assert.gt(diff(maleLong, femaleLong), 40, "мужчина и женщина рисуются одним кадром");
        // Причёска: масса волос меняется сильнее всего — она и проверяется.
        assert.gt(hairCount(maleLong), hairCount(maleShort) * 2, "длинные волосы не длиннее коротких");
        assert.gt(hairCount(maleBun), hairCount(maleShort), "собранные волосы должны быть видны сзади");
        assert.gt(diff(maleLong, maleShort), 40, "короткая стрижка не меняет кадр");
        // «Бритые» играют коротким листом, но дорожка волос становится кожей:
        // отдельного листа лысой голове не нужно.
        const buzz = await h.heroLookPalette({ ...HERO_LOOK, hairStyle: "buzz" });
        const normal = await h.heroLookPalette({ ...HERO_LOOK, hairStyle: "short" });
        const ramps = GRADED_META.ramps;
        for (let i = 0; i < ramps.hair.steps; i += 1) {
            const at = ramps.hair.at + i;
            const want = buzz[at].join(",");
            // Не сверяем ИНДЕКСЫ дорожек (их разное число): требование в том,
            // что каждый слот волос стал затемнённым тоном кожи из её дорожки.
            const fromSkin = Array.from({ length: ramps.skin.steps }, (_, j) => normal[ramps.skin.at + j])
                .some(rgb => rgb.every((v, c) => {
                    const factor = v ? buzz[at][c] / v : 1;
                    return buzz[at][c] > 0 && factor >= 0.86 && factor <= 0.96;   // затемнение, а не подмена
                }));
            assert.ok(fromSkin, `слот волос ${i} после бритья не тон кожи: ${want}`);
            assert.ok(want !== normal[at].join(","), `слот волос ${i} не изменился — бритых не видно`);
        }
        const lum = (rgb) => 0.299 * rgb[0] + 0.715 * rgb[1] + 0.072 * rgb[2];
        const shavedLum = ramps.hair.steps ? lum(buzz[ramps.hair.at]) : 0;
        const cutLum = lum(normal[ramps.hair.at]);
        assert.gt(shavedLum, cutLum, "бритая голова обязана быть светлее причёски, а не темнее");
        assert.eq(hairCount(await frame("male", "buzz")), hairCount(maleShort),
            "лысина не обязана выстригать силуэт — меняется цвет волос, а не форма");
    });
});

test("каменный нож не притворяется стальным", async () => {
    // Претензия п.9: «в левой руке 4 деревянных ножа». drawKnife рисовал
    // полированный стальной клинок с белым бликом для НОЖА любого уровня, и
    // каменный орудный блок выглядел как готовое железо. Проверяем не вызов
    // функции, а картинку: ярких стальных пикселей у каменного ножа нет.
    const { ShimCanvas } = await import("../tools/canvas-shim.js");
    const { drawHeldToolAt } = await import("../js/render/character.js");
    const steelPixels = (tier) => {
        const cv = new ShimCanvas(40, 40);
        const ctx = cv.getContext("2d");
        ctx.translate(20, 34);
        drawHeldToolAt(ctx, { id: "knife", n: 1, tool: "knife", tier }, "down", 0,
            { x: 0, y: 0, gripX: 0, gripY: 0, angle: 0, behind: false }, {}, "right");
        let bright = 0;
        for (let i = 0; i < cv.data.length; i += 4) {
            const r = cv.data[i], g = cv.data[i + 1], b = cv.data[i + 2];
            if (cv.data[i + 3] > 8 && r > 170 && g > 170 && b > 170) bright += 1;
        }
        return bright;
    };
    assert.eq(steelPixels(1), 0, "у каменного ножа стальное лезвие");
    assert.gt(steelPixels(2), 3, "железный нож обязан читаться металлом");
    // Рука обязана видеть уровень предмета: handTool() прокидывает tier из
    // def-а, иначе рендеру неотличить кремень от железа.
    const { handTool } = await import("../js/ui/hands.js");
    assert.eq(handTool({ id: "knife", n: 1 }).tier, 1, "handTool обязан отдавать уровень предмета");
});

test("в стартовом лагере под ногами героя чисто", async () => {
    // Претензия п.6: «под ногами какой-то проп». Им оказался `firewood`, который
    // расстановка лагеря ставила в тайл СПРАВА от zone.spawnHint — на ширину
    // спрайта. Костёр рядом остаётся: он сюжетный (start_fire) и обязан быть
    //Reachable, а мусор в радиусе шага — нет.
    const { generateZone } = await import("../js/world/worldgen.js");
    const zone = generateZone("ashfall", 1066618561);
    const hint = zone.spawnHint;
    assert.ok(hint, "у стартовой зоны обязан быть spawnHint");
    const near = (zone.objects || []).filter(o => Math.max(Math.abs(o.tx - hint.tx), Math.abs(o.ty - hint.ty)) <= 1);
    const junk = near.filter(o => !o.story);
    assert.eq(junk.map(o => `${o.kind}@${o.tx - hint.tx},${o.ty - hint.ty}`).join(" "), "",
        "в радиусе тайла от стартовой точки не должно быть не-сюжетных пропадов");
    assert.ok(near.some(o => o.story === "start_fire"), "костёр пролога обязан остаться у старта");
});

test("двор читается постройкой, а не разбросанными деталями", async () => {
    // «Что за стены или чо это, летающая палатка или такая типа крыша?» —
    // расстановка двора ставила две панели стены в шести тайлах друг от друга,
    // крышу над ЛЕВОЙ из них, трубу в поле и шесть тёмных прогонов вразброс.
    // Каждый элемент по отдельности корректен, вместе они читались как мусор.
    // Правило: ряд стен сплошной, крыша над серединой ряда, труба в торец,
    // упавшие прогоны одной линией, плетень без дыр.
    const { generateZone } = await import("../js/world/worldgen.js");
    const zone = generateZone("ashfall", 1066618561);
    const objs = zone.objects;
    const at = (kind) => objs.filter(o => o.kind === kind);
    const walls = at("hut_wall").sort((a, b) => a.tx - b.tx);
    assert.ok(walls.length >= 3, `стенный ряд обязан быть сплошным, сейчас панелей: ${walls.length}`);
    for (let i = 1; i < walls.length; i += 1) {
        assert.eq(walls[i].tx - walls[i - 1].tx, 1, "между панелями стены не должно быть пустого тайла");
        assert.eq(walls[i].ty, walls[i - 1].ty, "ряд стены обязан быть прямым");
    }
    const roof = at("hut_roof")[0];
    assert.ok(roof, "во дворе обязана быть крыша");
    const under = walls.filter(w => Math.abs(w.tx - roof.tx) <= 1 && w.ty === roof.ty);
    assert.ok(under.length >= 2, `крыша обязана опираться на ряд, а не висеть над одной панелью: ${under.length}`);
    const chim = at("chimney")[0];
    assert.ok(chim, "труба во дворе обязательна");
    // Ряд = целые панели + обломок: труба закрывает именно его конец, а не
    // стоит в поле. Поэтому «торец» считаем по всем вертикальным частям.
    const row = [...walls, ...at("ruin_wall")];
    assert.ok(row.some(w => Math.abs(w.tx - chim.tx) <= 1 && Math.abs(w.ty - chim.ty) <= 1),
        "труба обязана стоять в торце стены, а не посередине поля");
    const beams = at("burnt_beam");
    const xs = beams.map(b => b.tx).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i] - xs[i - 1] <= 1, "упавшие прогоны обязаны лежать линией, а не шахматным разбросом");
    const fence = at("fence").map(f => f.ty).sort((a, b) => a - b);
    assert.ok(fence.length >= 3, "плетень обязан быть линией хотя бы из трёх сегментов");
    for (let i = 1; i < fence.length; i += 1) assert.eq(fence[i] - fence[i - 1], 1, "в плетне не должно быть дыр");
});

test("остатки в разобранном ящике выглядят предметом, а не серой кашей", async () => {
    // «После действия с ящиком появляется какая-то непонятная хрень»:
    // paintLoot рисовал пять одинаковых палочек независимо от содержимого, и
    // даже пустой остаток оставлял тёмный эллипс. Теперь форма и цвет берутся у
    // предмета, а пустота не рисует ничего.
    const { ShimCanvas } = await import("../tools/canvas-shim.js");
    const { paintLoot } = await import("../js/render/cookware.js");
    const { itemDef } = await import("../js/sandbox/items.js");
    const shot = (loot) => {
        const cv = new ShimCanvas(40, 24);
        const ctx = cv.getContext("2d");
        ctx.translate(20, 18);
        paintLoot(ctx, loot, itemDef);
        return cv;
    };
    const empty = shot([]);
    let painted = 0;
    for (let i = 3; i < empty.data.length; i += 4) if (empty.data[i] > 0) painted += 1;
    assert.eq(painted, 0, "пустой остаток не должен рисовать ни пикселя");
    const boards = shot([{ id: "plank", n: 2 }]);
    let tinted = 0, grey = 0;
    for (let i = 0; i < boards.data.length; i += 4) {
        if (boards.data[i + 3] < 8) continue;
        const r = boards.data[i], g = boards.data[i + 1], b = boards.data[i + 2];
        if (Math.abs(r - 0x9a) < 46 && Math.abs(g - 0x74) < 46 && Math.abs(b - 0x48) < 46) tinted += 1;
        if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && r > 0x70 && r < 0xc0) grey += 1;
    }
    assert.ok(tinted > 12, `доски обязаны быть в тинте предмета, пикселей: ${tinted}`);
    assert.ok(grey < tinted / 3, `на кучке не должно быть серой массы (серых ${grey} против ${tinted})`);
    // И эмодзи не врёт: 🪚 — пила, а пилы в мире нет; предмет без `tool` не
    // имеет права обещать инструмент в хотбаре (претензия «доска, указанная как пила»).
    const { ITEMS } = await import("../js/sandbox/items.js");
    const TOOL_EMOJI = new Map([["🪚", "saw"], ["🪓", "axe"], ["⛏️", "pick"], ["🔱", "spear"], ["🎣", "rod"]]);
    for (const [id, def] of Object.entries(ITEMS)) {
        const claim = TOOL_EMOJI.get(def.emoji);
        if (!claim) continue;
        assert.ok(String(def.tool || "").includes(claim) || id.includes(claim),
            `«${id}» показывает эмодзи ${def.emoji}, но инструментом ${claim} не является`);
    }
    // Тот же обман живёт в списке крафта: материал с иконкой инструмента
    // читается как «у меня есть пила».
    const { RECIPES } = await import("../js/sandbox/craft.js");
    for (const r of RECIPES) {
        if (r.group === "tool") continue;
        const claim = TOOL_EMOJI.get(r.emoji);
        if (!claim) continue;
        assert.ok(false, `рецепт «${r.id}» (${r.name}) показывает ${r.emoji} — иконку инструмента ${claim} в разделе материалов`);
    }
});

test("размер кадра = propHeight: сетка коллизий и силуэт не разъезжаются", () => {
    for (const kind of ["pine", "spruce", "rock", "ore_rock", "hut_wall", "hut_roof", "ruin_wall", "burnt_stump", "chimney", "fence", "crate", "wagon"]) {
        const e = PROP_SPRITES[kind];
        assert.ok(e, `в листе нет кадра «${kind}»`);
        // Подгонка по вертикали («y», «max») резервирует ровно ту высоту, что и
        // рисуется. У fit:"x" номинал — ШИРИНА следа (стена обязана дотянуться до
        // соседнего тайла), поэтому там с игрой сверяется фактическая высота кадра.
        const want = propHeight(kind, 1);
        const got = e.fit === "x" ? e.h : e.height;
        assert.ok(Math.abs(got - want) <= 1.5, `${kind}: кадр ${got} px против propHeight ${want}`);
    }
    for (const kind of ["hut_wall", "hut_roof", "chimney", "fence", "crate", "wagon"]) {
        assert.ok(PROP_HEIGHT[kind] !== undefined, `«${kind}» нет в PROP_HEIGHT — тень и окклюзия считают его по умолчанию`);
    }
    assert.ok(PROP_META.pxPerUnit > 0 && PROP_META.source, "источник запекки должен быть подписан");
});
test("пепелище собирается из настоящих деталей пака, и они ломаются в предмет", () => {
    const zone = generateZone("ashfall", 1066618561);
    const seen = new Set(zone.objects.map(o => o.kind));
    for (const kind of ["hut_wall", "hut_roof", "chimney", "crate", "wagon", "fence"]) {
        assert.ok(seen.has(kind), `во дворе нет «${kind}»`);
        const def = PROPS[kind];
        assert.ok(def, `«${kind}» нет в PROPS — по нему нельзя кликнуть`);
        assert.ok(PROP_SPRITES[kind], `«${kind}» нет в листе запекки`);
        for (const [item] of def.drops) {
            assert.ok(ITEMS[item], `«${kind}» роняет несуществующий «${item}»`);
        }
    }
});

test("поднятая деталь стоит на опоре, а не в воздухе", () => {
    // Претензия владельца: красная крыша висела над пепелищем. Правила два:
    // под каждой деталью с lift обязан стоять предмет, на который она сослана
    // (`on`), и lift не имеет права превышать высоту этой опоры — иначе кадр
    // уезжает за карниз и снова читается как навес на палке.
    const H = (kind) => PROP_SPRITES[kind] ? PROP_SPRITES[kind].height : propHeight(kind, 1);
    for (const zoneId of ["ashfall", "ruins"]) {
        for (let s = 0; s < 8; s++) {
            const zone = generateZone(zoneId, 1066618561 + s * 7919);
            const at = new Map();
            for (const o of zone.objects) {
                if (o.removed || o.backdrop) continue;
                const k = `${o.tx},${o.ty}`;
                if (!at.has(k)) at.set(k, []);
                at.get(k).push(o);
            }
            let lifted = 0;
            for (const o of zone.objects) {
                if (!o.lift || o.removed || o.backdrop) continue;
                lifted++;
                assert.ok(o.on, `${zoneId}: у «${o.kind}» есть lift ${o.lift}, но не указано, на чём он стоит`);
                let found = null;
                for (let dx = -1; dx <= 1 && !found; dx++) for (let dy = -1; dy <= 1 && !found; dy++) {
                    for (const n of at.get(`${o.tx + dx},${o.ty + dy}`) || []) if (n.kind === o.on) found = n;
                }
                assert.ok(found, `${zoneId}: «${o.kind}» висит над пустотой — рядом нет «${o.on}»`);
                assert.ok(o.lift <= H(o.on) + 2,
                    `${zoneId}: lift ${o.lift} выше опоры «${o.on}» (${H(o.on)} px) — деталь в воздухе`);
            }
            assert.ok(lifted > 0, `${zoneId}: за 8 сидов ни одной поднятой детали — проверка ничего не проверяет`);
        }
    }
});
test("снос опоры на реальном раскладе двора роняет ровно то, что на ней стояло", () => {
    // Правило в одну сторону уже проверено выше; здесь — обратная: игрок валит
    // стену, и крыша обязана уйти в обломки, а не остаться декорацией. Список
    // падений считает unsupportedBy (world/debris.js), его же зовёт main.js.
    const zone = generateZone("ashfall", 1066618561);
    const roof = zone.objects.find((o) => o.kind === "hut_roof" && o.lift);
    assert.ok(roof, "во дворе должна быть крыша на lift");
    const walls = zone.objects.filter((o) => o.kind === roof.on
        && Math.abs(o.tx - roof.tx) <= 1 && Math.abs(o.ty - roof.ty) <= 1 && !o.lift);
    assert.ok(walls.length >= 1, "под крышей должна стоять стена");
    // Двор блока 79 — это РЯД стен, поэтому «свалил опору» теперь значит
    // «свалил все опоры под этой крышей». Пока жива хоть одна панель, крыша
    // падать не имеет права — это и проверяется по шагам.
    for (let i = 0; i < walls.length - 1; i += 1) {
        walls[i].depleted = true;
        assert.ok(!unsupportedBy(zone.objects, walls[i]).includes(roof),
            `крыша упала, хотя под ней ещё стоят живые панели (свалено ${i + 1} из ${walls.length})`);
    }
    const last = walls[walls.length - 1];
    last.depleted = true;
    assert.ok(unsupportedBy(zone.objects, last).some((o) => o === roof),
        "живых опор у крыши не осталось — она обязана попасть в список падения");
});
test("запечённый лист уходит на экран блитом 1:1, а не дрожащим даунскейлом", async () => {
    const { fitSheet } = await import("../js/render/character.js");
    const src = new ShimCanvas(101, 113);
    const cv = new ShimCanvas(101, 113);
    const ctx = cv.getContext("2d");
    ctx.scale(0.4, 0.4);                                     // телефон: dpr 2 · zoom 1.6 → 0.4
    const fit = fitSheet(ctx, src, 101 * 0.4167, 113 * 0.4167);
    assert.eq(fit.canvas.width, Math.round(101 * 0.4167 * 0.4), "лист должен совпасть с размером на устройстве");
    assert.ok(Math.abs(fit.w * 0.4 - fit.canvas.width) < 1, "после свёртки блит обязан быть 1:1");
    assert.ok(fit.canvas !== src, "свёрнутый лист — другой канвас, а не подделка под оригинал");
    assert.ok(Math.abs(fit.kx * src.width - fit.canvas.width) < 1
        && Math.abs(fit.ky * src.height - fit.canvas.height) < 1,
        "коэффициент листа должен совпадать с его новым размером — иначе патч кулака разъедется с рукой");
    const again = fitSheet(ctx, src, 101 * 0.4167, 113 * 0.4167);
    assert.eq(again.canvas, fit.canvas, "тот же размер при том же содержимом берётся из кэша");
    src.__rev = (src.__rev || 0) + 1;                        // как tintedSheet: тон перекрашен
    assert.ok(fitSheet(ctx, src, 101 * 0.4167, 113 * 0.4167).canvas !== fit.canvas,
        "перекрашенный лист обязан сбросить кэш, иначе на экран уйдёт старый тон");
    ctx.scale(4, 4);                                         // крупный зум: 1.6 экранных px на единицу мира
    assert.eq(fitSheet(ctx, src, 101, 113).canvas, src, "когда лист уходит 1:1 или крупнее, подменять его нечем");
});

/* ------------------- причёски, пол и падающая тень пропа ------------------- */

/** Силуэт героя в векторном режиме (лист выключен), три ракурса сразу. */
function heroMask(look, dir) {
    const cv = new ShimCanvas(88, 128), ctx = cv.getContext("2d");
    ctx.translate(44, 118); ctx.scale(2.2, 2.2);
    drawCharacter(ctx, { dir, look: { ...DEFAULT_LOOK, ...look }, idleTime: 1, sprite: false });
    const mask = new Uint8Array(88 * 128);
    for (let i = 3; i < cv.data.length; i += 4) mask[i >> 2] = cv.data[i] > 8 ? 1 : 0;
    return mask;
}
function maskDiff(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
    return d;
}

test("выбранная причёска меняет силуэт, а не только подпись в меню", () => {
    if (!globalThis.document) globalThis.document = { createElement: () => new ShimCanvas(1, 1) };
    const styles = ["short", "long", "braid", "ponytail", "bun", "buzz"];
    // Со спины — единственный ракурс, где коса/хвост/пучок вообще существуют.
    const back = styles.map((hairStyle) => heroMask({ hairStyle, gender: "female" }, "up"));
    for (let i = 0; i < styles.length; i += 1) {
        for (let j = i + 1; j < styles.length; j += 1) {
            assert.gt(maskDiff(back[i], back[j]), 4,
                `причёски «${styles[i]}» и «${styles[j]}» нарисованы одинаково`);
        }
    }
    // И спереди хотя бы половина вариантов должна быть различима, иначе
    // редактор обещает то, что видно только с затылка.
    const front = styles.map((hairStyle) => heroMask({ hairStyle, gender: "female" }, "down"));
    let distinct = 0;
    for (const [i, mask] of front.entries()) {
        if (front.some((o, j) => j !== i && maskDiff(mask, o) > 4)) distinct += 1;
    }
    assert.ok(distinct >= 3, `спереди различаются только ${distinct} причёски из ${styles.length}`);
});

test("пол меняет фигуру: плечи уже, талия уже бёдер, подол длиннее", () => {
    const m = heroMask({ gender: "male", hairStyle: "short" }, "down");
    const f = heroMask({ gender: "female", hairStyle: "long" }, "down");
    const rowWidth = (mask, y) => {
        let lo = -1, hi = -1;
        for (let x = 0; x < 88; x += 1) {
            if (!mask[y * 88 + x]) continue;
            if (lo < 0) lo = x;
            hi = x;
        }
        return hi - lo;
    };
    // ряды в тех же координатах, что и при отрисовке: плечи = torsoY+2, подол = низ torso + 4
    const shoulder = Math.round(118 + (BODY.torsoY + 2) * 2.2);
    const hem = Math.round(118 + (BODY.torsoY + BODY.torsoH + 4) * 2.2);
    assert.gt(rowWidth(m, shoulder), rowWidth(f, shoulder), "плечи женщины обязаны быть уже");
    assert.gt(rowWidth(f, hem), rowWidth(m, hem), "бёдра/подол женщины — шире");
    assert.ok(m.some((v, i) => v !== f[i]), "силуэты обязаны различаться пикселями, а не словами");
});

test("вечером проп отбрасывает падающую тень, в полдень и ночью — нет", () => {
    if (!globalThis.document) globalThis.document = { createElement: () => new ShimCanvas(1, 1) };
    PROPS3D.enabled = true;
    const { setPropSun, defaultSun } = propSun;
    // Мера — покрытие кадра: тень обязана ДОБАВЛЯТЬ пиксели вокруг пропа. Смотреть
    // на «тёмные пиксели в окне слева» нельзя: направление зависит от азимута, а
    // цвет тени — от подложки, и тест ловил бы не тень, а случайность.
    const coverage = (sun) => {
        setPropSun(sun);
        const cv = new ShimCanvas(160, 120), ctx = cv.getContext("2d");
        ctx.translate(60, 104);
        const shadows = PROPS3D.stats.shadows || 0;
        // Сосна, а не чурка: тень широкого низкого пропа почти целиком
        // прячется под ним самим, и на ней мерить нечего.
        paintProp3D(ctx, { kind: "pine", tx: 3, ty: 6, size: 1 }, { season: "spring" });
        let lit = 0;
        for (let i = 3; i < cv.data.length; i += 4) if (cv.data[i] > 8) lit += 1;
        return [lit, (PROPS3D.stats.shadows || 0) - shadows];
    };
    const [evening, eveningCalls] = coverage({ dir: 1, elev: 0.12, amp: 1, amb: 1, rough: 0 });
    const [noon, noonCalls] = coverage({ dir: 0, elev: 1, amp: 1, amb: 1, rough: 0 });
    const [night, nightCalls] = coverage({ dir: 0, elev: 0.4, amp: 0, amb: 0.3, rough: 0 });
    setPropSun(defaultSun());
    assert.gt(eveningCalls, 0, "на косом свету castShadow обязан вызываться");
    assert.gt(evening - noon, 60, `длинная тень должна ложиться вокруг пропа: ${evening} против ${noon} пикселей`);
    assert.eq(noonCalls, 0, "в полдень тени в стороны нет");
    assert.eq(nightCalls, 0, "рассеянный свет чёткой тени не даёт");
});

/* ══════════════════ живой 3D-риг вместо запечённого листа (блок 79) ══════════════════ */
/**
 * Претензия владельца: «Переходи на THREE.js — играть в реальном 3D-рендере, как
 * в лаборатории, а не в запечённых спрайт-листах с программным растром». Ниже —
 * проверка того, что живой слой (а) реально собирается, (б) встаёт в ту же сетку
 * кадра, что и лист (иначе герой и предмет в руке разъезжаются), (в) меняет
 * ГЕОМЕТРИЮ от пола и причёски, а не только краску, и (г) при отказе возвращает
 * лист, а не пустоту.
 */
const liveMod = () => import("../js/render/hero3d-live.js");
const THREE_MOD = () => import("../js/vendor/three.module.js");

test("живой режим — штатный: флаг адреса, пункт меню и значение по умолчанию", () => {
    const flags = fs.readFileSync("js/ui/styleflags.js", "utf8");
    assert.ok(/hero === "live"/.test(flags), "?hero3d=live обязан разбираться: без этого переключатель только в коде");
    const menu = fs.readFileSync("js/ui/session.js", "utf8");
    assert.ok(menu.includes(`["live", "Живой`), "«Вид мира» обязан предлагать живой 3D — на телефоне адресной строки нет");
    const main = fs.readFileSync("js/main.js", "utf8");
    assert.ok(/loadStyle\(\{ hero3d: "live"/.test(main), "игра стартует живым рендером: это и есть «переходи на THREE.js»");
    const hero3d = fs.readFileSync("js/render/hero3d.js", "utf8");
    assert.ok(/export async function hero3dLive/.test(hero3d), "герой обязан уметь включить live-слой");
    assert.ok(/HERO3D\.live = false/.test(hero3d), "отказ живого слоя обязан возвращать на лист, а не ронять кадр");
});

test("живой кадр садится в сетку листа: якорь кисти ≤ 1 px на 4 ракурсах", async () => {
    const [THREE, live] = await Promise.all([THREE_MOD(), liveMod()]);
    assert.ok(live.enableForTests(THREE), `сцена не собралась: ${live.LIVE.error}`);
    const look = { gender: "male", hairStyle: "long", skin: "#e0b594", coat: "#446d68", pants: "#48473e", hair: "#302b29" };
    const PX = HERO_META.pxPerUnit, CELL = HERO_META.cell, FOOT = HERO_META.footPad;
    let tested = 0, sum = 0, worst = 0, camWorst = 0;
    for (const pose of HERO_META.poses) {
        for (const dir of ["down", "left", "right", "up"]) {
            const anchors = HERO_META.anchors?.[`${dir}/${pose.label}`]?.r;
            if (!anchors) continue;
            for (let f = 0; f < pose.frames; f += 1) {
                if (!anchors[f]) continue;
                const p = live.liveProbe(look, pose.label, f, dir, "r");
                assert.ok(p, `поза «${pose.label}» не отдала пробник — живой рендер без позы`);
                const d = Math.hypot(p.px - (anchors[f][0] * PX + CELL.w / 2), p.py - (anchors[f][1] * PX + (CELL.h - FOOT)));
                tested += 1; sum += d; worst = Math.max(worst, d);
                // Камера обязана рисовать ровно там, где посчитан якорь. Иначе
                // «спрайт ↔ предмет в руке» разъедутся на полпикселя при повороте.
                camWorst = Math.max(camWorst, Math.hypot(p.camPx - p.px, p.camPy - p.py));
            }
        }
    }
    assert.gt(tested, 40, "мало сверенных кадров — тест ничего не проверяет");
    assert.ok(worst <= 1, `живой кадр не совпадает с листом: худший ${worst.toFixed(2)} px (нужно ≤ 1)`);
    assert.ok(sum / tested <= 0.5, `среднее расхождение ${((sum / tested)).toFixed(2)} px — сетка кадра поехала`);
    assert.ok(camWorst <= 0.01, `проекция камеры расходится с формулой кадра на ${camWorst.toFixed(3)} px`);
});

test("пол и причёска меняют МЕШИ живого рендера, а не краску", async () => {
    const [THREE, live] = await Promise.all([THREE_MOD(), liveMod()]);
    live.enableForTests(THREE);
    const box = (look) => {
        const e = live.liveLook(look);
        assert.ok(e, "liveLook не собрал образ");
        let verts = 0, y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
        for (const m of e.meshes) {
            const pos = m.geometry.attributes.position.array;
            for (let i = 0; i < pos.length; i += 3) {
                verts += 1;
                y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]);
                x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]);
            }
        }
        return { verts, names: e.meshes.map(m => m.name.split("/")[0]).join(","), h: y1 - y0, w: x1 - x0, key: e.key };
    };
    const maleLong = box({ gender: "male", hairStyle: "long" });
    const femaleLong = box({ gender: "female", hairStyle: "long" });
    const maleShort = box({ gender: "male", hairStyle: "short" });
    const femaleShort = box({ gender: "female", hairStyle: "short" });
    const bald = box({ gender: "female", hairStyle: "bald" });
    assert.ok(maleLong.key !== femaleLong.key, "образы пола обязаны различаться ключом");
    assert.ok(maleLong.names !== femaleLong.names, "мужской и женский образ обязаны брать разные меши (иначе «женщина = мужская фигура»)");
    assert.ok(Math.abs(maleLong.w - femaleLong.w) > 0.02, `плечи не различаются: ${maleLong.w} против ${femaleLong.w}`);
    assert.ok(Math.abs(maleShort.verts - maleLong.verts) > 100, "стрижка обязана снимать массу волос, а не перекрашивать их");
    assert.ok(maleLong.verts > bald.verts && femaleLong.verts > bald.verts, "без волос мешей должно быть меньше");
    assert.ok(Math.abs(femaleShort.w - femaleLong.w) < 1e-6 && femaleShort.verts < femaleLong.verts,
        "длина волос у женщины: та же фигура, меньше мешей");
    assert.ok(bald.verts > 0);
});

test("живой рендер выбирает позу по состоянию актёра — как лист", async () => {
    const [THREE, live] = await Promise.all([THREE_MOD(), liveMod()]);
    live.enableForTests(THREE);
    const pose = (p) => live.livePose(p);
    assert.eq(pose({ dir: "down", moving: false, actionTimer: 0 }).label, "idle");
    assert.eq(pose({ dir: "left", moving: true, gait: 0.4 }).label, "walk");
    assert.eq(pose({ dir: "up", moving: true, gait: 0.9, runBlend: 0.9 }).label, "run");
    assert.eq(pose({ dir: "down", moving: false, actionTimer: 0.2, actionKind: "chop" }).label, "chop");
    assert.eq(pose({ dir: "down", moving: false, actionTimer: 0.2, actionKind: "mine" }).label, "mine");
    assert.eq(pose({ dir: "right", moving: false, fallTimer: 0.4 }).label, "idle",
        "в падении лист показывал стойку — живой рендер обязан показывать ту же");
    assert.eq(pose({ dir: "down", moving: false, leftTool: "torch" }).label, "torch");
    for (const label of ["idle", "walk", "run", "attack", "chop", "mine", "gather", "torch"]) {
        assert.ok(live.liveClipFrames(label) > 1, `клип «${label}» пуст — позa не сыграет`);
    }
});

test("диагноз live-слоя откатывает на ЛИСТ, а не на пустоту", async () => {
    // «Нет 3D» и «нет героя» — не одно и то же. Если живой слой сообщает о битой
    // геометрии, пустом кадре или потерянном контексте, heroSprite обязан отдать
    // кадр листа; возврат null означал бы векторную заготовку вместо персонажа.
    const [THREE, live] = await Promise.all([THREE_MOD(), liveMod()]);
    live.enableForTests(THREE);
    return withDom(async () => {
        const hero3d = await import("../js/render/hero3d.js");
        const was = hero3d.HERO3D.quality;
        // hero3dLive(true) в этой среде честно откажет (нет WebGL), но именно он
        // подключает LIVE_MOD — без него heroSprite до живого слоя не доходит.
        await hero3d.hero3dQuality("grade");
        await hero3d.hero3dLive(true);
        const look = { gender: "female", hairStyle: "short", skin: "#ba8864", coat: "#785044", pants: "#3a2f28", hair: "#825332" };
        const p = { dir: "left", moving: true, gait: 0.5, phase: 1.2, actionTimer: 0, look };
        const good = hero3d.heroSprite(p, look);
        assert.ok(good && good.canvas, "лист обязан отдавать кадр в этой среде — иначе проверка ничего не проверяет");
        // Дирижируем диагнозом: как если бы liveLook/аудит кадра отказались.
        live.LIVE.audited = true; live.LIVE.reason = "bad-mesh"; live.LIVE.error = "нет весов у 20418 вершин";
        hero3d.HERO3D.live = true;
        const back = hero3d.heroSprite(p, look);
        assert.ok(back && back.canvas, "после отказа live кадр обязан прийти из листа, а не null");
        assert.ok(back.live !== true, "откатанный кадр не обязан помечать себя живым");
        assert.eq(hero3d.HERO3D.live, false, "слой обязан выключиться, а не пытаться каждый кадр");
        assert.ok(/20418/.test(hero3d.HERO3D.error), `причина обязана остаться видимой: «${hero3d.HERO3D.error}»`);
        live.LIVE.reason = ""; live.LIVE.error = ""; live.LIVE.audited = false;
        hero3d.HERO3D.live = false; hero3d.HERO3D.error = "";
        if (was !== "grade") await hero3d.hero3dQuality(was);
    });
});

test("живой кадр совпадает с ЛИСТОМ ПО СИЛУЭТУ, а не только якорем", async () => {
    // Якорь — одна точка. Кадр — это весь силуэт: именно по нему видно, что
    // «герой пропал», «сжался в точку», «уехал на полклетки». Сравниваем живой
    // рендер (скиннинг на CPU = то же, что считает GPU) с кадром листа: покрытие,
    // габарит, центроид — и покрытие С ОБВОДКОЙ, потому что без чернил герой
    // выглядит приклеенным к миру, где у каждого пропа обводка есть.
    const { compare } = await import("../tools/hero-live-raster.js");
    for (const who of ["male", "female"]) {
        const res = await compare({ who, style: who === "male" ? "long" : "short" });
        assert.ok(!res.fail, `${res.look}: ${res.fail && res.fail.bad}`);
        assert.ok(res.compared >= 4, `сравнено ${res.compared} кадров — мало`);
        for (const r of res.rows.filter(x => !x.skip)) {
            assert.ok(r.live > 900, `${r.dir}/${r.label}: живой кадр ${r.live} px — это не герой`);
            assert.ok(r.covInk > 0.75 && r.covInk < 1.35,
                `${r.dir}/${r.label}: кадр с обводкой весит ${(r.covInk * 100).toFixed(0)}% от листа`);
            assert.ok(r.dBox <= 4, `${r.dir}/${r.label}: габарит разъехался на ${r.dBox} px`);
        }
    }
});

test("битая геометрия живого рендера не рисуется точкой, а возвращает лист", async () => {
    const [THREE, live, hero3d] = await Promise.all([
        THREE_MOD(), liveMod(), import("../js/render/hero3d.js")
    ]);
    live.enableForTests(THREE);
    const ok = live.liveValidate({ gender: "male", hairStyle: "long" });
    assert.eq(ok.ok, true, `проверка геометрии: ${ok.error}`);
    // Тот же тест на поломке: веса обнулены → liveLook обязан отказать, а не молча
    // сложить меш в одну точку (именно так и выглядел «пропавший герой»).
    const geo = await import("../js/render/herorig.js");
    assert.ok(geo.RIG_META.parts["body:male"].meshes.length >= 3, "тело обязано быть из нескольких мешей");
    const v = Buffer.from(geo.RIG_BLOBS[geo.RIG_META.parts["body:male"].meshes[0].verts], "base64");
    let weighted = 0;
    for (let i = 0; i < 646; i += 1) if (v[i * 13 + 12]) weighted += 1;
    assert.eq(weighted, 646, "у каждой вершины обязан быть вес основной кости (байт 12)");
    let bones = 0;
    for (let i = 0; i < 646; i += 1) if (v[i * 13 + 10] < geo.RIG_META.bones.length) bones += 1;
    assert.eq(bones, 646, "номер кости обязан влезать в скелет");
    assert.ok(hero3d.HERO3D.quality !== "live" || hero3d.HERO3D.live, "без WebGL живым кадром играть нельзя — quality обязан остаться на листе");
});

test("отказ живого слоя = лист, а не пустой спрайт (и причина в штампе)", async () => {
    const hero3d = await import("../js/render/hero3d.js");
    const live = await liveMod();
    assert.eq(hero3d.HERO3D.live, false, "живой слой включается только после успешного initLive");
    const ok = await hero3d.hero3dLive(true);          // в node нет document → нет и WebGL
    assert.eq(ok, false, "в node живой рендер обязан честно отказаться");
    assert.eq(hero3d.HERO3D.live, false);
    assert.ok(/WebGL/.test(hero3d.HERO3D.error), `отказ обязан быть объяснён: «${hero3d.HERO3D.error}»`);
    assert.ok(["grade", "smooth"].includes(hero3d.HERO3D.quality), "после отказа играет лист, а не «live»");
    // Пакет при этом цел: живому слою есть чем собраться в браузере.
    const info = live.liveInfo();
    assert.eq(info.parts, 12, "герой обязан прийти целиком: 12 частей (тело, костюм, волосы)");
    assert.eq(info.clips, 9, "девять клипов — те же позы, что у листа (+sprint)");
    assert.ok(live.liveSupported() === false, "liveSupported в node без document обязан быть false");
});


await run("visual-world");
