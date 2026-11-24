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
await run("visual-world");
