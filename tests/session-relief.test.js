import { collect, reach } from "./carry-fixture.js";
import { handRender } from "../js/ui/hands.js";
/** Stage 61: persistent world, honest menus, touch interruptions, relief light. */
import { test, assert, run } from "./tiny.js";
import { installDOM, FakeElement } from "./dom-harness.js";
import { MemoryStorage, SaveManager, SAVE_VERSION } from "../js/core/save.js";
import { checkpoint, resumeSaved, openSessionMenu, sessionTick, bindSessionLifecycle } from "../js/ui/session.js";
import { snapshotWorld } from "../js/world/persistence.js";
import { reliefAttachment, reliefView } from "../js/render/relief.js";
import { toolAttachment } from "../js/render/character.js";
const dom = installDOM();
const { Game } = await import("../js/main.js");
const { ReliefTrialGame } = await import("../js/dev/relief-trial.js");
function boot(seed = 1066618561, Type = Game) {
    const canvas = new FakeElement("canvas"); canvas.width = 960; canvas.height = 560;
    const g = new Type({ canvas, hudRoot: new FakeElement(), seed });
    g.save.storage = new MemoryStorage(); return g;
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const click = (el) => el.dispatch("click", { preventDefault() {} });
test("restore seed before terrain; preserve harvest, partial hits, chest and RNG across zones", () => {
    const a = boot();
    const tree = a.zone.objects.find((o) => o.block && o.kind.includes("tree"));
    tree.hits = 2; tree.removed = true; a.zone.removeSolid(tree);
    const shore = a.world.get("shore"); shore.objects[0].looted = true;
    a.rng.next(); a.rng.next(); const state = a.rng.state;
    assert.ok(a.save.write()); const b = boot(999); b.save.storage = a.save.storage;
    assert.ok(resumeSaved(b)); assert.eq(b.seed, a.seed); assert.eq(b.world.seed, a.seed); assert.eq(b.weather.seed, a.seed);
    assert.eq(b.rng.state, state); assert.deep(snapshotWorld(b.world), snapshotWorld(a.world));
    const loaded = b.zone.objects.find((o) => o.x === tree.x && o.y === tree.y && o.kind === tree.kind);
    assert.ok(loaded.removed); assert.eq(loaded.hits, 2);
    assert.not((b.zone.solidIndex.get(`${loaded.tx},${loaded.ty}`) || []).includes(loaded));
});
test("fire fuel, cooked slots, wind and inventory survive loading", () => {
    const a = boot(), fire = [...a.fires.values()][0];
    fire.addFuel("log"); fire.light({ hasFlint: true }); fire.putOnSpit("mushroom"); fire.update(20);
    a.weather.windAngle = 2.123; a.inventory.add("berry", 7);
    const data = clone(a.save.snapshot()), b = boot(2);
    assert.ok(b.save.restore(data));
    assert.deep([...b.fires.values()][0].toJSON(), fire.toJSON());
    assert.deep(b.inventory.toJSON(), a.inventory.toJSON()); assert.near(b.weather.windAngle, 2.123);
});
test("loading earlier checkpoint restores a resource harvested later", () => {
    const g = boot(); const data = clone(g.save.snapshot());
    const wood = g.zone.objects.find((o) => o.kind === "firewood"), index = g.zone.objects.indexOf(wood);
    reach(g,wood); g.harvest(wood); collect(g,wood); g.hud.hideStory(); assert.ok(wood.removed);
    assert.ok(g.save.restore(data)); assert.not(g.zone.objects[index].removed);
});
test("legacy v3 save still loads using its seed without inventing resource history", () => {
    const a = boot(); const data = clone(a.save.snapshot()); data.version = 3;
    delete data.parts.world; delete data.parts.rng;
    const b = boot(4); assert.ok(b.save.restore(data)); assert.eq(b.seed, a.seed);
    assert.eq(b.zone.id, a.zone.id); assert.near(b.player.x, a.player.x);
});
test("failed world identity restores live state and never overwrites disk", () => {
    const g = boot(); g.zone.objects[0].looted = true; g.save.write();
    const old = g.save.storage.getItem(g.save.key), before = clone(g.save.snapshot().parts);
    const bad = JSON.parse(old); bad.parts.world[0].props[0].kind = "impossible";
    assert.not(g.save.restore(bad)); assert.deep(g.save.snapshot().parts, before);
    assert.eq(g.save.storage.getItem(g.save.key), old);
});
test("future, broken, missing and malformed data are rejected without state change", () => {
    const g = boot(), before = clone(g.save.snapshot().parts);
    for (const mutate of [d => d.version = SAVE_VERSION + 1, d => delete d.parts.inv,
        d => d.parts.clock.day = -1, d => d.parts.inv.size = 100000,
        d => d.parts.player.p.x = "NaN", d => d.parts.needs.health = null,
        d => d.parts.player.p.stamina = null, d => d.parts.inv.activeSlot = 999]) {
        const data = clone(g.save.snapshot()); mutate(data);
        assert.not(g.save.restore(data)); assert.deep(g.save.snapshot().parts, before);
    }
});
test("snapshot and storage failures do not replace a good save or report success", () => {
    const s = new SaveManager({ storage: new MemoryStorage() }); s.register("ok", () => 1, () => {}); s.write();
    const old = s.storage.getItem(s.key);
    s.register("broken", () => { throw Error("failure"); }, () => {});
    assert.not(s.write()); assert.eq(s.storage.getItem(s.key), old);
    const g = boot(); g.save.storage = { getItem: () => null, setItem: () => { throw Error("quota"); } };
    assert.not(checkpoint(g)); assert.ok(g.save.lastError);
});
test("a throwing localStorage read is safe", () => {
    const s = new SaveManager({ storage: { getItem() { throw Error("blocked"); } } });
    assert.not(s.has()); assert.eq(s.read(), null);
});
test("Continue gate prevents overwrite before the player chooses a session", () => {
    const g = boot(); g.save.write(); const old = g.save.storage.getItem(g.save.key);
    g.start(); assert.eq(g.sessionReady, false); assert.ok(g.hud.panelLocked);
    assert.ok(g.hud._focusables().every((el) => !el.disabled));
    g.hud.closePanel(); assert.ok(g.hud.isPanelOpen);
    g.inventory.add("log", 2); sessionTick(g, 100, false); assert.not(checkpoint(g));
    assert.eq(g.save.storage.getItem(g.save.key), old);
    assert.ok(resumeSaved(g)); assert.not(g.hud.isPanelOpen); assert.eq(g.inventory.count("log"), 0);
    g.loop.stop();
});
test("New Game requires confirmation; backing out keeps the old save", () => {
    const g = boot(); g.inventory.add("log", 4); g.save.write(); const old = g.save.storage.getItem(g.save.key);
    openSessionMenu(g); click(g.hud._panelRows.find((r) => r.innerHTML.includes("Новая игра")));
    assert.eq(g.inventory.count("log"), 4); assert.eq(g.save.storage.getItem(g.save.key), old);
    click(g.hud._panelRows[1]); assert.eq(g.save.storage.getItem(g.save.key), old);
    click(g.hud._panelRows.find((r) => r.innerHTML.includes("Новая игра"))); click(g.hud._panelRows[0]);
    assert.eq(g.inventory.count("log"), 0); assert.eq(g.hud.panelOpen,"appearance");
    click(g.hud._panelRows.find(r=>r.innerHTML.includes("Начать путь"))); assert.not(g.hud.isPanelOpen);
});
test("30 seconds of active time saves; an open menu neither moves nor recovers stamina", () => {
    const g = boot(); g.player.stamina = 12;
    sessionTick(g, 31, false); assert.ok(g.save.has());
    openSessionMenu(g); g.player.mvx = 100; const x = g.player.x, minute = g.clock.minute;
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    assert.near(g.player.x, x); assert.eq(g.clock.minute, minute); assert.eq(g.player.stamina, 12);
});
test("phone buttons open inventory/journal and queue an action", () => {
    const g = boot(); click(g.sessionButtons.bag); assert.eq(g.hud.panelOpen, "bag");
    g.hud.closePanel(); click(g.sessionButtons.journal); assert.eq(g.hud.panelOpen, "journal");
    g.hud.closePanel(); click(g.sessionButtons.action); assert.ok(g.input.justPressed("action"));
});
test("full touch stick sprints; exhaustion latches until stick is relaxed", () => {
    const g = boot(); g.input.setStick(1, 0); g.update(1 / 60); assert.ok(g.player.running);
    g.player.stamina = 5; g.update(1 / 60); assert.ok(g.player.sprintLocked);
    g.player.stamina = 100; g.update(1 / 60); assert.not(g.player.running);
    g.input.setStick(0.5, 0); g.update(1 / 60); g.input.setStick(1, 0); g.update(1 / 60); assert.ok(g.player.running);
});
test("second left finger never acts; cancellation clears movement", () => {
    const g = boot(), c = g.renderer.canvas;
    c.dispatch("touchstart", { changedTouches: [{ identifier: 1, clientX: 50, clientY: 100 }] });
    c.dispatch("touchstart", { changedTouches: [{ identifier: 2, clientX: 60, clientY: 100 }] });
    assert.not(g.input.justPressed("action"));
    c.dispatch("touchmove", { changedTouches: [{ identifier: 1, clientX: 110, clientY: 100 }], preventDefault() {} });
    assert.ok(g.input.stick.active);
    c.dispatch("touchcancel", { changedTouches: [{ identifier: 1 }] }); assert.not(g.input.stick.active);
});
test("backgrounding saves, pauses and resets the touch identifier", () => {
    const g = boot(), win = new FakeElement(), doc = new FakeElement(); doc.hidden = false;
    bindSessionLifecycle(g, win, doc); g.input.setStick(1, 0);
    win.dispatch("blur"); assert.ok(g.backgrounded); assert.not(g.input.stick.active); assert.ok(g.save.has());
    const minute = g.clock.minute; g.update(2); assert.eq(g.clock.minute, minute);
    win.dispatch("focus"); assert.not(g.backgrounded);
});
test("trial save uses only its isolated storage and restores picked-up wood", () => {
    const main = boot(); main.save.write(); const old = main.save.storage.getItem(main.save.key);
    const g = boot(5, ReliefTrialGame), wood = g.zone.objects.find((o) => o.kind === "firewood");
    reach(g,wood); g.harvest(wood); collect(g,wood); g.hud.hideStory(); checkpoint(g);
    wood.removed = false; assert.ok(resumeSaved(g)); assert.ok(g.zone.objects.find((o) => o.kind === "firewood").removed);
    assert.eq(main.save.storage.getItem(main.save.key), old);
});
test("relief presets drive real clock, weather, cold surfaces and light map", () => {
    const g = boot(5, ReliefTrialGame); g.setConditions("night"); g.render();
    assert.eq(g.clock.hour, 22);
    const torch = g.inventory.slots.findIndex((s) => s?.id === "torch"); g.inventory.setActive(torch); g.render();
    assert.eq(g.renderer.lightMap.lights.length, 1);
    assert.eq(g.renderer.lightMap.lights[0].glow, 0.45);
    g.setConditions("winter"); g.render(); assert.eq(g.clock.season.key, "winter");
    assert.ok(g.mesh.some((f) => f.ice)); const winterColour = g.mesh[0].colour;
    g.setConditions("rain"); g.render(); assert.eq(g.weather.current, "rain"); assert.not(g.mesh.some((f) => f.ice));
    assert.not(g.mesh[0].colour === winterColour);
});
test("torch screen light follows anatomical hand, including falls over a terrace edge", () => {
    const g = boot(5, ReliefTrialGame); g.player.x = 450; g.player.y = 265;
    const i = g.inventory.slots.findIndex((s) => s?.id === "torch"); g.inventory.setActive(i);
    for (const dir of ["up", "down", "left", "right"]) for (const fall of [0, 0.8]) {
        g.player.dir = dir; g.player.fallTimer = fall; g.render();
        const flame = toolAttachment({ ...g.player, ...handRender(g.inventory), phase: g.player.anim, idleTime: g.elapsed,
            torchWind: Math.cos(g.weather.windAngle) * (g.windStrength || 0) });
        const point = reliefAttachment(g.relief, g.player, flame), view = reliefView(960, 560);
        const light = g.renderer.lightMap.lights[0];
        assert.near(light.x, view.x + point.x * view.zoom); assert.near(light.y, view.y + point.y * view.zoom);
    }
});
test("phone relief view follows feet instead of shrinking the hero to a dot", () => {
    const v = reliefView(390, 740, { x: 408, y: 300 }, 1.6);
    assert.gte(v.zoom, 1.6); assert.near(v.x + 408 * v.zoom, 195);
});
test("saved facing restores the interaction direction, not just the sprite", () => {
    const g = boot(); g.player.dir = "left"; g.player.faceX = -1; g.player.faceY = 0; g.player.slant = -0.5;
    const data = clone(g.save.snapshot()), other = boot(3);
    assert.ok(other.save.restore(data));
    assert.eq(other.player.dir, "left"); assert.eq(other.player.faceX, -1); assert.eq(other.player.slant, -0.5);
    assert.lt(other.player.facingPoint(16).x, other.player.x);
});
test("midnight checkpoint waits for needs and fire simulation to complete", () => {
    const g = boot(); g.clock.minute = 1439; g.clock._acc = 0.699;
    const fire = [...g.fires.values()][0]; fire.addFuel("log"); fire.light({ hasFlint: true });
    g.update(1 / 60);
    const saved = g.save.read(); assert.ok(saved); assert.eq(saved.parts.clock.day, g.clock.day);
    assert.near(saved.parts.needs.food, g.needs.food);
    assert.near(Object.values(saved.parts.fires)[0].fuel, fire.fuel);
});
await run("session-relief");
