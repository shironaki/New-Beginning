import { handRender } from "../js/ui/hands.js";
import { test, assert, run } from "./tiny.js";
import { installDOM, FakeElement } from "./dom-harness.js";
import { MemoryStorage } from "../js/core/save.js";
import { TerrainField } from "../js/world/terrain.js";
import { generateZone } from "../js/world/worldgen.js";
import { healthEffects, conditionRows } from "../js/survival/condition.js";
import { Needs } from "../js/survival/needs.js";
import { startMeal, tickHands, openHand, useHand, openBag } from "../js/ui/hands.js";
import { resumeSaved } from "../js/ui/session.js";
import { Camera } from "../js/engine/camera.js";
import { toolAttachment } from "../js/render/character.js";
import { projectGround } from "../js/render/projected-ground.js";
import { ShimCanvas } from "../tools/canvas-shim.js";
const dom = installDOM();
const { Game } = await import("../js/main.js");
function boot() {
    const g = new Game({ canvas: new FakeElement("canvas"), hudRoot: new FakeElement(), seed: 1066618561 });
    g.save.storage = new MemoryStorage(); g.hud.hideStory(); return g;
}
const click = (el) => el.dispatch("click");
test("weakest need uses inverted fatigue, includes stamina and updates as it changes", () => {
    const g = boot(); g.needs.food = 70; g.needs.warmth = 50; g.needs.fatigue = 98; g.update(0);
    assert.ok(g.hud.els.summary.innerHTML.includes("Бодрость"));
    assert.ok(g.hud.els.summary.innerHTML.includes("2%"));
    g.needs.fatigue = 10; g.player.stamina = 8; g.update(0);
    assert.ok(g.hud.els.summary.innerHTML.includes("Выносливость"));
    assert.eq(g.hud.needRows.food.getAttribute("aria-valuenow"), "70");
});
test("need disclosure supports mouse, keyboard focus, touch toggle and Escape", () => {
    const h = boot().hud;
    assert.ok(h.els.details.hidden === undefined || h.els.details.hidden); // fake parser does not parse attributes
    h.els.disclosure.dispatch("pointerenter", { pointerType: "mouse" }); assert.not(h.els.details.hidden);
    h.els.disclosure.dispatch("pointerleave"); assert.ok(h.els.details.hidden);
    h.els.disclosure.dispatch("pointerenter", { pointerType: "touch" }); assert.ok(h.els.details.hidden);
    click(h.els.summary); assert.not(h.els.details.hidden);
    h.els.disclosure.dispatch("pointerleave"); assert.not(h.els.details.hidden);
    h.els.disclosure.dispatch("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} }); assert.ok(h.els.details.hidden);
    h.els.disclosure.dispatch("focusin"); assert.not(h.els.details.hidden);
    h.openPanel("test", []); assert.ok(h.els.details.hidden);
});
test("a held berry click consumes once after time passes and preserves the other hand", () => {
    const g = boot(), food = g.needs.food;
    g.inventory.equipHand("left", g.inventory.slots.findIndex(s => s?.id === "berry")); g.update(0);
    click(g.hud.els.leftHand);
    assert.eq(g.inventory.count("berry"), 3); assert.eq(g.needs.food, food);
    tickHands(g, 1);
    assert.eq(g.inventory.count("berry"), 2); assert.eq(g.needs.food, food + 5); assert.eq(g.inventory.hands.right.id, "knife");
});
test("exhausting provisions never grants a phantom meal", () => {
    const g = boot(); for (let i = 0; i < 3; i++) { assert.ok(startMeal(g, "berry")); tickHands(g, 1); }
    const food = g.needs.food; assert.not(startMeal(g, "berry")); g.update(0);
    assert.eq(g.needs.food, food); assert.eq(g.inventory.count("berry"), 0);
});
test("food from any of 24 slots is reachable through the categorized bag", () => {
    const g = boot(); g.inventory.slots[20] = { id: "herb_tea", n: 2 };
    openBag(g, "food"); click(g.hud._panelRows.find(r => r.innerHTML.includes("Травяной отвар")));
    assert.eq(g.inventory.count("herb_tea"), 2);
    click(g.hud._panelRows.find(r => r.innerHTML.includes("Использовать")));
    assert.eq(g.inventory.count("herb_tea"), 2); tickHands(g, 1); assert.eq(g.inventory.count("herb_tea"), 1);
});
test("hand use blocked by save gate, modal, pause, background, story and falling", () => {
    const g = boot(); g.inventory.equipHand("left", g.inventory.slots.findIndex(s => s?.id === "berry"));
    for (const [obj, key] of [[g, "paused"], [g, "backgrounded"], [g.player, "fallTimer"]]) {
        obj[key] = 1; useHand(g, "left"); assert.not(g.inventory.handAction); obj[key] = 0;
    }
    g.sessionReady = false; useHand(g, "left"); assert.not(g.inventory.handAction); g.sessionReady = true;
    g.hud.openPanel("pause", []); useHand(g, "left"); assert.not(g.inventory.handAction); g.hud.closePanel();
    g.hud.showStory({ title: "story", text: "text" }); useHand(g, "left"); assert.not(g.inventory.handAction);
    assert.eq(g.inventory.count("berry"), 3);
});
test("hand chooser reaches slot 20 with conserved quantities and explicit left assignment", () => {
    const g = boot(); g.inventory.slots[20] = { id: "torch", n: 2 };
    openHand(g, "left"); click(g.hud._panelRows.find(r => r.innerHTML.includes("Факел")));
    assert.eq(g.inventory.hands.left.id, "torch"); assert.eq(g.inventory.hands.right.id, "knife"); assert.eq(g.inventory.count("torch"), 2);
    assert.not(g.inventory.equipHand("right", 60));
});
test("both hands and dominant preference survive a real save/restore", () => {
    const a = boot(); a.inventory.slots[20] = { id: "torch", n: 1 };
    a.inventory.equipHand("left", 20); a.inventory.setDominant("left"); assert.ok(a.save.write());
    const b = boot(); b.save.storage = a.save.storage; assert.ok(resumeSaved(b));
    assert.eq(b.inventory.hands.left.id, "torch"); assert.eq(b.inventory.hands.right.id, "knife"); assert.eq(b.inventory.dominant, "left");
    assert.eq(b.camera.surface, b.zone.playableRelief);
});
test("health diagnosis matches additive hunger/cold/exhaustion damage and difficulty", () => {
    const n = new Needs({ difficulty: "hard" }); n.food = 0; n.warmth = 0; n.fatigue = 100;
    const e = healthEffects(n); assert.eq(e.length, 3);
    assert.near(e.reduce((s, x) => s + x.rate, 0), -(.14 + .2 + .05) * 1.8);
    assert.ok(e.some((x) => x.cause === "Обморожение"));
});
test("overheating is harmful despite a high warmth number; never show healing with damage", () => {
    const n = new Needs(); n.warmth = 99;
    const e = healthEffects(n, true); assert.eq(e.length, 1); assert.eq(e[0].cause, "Перегрев"); assert.lt(e[0].rate, 0);
});
test("health recovery conditions and diagnosis share the actual simulation function", () => {
    const n = new Needs(); n.health = 40;
    assert.eq(healthEffects(n, true)[0].rate, .18);
    const before = n.health; n.update(1, { ambient: 18, activity: 1 });
    assert.near(n.health - before, .045);
    n.food = 30; assert.eq(healthEffects(n).length, 0);
});
test("condition menu uses current weather/fire/clothing/wetness while survival time continues", () => {
    const g = boot(); g.needs.wet = .9; g.inventory.add("cloak"); const minute = g.clock.minute;
    const text = conditionRows(g).map((r) => r.html).join(" ");
    assert.ok(text.includes("одежда +6")); assert.ok(text.includes("−6°C")); assert.ok(text.includes("реальную секунду"));
    g.openCondition(); g.update(1); assert.gt(g.clock.minute, minute); assert.eq(g.hud.panelOpen, "condition");
});
test("production relief is on the real home zone only, deterministic and independent of save deltas", () => {
    const a = generateZone("ashfall", 1066618561), b = generateZone("ashfall", 1066618561);
    assert.deep(Array.from(a.playableRelief.heights), Array.from(b.playableRelief.heights));
    assert.not(generateZone("shore", 1066618561).playableRelief);
    const p = a.playableRelief.landmark;
    assert.gt(a.playableRelief.heightAt(p.x, p.y), 20);
    assert.eq(a.terrain.elevation(p.x, p.y), a.playableRelief.heightAt(p.x, p.y));
});
test("height bounds and both derivatives prevent folded ground, including banks and map edges", () => {
    const z = generateZone("ashfall", 1066618561), f = z.playableRelief;
    for (let y = 0; y < z.map.heightPx; y += 19) for (let x = 0; x < z.map.widthPx; x += 17) {
        const h = f.heightAt(x, y); assert.gte(h, 0); assert.lte(h, f.maxHeight);
        assert.lte(Math.abs(f.heightAt(x + 1, y) - h), .481); assert.lte(Math.abs(f.heightAt(x, y + 1) - h), .481);
    }
    for (const [x, y] of [[0, 500], [500, 0], [z.map.widthPx, 500], [500, z.map.heightPx]]) assert.lt(f.heightAt(x, y), .001);
});
test("raised rendering does not change serialized object identities or tile data", () => {
    const g = boot(); const props = g.zone.objects.map((o) => [o.kind, o.x, o.y]); const tiles = [...g.zone.map.data];
    const object = g.zone.objects.find((o) => o.kind === "firewood"); object.removed = true;
    assert.ok(g.save.write()); assert.ok(resumeSaved(g));
    assert.deep(g.zone.objects.map((o) => [o.kind, o.x, o.y]), props); assert.deep([...g.zone.map.data], tiles);
    assert.ok(g.zone.objects.find((o) => o.x === object.x && o.y === object.y && o.kind === object.kind).removed);
});
test("world/screen inverse agrees on a raised slope at DPR zoom and with camera shake", () => {
    const z = generateZone("ashfall", 1066618561), c = new Camera({ width: 1200, height: 700, zoom: 4.8 });
    c.surface = z.playableRelief; c.offsetX = 2; c.offsetY = -3; c.snapTo(1072, 1150);
    for (let y = 950; y < 1300; y += 13) {
        const p = c.worldToScreen(1072, y), q = c.screenToWorld(p.x, p.y);
        assert.near(q.x, 1072, 1e-4); assert.near(q.y, y, 1e-4);
    }
});
test("projected chunk raster columns meet exactly with no transparent cracks", () => {
    const create = document.createElement; document.createElement = (tag) => tag === "canvas" ? new ShimCanvas(1, 1) : create(tag);
    try {
        const source = new ShimCanvas(16, 16), ctx = source.getContext("2d"); ctx.fillStyle = "#8a795f"; ctx.fillRect(0, 0, 16, 16);
        const field = { maxHeight: 12, heightAt: (x, y) => 5 + x * .1 + y * .15 };
        const a = projectGround(source, field, 0, 0), b = projectGround(source, field, 0, 16);
        for (let x = 0; x < 16; x++) {
            const rows = (cv) => Array.from({ length: cv.height }, (_, y) => y).filter((y) => cv.data[(y * 16 + x) * 4 + 3]);
            const aa = rows(a), bb = rows(b); assert.eq(aa.at(-1) + 1, bb[0] + 16);
            assert.eq(aa.length, aa.at(-1) - aa[0] + 1);
        }
    } finally { document.createElement = create; }
});
test("camera switches terrain on zone travel and raised chunk cache is reused", () => {
    const g = boot(); g.render(); const baked = g.renderer.stats.baked; g.render(); assert.eq(g.renderer.stats.baked, baked);
    assert.ok(g.camera.surface); g.enterZone("shore", null, true); assert.eq(g.camera.surface, null);
    g.enterZone("ashfall", null, true); assert.eq(g.camera.surface, g.zone.playableRelief);
});
test("torch light is attached to the actor foot, not terrain under its airborne flame", () => {
    const g = boot(); g.inventory.slots[20] = { id: "torch", n: 1 }; g.inventory.equipHand("right", 20); g.placeSafely(1072, 1150); g.render();
    const light = g.renderer._lights.find((l) => l.glow === .45);
    assert.eq(light.anchorX, g.player.x); assert.eq(light.anchorY, g.player.y);
    const a = toolAttachment({ ...g.player, ...handRender(g.inventory), phase: g.player.anim, idleTime: g.renderer.time, torchWind: Math.cos(g.weather.windAngle) * (g.windStrength || 0) });
    assert.near(light.localX, a.x, .1); assert.near(light.localY, a.y, .1);
});
test("height-aware reach rejects remote levels but allows nearby items on the shelf", () => {
    const f = generateZone("ashfall", 1066618561).playableRelief;
    assert.ok(f.canReach(f.landmark, { x: f.landmark.x + 2, y: f.landmark.y }));
    assert.not(f.canReach(f.landmark, { x: 100, y: 100 }));
});
test("actual Player climbs normal-world shelf with no teleport and can save mid-slope", () => {
    const g = boot(); g.placeSafely(1072, 1250); g.player.dir = "up"; g.input.setStick(0, -.8);
    const y0 = g.player.y, h0 = g.zone.playableRelief.heightAt(g.player.x, g.player.y);
    for (let i = 0; i < 240; i++) { const x = g.player.x, y = g.player.y; g.update(1 / 60); assert.lt(Math.hypot(g.player.x - x, g.player.y - y), 3); }
    assert.lt(g.player.y, y0 - 60); assert.gt(g.zone.playableRelief.heightAt(g.player.x, g.player.y), h0 + 8);
    const position = { x: g.player.x, y: g.player.y }; assert.ok(g.save.write()); assert.ok(resumeSaved(g));
    assert.near(g.player.x, position.x); assert.near(g.player.y, position.y);
});
await run("stage63");
