import { test, assert, run } from "./tiny.js";
import { installDOM, FakeElement } from "./dom-harness.js";
import { EventBus } from "../js/core/events.js";
import { MemoryStorage } from "../js/core/save.js";
import { Inventory } from "../js/sandbox/inventory.js";
import { StoryEngine, STORY_STEPS } from "../js/story/acts.js";
import { startMeal, tickHands, useHand, handRender, openBag } from "../js/ui/hands.js";
import { armRig, toolAttachment } from "../js/render/character.js";
import { waterIce } from "../js/world/water-state.js";
import { terrainColour } from "../js/render/terrain.js";
import { T } from "../js/world/tiles.js";
import { resumeSaved, openSessionMenu } from "../js/ui/session.js";
const dom = installDOM();
const { Game } = await import("../js/main.js");
function boot() {
    const g = new Game({ canvas: new FakeElement("canvas"), hudRoot: new FakeElement(), seed: 1066618561 });
    g.save.storage = new MemoryStorage(); g.hud.hideStory(); return g;
}
function click(g, text) {
    const row = g.hud._panelRows.find(r => r.innerHTML.includes(`>${text}</span>`));
    assert.ok(row, text); row.dispatch("click");
}
const equip = (inv, side, id) => inv.equipHand(side, inv.slots.findIndex(s => s?.id === id));
const serial = (x) => JSON.stringify(x.toJSON());
const events = [
    ["story:flag", { flag: "home_hearth" }], ["story:flag", { flag: "own_diary" }],
    ["inv:add", { id: "firewood", n: 5 }], ["fire:lit", {}], ["cook:pot_take", { id: "herb_tea" }],
    ["player:ate", { id: "herb_tea" }], ["player:slept", {}], ["zone:enter", { zone: "meadow" }]
];
test("all cyclic and reverse event orders reconcile once, including low-nutrition tea", () => {
    for (let shift = 0; shift < events.length; shift++) for (const reverse of [false, true]) {
        const bus = new EventBus(), story = new StoryEngine({ bus });
        let notifications = 0; bus.on("story:step", () => notifications++);
        const order = [...events.slice(shift), ...events.slice(0, shift)]; if (reverse) order.reverse();
        for (const e of order) bus.emit(...e);
        assert.ok(story.done); assert.eq(story.entries.length, STORY_STEPS.length);
        assert.eq(notifications, STORY_STEPS.length);
        for (const e of order) bus.emit(...e);
        assert.eq(notifications, STORY_STEPS.length); assert.eq(new Set(story.completed).size, STORY_STEPS.length);
    }
});
test("early facts survive a save before the hearth is inspected", () => {
    const bus = new EventBus(), story = new StoryEngine({ bus });
    for (const e of events.slice(1)) bus.emit(...e);
    const b = new EventBus(), loaded = new StoryEngine({ bus: b }); loaded.load(JSON.parse(serial(story)));
    assert.eq(loaded.current.id, "wake"); b.emit(...events[0]); assert.ok(loaded.done);
});
test("raw food, arbitrary nutrition and burnt cooking do not count as a cooked meal", () => {
    const bus = new EventBus(), story = new StoryEngine({ bus });
    bus.emit("needs:consume", { food: 99 }); bus.emit("player:ate", { id: "meat_raw" });
    bus.emit("cook:take", { state: "burnt", id: "food_burnt" });
    assert.not(story.facts.eat); assert.not(story.facts.cook);
    bus.emit("cook:take", { state: "done", id: "mushroom_roast" }); assert.ok(story.facts.cook);
});
test("legacy recovery uses diary, wood, journal and live fire without inventing sleep or food", () => {
    const g = boot(); g.inventory.add("diary_burnt"); g.inventory.add("firewood", 5);
    g.cookJournal.discover("herb_tea"); [...g.fires.values()][0].lit = true;
    g.story.load({ flags: ["home_hearth"], index: 0, entries: [] }); let notices = 0;
    g.bus.on("story:step", () => notices++); g.story.recover();
    assert.eq(g.story.current.id, "eat"); assert.not(g.story.facts.survive_night); assert.eq(notices, 0);
    const count = g.story.entries.length; g.story.recover(); assert.eq(g.story.entries.length, count);
});
test("restarting from a loaded snapshot does not mutate its journal or completed steps", () => {
    const bus = new EventBus(), story = new StoryEngine({ bus });
    const snapshot = JSON.parse(serial(story)); story.load(snapshot); for (const e of events) bus.emit(...e);
    assert.eq(snapshot.entries.length, 0); assert.eq(snapshot.completed.length, 0);
    story.load(snapshot); assert.eq(story.current.id, "wake"); assert.eq(story.entries.length, 0);
});
test("other inventories do not contribute the player's early wood fact", () => {
    const bus = new EventBus(), story = new StoryEngine({ bus });
    bus.emit("inv:add", { owner: "chest", id: "firewood", n: 50 }); assert.not(story.facts.wood);
});
test("real early diary is rereadable from journal and never duplicated after reconciliation", () => {
    const g = boot(), diary = g.zone.objects.find(o => o.kind === "diary");
    g.interact = diary; g.doInteract(); assert.eq(g.story.current.id, "wake");
    assert.eq(g.inventory.count("diary_burnt"), 1); assert.ok(diary.removed);
    g.hud.closePanel(); g.inspectHearth(g.zone.objects.find(o => o.kind === "hearth_ruin"));
    assert.eq(g.story.current.id, "firewood"); g.openJournal(); click(g, "Обгоревший дневник · прочитать");
    assert.eq(g.hud.panelOpen, "diary"); assert.eq(g.inventory.count("diary_burnt"), 1);
    g.interact = diary; g.doInteract(); assert.eq(g.inventory.count("diary_burnt"), 1);
});
test("ordinary cookware route: salvage, install, select berries, cook, collect, eat, save", () => {
    const g = boot(), hearth = g.zone.objects.find(o => o.kind === "hearth_ruin"), obj = g.zone.objects.find(o => o.kind === "campfire");
    g.inspectHearth(hearth); click(g, "Забрать котелок"); assert.eq(g.inventory.count("pot"), 1);
    g.inspectHearth(hearth); assert.not(g.hud._panelRows.some(r => r.innerHTML.includes("Забрать котелок")));
    // Gather real generated wood, not a fixture pot or supplied finished food.
    for (const o of g.zone.objects.filter(o => o.kind === "firewood").slice(0, 4)) g.harvest(o);
    g.openFire(obj); click(g, "Установить котелок"); assert.eq(g.inventory.count("pot"), 0);
    const f = g.fires.get(g.fireKey(g.zone, obj)); assert.ok(f.hasPot);
    for (let i = 0; i < 4; i++) click(g, "Подбросить хворост");
    click(g, "Разжечь костёр"); click(g, "Котелок"); click(g, "Ягоды"); click(g, "Ягоды"); click(g, "Готовить");
    assert.eq(g.inventory.count("berry"), 1); assert.ok(f.pot); g.storyNotices.length = 0;
    for (let i = 0; i < 250 && !f.pot.done; i++) f.update(10);
    assert.ok(f.pot.done); g.openFire(obj); click(g, "Котелок"); assert.eq(g.inventory.count("berry_jam"), 1);
    assert.ok(g.story.facts.cook); g.hud.closePanel(); g.hud.hideStory(); g.storyNotices.length = 0;
    assert.ok(startMeal(g, "berry_jam")); tickHands(g, 1); assert.ok(g.story.facts.eat);
    assert.ok(g.save.write()); const restored = boot(); restored.save.storage = g.save.storage; assert.ok(resumeSaved(restored));
    assert.ok(restored.fires.get(restored.fireKey(restored.zone, obj)).hasPot);
    restored.inspectHearth(restored.zone.objects.find(o => o.kind === "hearth_ruin"));
    assert.not(restored.hud._panelRows.some(r => r.innerHTML.includes("Забрать котелок")));
});
test("full bag cannot lose unique cookware or diary", () => {
    const g = boot(); g.inventory.slots.fill(null); for (let i = 0; i < g.inventory.size; i++) g.inventory.slots[i] = { id: "stone", n: 50 };
    g.inspectHearth(g.zone.objects.find(o => o.kind === "hearth_ruin")); click(g, "Забрать котелок");
    assert.not(g.story.hasFlag("home_pot_taken")); assert.eq(g.inventory.count("pot"), 0);
    const diary = g.zone.objects.find(o => o.kind === "diary"); g.interact = diary; g.doInteract(); assert.not(diary.removed);
    g.inventory.slots[0] = null; click(g, "Забрать котелок"); assert.eq(g.inventory.count("pot"), 1);
});
test("hands are separate single-item storage and all inventory queries include them", () => {
    const inv = new Inventory({ slots: 2 }); inv.add("knife"); inv.add("torch", 2); inv.enableHands();
    assert.ok(equip(inv, "left", "torch")); assert.eq(inv.used, 1); assert.eq(inv.count("knife"), 1);
    assert.eq(inv.count("torch"), 2); assert.eq(inv.hands.left.n, 1); assert.eq(inv.findTool("knife").hand, "right");
    assert.near(inv.weight, 1.3); assert.eq(inv.remove("torch", 2), 2); assert.eq(inv.hands.left, null);
});
test("full-bag failed stow is atomic, swaps do not need backpack space", () => {
    const inv = new Inventory({ slots: 1 }); inv.add("knife"); inv.enableHands(); inv.add("stone", 50);
    const before = serial(inv); assert.not(inv.equipHand("right")); assert.eq(serial(inv), before);
    assert.ok(inv.swapHands()); assert.eq(inv.hands.left.id, "knife"); assert.eq(inv.count("stone"), 50);
});
test("meal frees a real hand, preserves torch, blocks repeated action and restores knife", () => {
    const g = boot(), inv = g.inventory; inv.add("torch"); equip(inv, "left", "torch");
    const food = g.needs.food; assert.ok(startMeal(g, "berry"));
    assert.eq(inv.hands.right.id, "berry"); assert.eq(inv.hands.left.id, "torch"); assert.ok(inv.slots.some(s => s?.id === "knife"));
    assert.eq(inv.count("berry"), 3); assert.eq(g.needs.food, food); assert.not(startMeal(g, "berry"));
    assert.not(inv.swapHands()); assert.not(inv.setDominant("left")); assert.not(inv.equipHand("left"));
    tickHands(g, .4); assert.eq(inv.count("berry"), 3); tickHands(g, .6);
    assert.eq(inv.hands.right.id, "knife"); assert.eq(inv.hands.left.id, "torch"); assert.eq(inv.count("berry"), 2);
    assert.eq(g.needs.food, food + 5); tickHands(g, 1); assert.eq(g.needs.food, food + 5);
});
test("two occupied hands and no stow space forbid even the last bag berry", () => {
    const g = boot(), inv = g.inventory; inv.add("torch"); equip(inv, "left", "torch");
    inv.slots = inv.slots.map(() => ({ id: "stone", n: 50 })); inv.slots[0] = { id: "berry", n: 1 };
    const before = serial(inv); assert.not(startMeal(g, "berry")); assert.eq(serial(inv), before);
    inv.slots[1] = null; assert.ok(startMeal(g, "berry")); assert.eq(inv.hands.right.id, "berry");
});
test("torch in dominant hand is retained when the other item can be stowed", () => {
    const g = boot(), inv = g.inventory; inv.add("torch"); equip(inv, "left", "torch"); inv.setDominant("left");
    assert.ok(startMeal(g, "berry")); assert.eq(inv.handAction.side, "right"); assert.eq(inv.hands.left.id, "torch");
});
test("selected anatomical food hand wins when both hands hold the same food", () => {
    const g = boot(), inv = g.inventory; equip(inv, "left", "berry"); equip(inv, "right", "berry");
    useHand(g, "right"); assert.eq(inv.handAction.side, "right"); tickHands(g, 1);
    assert.eq(inv.hands.left.id, "berry"); assert.eq(inv.count("berry"), 2);
});
test("save halfway through eating completes once with restored tool and no duplicate nutrition", () => {
    const g = boot(), inv = g.inventory; inv.add("torch"); equip(inv, "left", "torch");
    const food = g.needs.food; startMeal(g, "berry"); tickHands(g, .35); assert.ok(g.save.write());
    const b = boot(); b.save.storage = g.save.storage; assert.ok(resumeSaved(b));
    assert.near(b.inventory.handAction.remaining, .55); assert.eq(b.needs.food, food);
    tickHands(b, .6); tickHands(b, 1); assert.eq(b.needs.food, food + 5); assert.eq(b.inventory.count("berry"), 2);
    assert.eq(b.inventory.hands.right.id, "knife"); assert.eq(b.inventory.hands.left.id, "torch");
});
test("pause, panels and background freeze eating; falling delays completion", () => {
    const g = boot(); startMeal(g, "berry");
    for (const flag of ["paused", "backgrounded"]) { g[flag] = true; g.update(.2); assert.near(g.inventory.handAction.remaining, .9); g[flag] = false; }
    g.hud.openPanel("Пауза", []); g.update(.2); assert.near(g.inventory.handAction.remaining, .9); g.hud.closePanel();
    g.player.fallTimer = 1; tickHands(g, 1); assert.near(g.inventory.handAction.remaining, .9); g.player.fallTimer = 0;
    g.update(.2); assert.near(g.inventory.handAction.remaining, .7);
});
test("legacy bag-only save migrates selected item without duplicating the stack", () => {
    const g = boot(), data = JSON.parse(g.save.exportString());
    data.parts.inv = { size: 24, activeSlot: 20, slots: Array(24).fill(null) };
    data.parts.inv.slots[20] = { id: "torch", n: 3 };
    assert.ok(g.save.restore(data)); assert.eq(g.inventory.hands.right.id, "torch"); assert.eq(g.inventory.slots[20].n, 2);
    assert.eq(g.inventory.count("torch"), 3); assert.eq(g.inventory.dominant, "right"); assert.eq(g.inventory.handAction, null);
});
test("invalid held stacks, handedness and meal actions reject restore transactionally", () => {
    const g = boot(), data = JSON.parse(g.save.exportString()), before = serial(g.inventory);
    for (const mutate of [d => d.hands.right.n = 2, d => d.dominant = "middle", d => d.handAction = { type: "eat", side: "right", id: "knife", remaining: .4 }]) {
        const bad = JSON.parse(JSON.stringify(data)); mutate(bad.parts.inv); assert.not(g.save.restore(bad)); assert.eq(serial(g.inventory), before);
    }
});
test("left-handed menu changes preference, never silently swaps the actual hands", () => {
    const g = boot(); openSessionMenu(g); click(g, "Ведущая рука: правая"); click(g, "Левша");
    assert.eq(g.inventory.dominant, "left"); assert.eq(g.inventory.hands.right.id, "knife"); assert.eq(g.inventory.hands.left, null);
});
test("backpack categories only represent existing items and filter real contents", () => {
    const g = boot(); openBag(g); assert.not(g.hud._panelRows.some(r => r.innerHTML.includes(">Руда</span>")));
    g.inventory.add("copper"); openBag(g); click(g, "Руда");
    assert.ok(g.hud._panelRows.some(r => r.innerHTML.includes("Медная руда ×1")));
    assert.not(g.hud._panelRows.some(r => r.innerHTML.includes("Ягоды ×")));
});
test("both light anchors follow their own anatomical arm in every direction, with an eating pose", () => {
    const g = boot(); g.windStrength = 0; g.inventory.add("torch", 2); equip(g.inventory, "left", "torch"); equip(g.inventory, "right", "torch");
    for (const dir of ["down", "left", "up", "right"]) {
        g.player.dir = dir; g.render(); const lights = g.renderer._lights.filter(l => l.glow === .45);
        assert.eq(lights.length, 2); assert.not(lights[0].localX === lights[1].localX && lights[0].localY === lights[1].localY);
        for (const l of lights) {
            const a = toolAttachment({ ...g.player, ...handRender(g.inventory), phase: g.player.anim, idleTime: g.renderer.time,
                torchWind: Math.cos(g.weather.windAngle) * (g.windStrength || 0) }, l.hand);
            assert.near(l.localX, a.x); assert.near(l.localY, a.y);
        }
        const rig = armRig({ dir }), eat = armRig({ dir, eatingHand: "left" });
        assert.lt(eat.left.ey, rig.left.ey); assert.deep(eat.right, rig.right);
    }
});
test("front/back torches lean away from the body on their own side", () => {
    for (const dir of ["down", "up"]) {
        const right = toolAttachment({ dir }, "right"), left = toolAttachment({ dir }, "left");
        assert.ok((left.x - left.gripX) * left.gripX > 0);
        assert.ok((right.x - right.gripX) * right.gripX > 0);
    }
});
test("the non-striking arm is unchanged by a left-handed tool swing", () => {
    const still = armRig({ dir: "down", actionHand: "left" });
    const swing = armRig({ dir: "down", actionHand: "left", actionTimer: .12 });
    assert.deep(still.right, swing.right); assert.not(JSON.stringify(still.left) === JSON.stringify(swing.left));
});
test("unsafe deep ice is dark broken water, fresh supporting ice stays pale, shallows stay passable", () => {
    const g = boot(); g.enterZone("shore"); const map = g.zone.map;
    const testColour = (id, marine) => {
        map.waterState = { marine: new Uint8Array(map.w * map.h).fill(marine ? 1 : 0), fresh: 1, sea: 1 };
        const x = 100, y = 100, state = waterIce(map, x, y, id);
        const field = { map, biome: "shore", sample: () => ({ id, weights: [[id, 1]], coast: 160 }), noise: () => .5 };
        return { state, colour: terrainColour(field, x, y, "winter", { [id]: [30, 70, 100] }) };
    };
    const sea = testColour(T.DEEP, true), lake = testColour(T.DEEP, false), shallow = testColour(T.WATER, true);
    assert.ok(sea.state.blocked); assert.ok(sea.state.broken); assert.not(sea.state.walkable);
    assert.ok(lake.state.walkable); assert.not(lake.state.broken); assert.not(shallow.state.blocked);
    assert.gt(lake.colour[0] - sea.colour[0], 70); assert.gt(lake.colour[1] - sea.colour[1], 60);
});
await run("stage65");
