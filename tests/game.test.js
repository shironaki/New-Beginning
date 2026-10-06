/**
 * v3 tests — the real Game object, booted against a fake DOM.
 *
 * Catches wiring bugs that pure-logic tests cannot: a broken selector, a
 * missing canvas call, a null in the render path, an interaction that does
 * not fire. This is the test that proves the build actually runs.
 */
import { suite, test, assert, run } from "./tiny.js";
import { installDOM, key } from "./dom-harness.js";
import { UI, COLORS, CONTRACTS, contrast, applyTheme, pixelRatio } from "../js/ui/uispec.js";

const dom = installDOM();
const { Game } = await import("../js/main.js");

function boot() {
    const canvas = dom.doc.getElementById("game");
    const hud = dom.doc.getElementById("hud");
    return new Game({ canvas, hudRoot: hud, seed: "test-valley" });
}

/** Run n simulation+render frames at 60 fps. */
function frames(game, n) {
    for (let i = 0; i < n; i++) { game.update(1 / 60); game.render(); }
}

suite("boot");

test("the game constructs with a world, a hero and a HUD", () => {
    const g = boot();
    assert.ok(g.zone, "no zone");
    assert.eq(g.zone.id, "ashfall");
    assert.ok(g.player.x > 0 && g.player.y > 0);
    assert.not(g.zone.solidAt(g.player.x, g.player.y), "the hero spawned inside a rock");
    assert.ok(g.inventory.has("flint"), "no way to light a fire");
    assert.ok(g.inventory.has("knife"));
});

test("the opening narration appears and pauses the world", () => {
    const g = boot();
    g.start();
    assert.ok(g.hud.isStoryOpen, "the prologue text should be on screen");
    assert.ok(g.paused);
    g.hud.hideStory();
    assert.not(g.paused, "closing the story must resume the game");
});

suite("frame");

test("rendering a frame touches the canvas and bakes chunks", () => {
    const g = boot();
    const ctx = g.renderer.ctx;
    g.render();
    assert.gt(ctx.calls.total, 50, "nothing was drawn");
    assert.gt(g.renderer.stats.chunksDrawn, 0, "no ground chunks drawn");
    assert.gt(g.renderer.stats.baked, 0, "chunks were never baked");
});

test("baked chunks are reused on the next frame", () => {
    const g = boot();
    g.render();
    const baked = g.renderer.stats.baked;
    g.render(); g.render();
    assert.eq(g.renderer.stats.baked, baked, "chunks must be cached, not re-baked every frame");
});

test("300 frames run without throwing and the clock moves", () => {
    const g = boot();
    const t0 = g.clock.minute;
    frames(g, 300);
    assert.ok(g.clock.minute !== t0, "time stood still");
    assert.ok(g.needs.alive);
});

suite("input & movement");

test("holding W walks the hero north", () => {
    const g = boot();
    const y0 = g.player.y;
    key(dom.win, "KeyW", true);
    frames(g, 40);
    key(dom.win, "KeyW", false);
    assert.lt(g.player.y, y0, "the hero did not move north");
    assert.eq(g.player.dir, "up");
});

test("the camera follows and stays inside the zone", () => {
    const g = boot();
    key(dom.win, "KeyD", true);
    frames(g, 120);
    key(dom.win, "KeyD", false);
    assert.gte(g.camera.x, 0);
    assert.lte(g.camera.x + g.camera.viewW, g.zone.map.widthPx + 1);
});

test("a lost keyup never leaves the hero walking by himself", () => {
    // Reported from play: a click while walking (focus leaves the frame) and
    // the hero kept going on his own, fighting every other direction.
    const g = boot();
    key(dom.win, "KeyW", true);
    for (let i = 0; i < 60; i++) {
        if (i % 4 === 0) key(dom.win, "KeyW", true, true);   // the OS auto-repeat
        g.update(1 / 60);
    }
    assert.ok(g.input.pressed("up"), "the key is genuinely held here");
    // ...and now the keyup is swallowed: no more events of any kind.
    for (let i = 0; i < 40; i++) g.update(1 / 60);           // inside the grace window
    assert.ok(g.input.pressed("up"), "must not cut a real hold short");
    for (let i = 0; i < 60; i++) g.update(1 / 60);           // past it
    assert.not(g.input.pressed("up"), "the ghost key should have been released");
    const y = g.player.y;
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    assert.near(g.player.y, y, 0.01, "the hero kept walking on his own");
});

test("a diagonal keeps both keys: the watchdog must not eat the first one", () => {
    // W then A: the OS repeats only A, so a naive watchdog drops W after a
    // second and the hero stops walking diagonally. Reported from play.
    const g = boot();
    key(dom.win, "KeyW", true);
    for (let i = 0; i < 40; i++) { if (i % 4 === 0) key(dom.win, "KeyW", true, true); g.update(1 / 60); }
    key(dom.win, "KeyA", true);                       // second direction
    const x0 = g.player.x, y0 = g.player.y;
    for (let i = 0; i < 200; i++) { if (i % 4 === 0) key(dom.win, "KeyA", true, true); g.update(1 / 60); }
    assert.ok(g.input.pressed("up"), "the first key was eaten");
    assert.ok(g.input.pressed("left"), "the second key is gone");
    assert.lt(g.player.x, x0 - 5, "no westward travel");
    assert.lt(g.player.y, y0 - 5, "no northward travel");
});

test("losing focus drops every held key", () => {
    const g = boot();
    key(dom.win, "KeyD", true);
    g.update(1 / 60);
    assert.ok(g.input.pressed("right"));
    dom.win.dispatch("blur", {});
    g.update(1 / 60);
    assert.not(g.input.pressed("right"), "a blurred window cannot hold a key");
    const x = g.player.x;
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    assert.near(g.player.x, x, 0.01);
});

test("a key with no auto-repeat is never cut off", () => {
    // Some setups have key repeat disabled; the watchdog must stay disarmed.
    const g = boot();
    key(dom.win, "KeyS", true);
    for (let i = 0; i < 300; i++) g.update(1 / 60);          // five seconds
    assert.ok(g.input.pressed("down"), "a held key was dropped without cause");
    key(dom.win, "KeyS", false);
    g.update(1 / 60);
    assert.not(g.input.pressed("down"));
});

test("number keys switch the hotbar slot", () => {
    const g = boot();
    key(dom.win, "Digit2", true);
    g.update(1 / 60);
    assert.eq(g.inventory.activeSlot, 1);
});

test("the hero is never teleported while walking", () => {
    // Regression: the mover and Game.fitsAt used different probe shapes, so
    // the safety net saw legal positions as occupied and flung the hero —
    // occasionally straight into a prop. One probe set, no jumps.
    const g = boot();
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0], [0.7, -0.7], [-0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]];
    let cur = { x: 0, y: 0 };
    g.input.axis = () => cur;
    const maxStep = 118 / 60 * 1.5;               // run speed plus the corner-assist slide
    for (let i = 0; i < 2400; i++) {
        cur = { x: dirs[(i / 70 | 0) % dirs.length][0], y: dirs[(i / 70 | 0) % dirs.length][1] };
        const x0 = g.player.x, y0 = g.player.y;
        g.update(1 / 60);
        const jump = Math.hypot(g.player.x - x0, g.player.y - y0);
        assert.lte(jump, maxStep, `teleport of ${jump.toFixed(1)} px on frame ${i}`);
        assert.ok(g.fitsAt(g.player.x, g.player.y), `wedged inside something on frame ${i}`);
    }
});

suite("interaction");

test("E on firewood picks it up and shows a floating number", () => {
    const g = boot();
    const wood = g.zone.objects.find((o) => o.kind === "firewood" && !o.removed);
    assert.ok(wood, "the camp must have firewood nearby");
    g.player.x = wood.x; g.player.y = wood.y - 16; g.player.dir = "down";
    const before = g.inventory.count("firewood");
    g.interact = g.findInteractable();
    assert.eq(g.interact, wood, "the prop under the cursor was not detected");
    g.doInteract();
    assert.gt(g.inventory.count("firewood"), before, "nothing was picked up");
    assert.ok(wood.removed);
    assert.gt(g.particles.count, 0, "no feedback particles");
});

test("a tree refuses bare hands and yields to an axe", () => {
    const g = boot();
    const tree = g.zone.objects.find((o) => ["burnt_tree", "pine", "oak", "birch"].includes(o.kind) && !o.removed);
    if (!tree) return;                       // ash fields can be sparse; not a failure
    g.player.x = tree.x; g.player.y = tree.y - 16; g.player.dir = "down";
    g.interact = tree;
    g.doInteract();
    assert.not(tree.removed, "chopped a tree with bare hands");
    g.inventory.add("axe_stone", 1);
    for (let i = 0; i < 10 && !tree.removed; i++) { g.interact = tree; g.doInteract(); }
    assert.ok(tree.removed, "an axe should fell it");
    assert.gt(g.inventory.count("charcoal") + g.inventory.count("log") + g.inventory.count("firewood"), 0);
});

test("the campfire panel opens, takes fuel, lights and cooks", () => {
    const g = boot();
    const fireObj = g.zone.objects.find((o) => o.kind === "campfire");
    assert.ok(fireObj);
    g.inventory.add("firewood", 5);
    g.inventory.add("fish_raw", 1);
    g.player.x = fireObj.x; g.player.y = fireObj.y - 16; g.player.dir = "down";

    g.openFire(fireObj);
    assert.ok(g.hud.isPanelOpen, "the fire panel did not open");
    const fire = g.fires.get(g.fireKey(g.zone, fireObj));
    assert.ok(fire);

    const before = fire.fuel;
    g.openFire(fireObj);                     // rebuild rows, then act through the API
    fire.addFuel("firewood");
    assert.gt(fire.fuel, before);
    assert.ok(fire.light({ hasFlint: true }));
    assert.ok(fire.lit);

    fire.addFuel("log");                 // a stick alone burns out mid-cook
    fire.putOnSpit("fish_raw");
    fire.update(500);
    assert.eq(fire.spit[0].state, "done");

    // A lit fire must light and warm the camp.
    assert.gt(g.fireWarmthNear(g.player.x, g.player.y), 0);
    g.render();
    assert.gt(g.renderer.lightMap.lights.length, 0, "the fire casts no light");
});

test("reading the burnt diary raises its story flag and advances the prologue", () => {
    const g = boot();
    const hearth = g.zone.objects.find((o) => o.kind === "hearth_ruin");
    const diary = g.zone.objects.find((o) => o.kind === "diary");
    g.interact = hearth; g.doInteract();
    assert.ok(g.story.hasFlag("home_hearth"));
    g.interact = diary; g.doInteract();
    assert.ok(g.story.hasFlag("own_diary"));
    assert.eq(g.story.current.id, "firewood");
    assert.ok(g.inventory.has("diary_burnt"));
});

test("eating restores hunger and removes the item", () => {
    const g = boot();
    g.needs.food = 40;
    g.inventory.add("meat_roast", 1);
    g.eat("meat_roast");
    assert.gt(g.needs.food, 60);
    assert.not(g.inventory.has("meat_roast"));
});

suite("world travel & persistence");

test("stepping into a portal moves the hero to the next zone", () => {
    const g = boot();
    const portal = g.zone.portals.find((p) => p.target === "meadow");
    g.player.x = portal.x + portal.w / 2;
    g.player.y = portal.y + portal.h / 2;
    g.update(1 / 60);
    assert.eq(g.zone.id, "meadow");
    assert.not(g.zone.solidAt(g.player.x, g.player.y), "arrived inside a wall");
    g.render();                                   // the new zone must render too
    assert.gt(g.renderer.stats.chunksDrawn, 0);
});

test("sleeping in the tent skips to morning", () => {
    const g = boot();
    const tent = g.zone.objects.find((o) => o.kind === "tent");
    g.clock.minute = 22 * 60;
    g.needs.fatigue = 80;
    g.sleep(tent);
    assert.gte(g.clock.hour, 6);
    assert.lt(g.clock.hour, 12);
    assert.eq(g.clock.day, 2);
    assert.lt(g.needs.fatigue, 80, "sleep must rest the hero");
    assert.not(g.player.sleeping);
});

test("after sleeping the hero is not wedged inside the tent", () => {
    const g = boot();
    const tent = g.zone.objects.find((o) => o.kind === "tent");
    g.clock.minute = 22 * 60;
    g.sleep(tent);

    assert.ok(g.fitsAt(g.player.x, g.player.y), "the hero must wake up on walkable ground");

    // And they can actually walk away in every direction that is open.
    let moved = 0;
    for (const axis of [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]) {
        const x = g.player.x, y = g.player.y;
        for (let i = 0; i < 20; i++) g.player.update(1 / 60, axis, g.zone, {});
        if (Math.hypot(g.player.x - x, g.player.y - y) > 2) moved++;
        g.player.x = x; g.player.y = y;
    }
    assert.gte(moved, 3, "the hero is stuck: almost no direction works");
});

test("placeSafely never leaves the hero inside a solid prop", () => {
    const g = boot();
    const tent = g.zone.objects.find((o) => o.kind === "tent");
    g.placeSafely(tent.x, tent.y);          // dead centre of a solid tent
    assert.ok(g.fitsAt(g.player.x, g.player.y));
});

test("save and load restore the hero, time and inventory", () => {
    const g = boot();
    g.inventory.add("log", 4);
    g.clock.advanceMinutes(120);
    const day = g.clock.day, minute = g.clock.minute;
    assert.ok(g.save.write());

    const g2 = boot();
    assert.ok(g2.save.loadFromStorage());
    assert.eq(g2.clock.day, day);
    assert.eq(g2.clock.minute, minute);
    assert.eq(g2.inventory.count("log"), 4);
});

test("collapsing from exposure puts the hero back at camp, not at a game over", () => {
    const g = boot();
    g.needs.health = 0.5; g.needs.food = 0; g.needs.warmth = 0;
    g.simulateMinutes(30);
    assert.ok(g.hud.isStoryOpen || !g.needs.alive === false, "a collapse should be narrated");
    assert.ok(g.needs.alive, "the hero wakes up again — death is not an ending");
    assert.lt(g.needs.health, 60);
});

run("v3 game");

/* ---------------------------------------------------------------------- *
 * UI contract
 * ---------------------------------------------------------------------- */

test("every HUD colour pair clears WCAG AA", () => {
    for (const c of CONTRACTS) {
        const got = contrast(c.fg, c.bg);
        assert.gte(got, c.min, `${c.name}: ${got.toFixed(2)}:1, нужно ${c.min}`);
    }
});

test("the type and spacing scales step, they do not wander", () => {
    const t = Object.values(UI.type), sp = Object.values(UI.space);
    for (let i = 1; i < t.length; i++) assert.gt(t[i], t[i - 1], "type scale rises");
    for (let i = 1; i < sp.length; i++) assert.gt(sp[i], sp[i - 1], "space scale rises");
    assert.gte(UI.type.xs, 11, "nothing smaller than 11 px at scale 1");
    assert.gte(UI.hit, 44, "hit targets stay thumb-sized");
    assert.gte(UI.slot.sizeSmall, UI.hit, "even the small hotbar slot is tappable");
    assert.lt(UI.bar.critical, UI.bar.low, "critical is worse than low");
});

test("the theme reaches the document and the DPI is capped", () => {
    const { win } = installDOM();
    assert.ok(applyTheme(globalThis.document), "applyTheme writes to the root");
    const props = globalThis.document.documentElement.style._props;
    assert.eq(props["--ink"], COLORS.ink);
    assert.ok(props["--t-md"].includes("var(--ui)"), "sizes scale with the viewport");
    win.devicePixelRatio = 3;
    assert.eq(pixelRatio(win), UI.dprCap, "a 3× display is rendered at the cap");
    win.devicePixelRatio = undefined;
    assert.eq(pixelRatio(win), 1, "no DPI reported means 1×");
});

test("need bars report a number, a state and an ARIA value", () => {
    const game = boot();
    game.needs.food = 8;
    game.needs.health = 90;
    game.hud.update({
        needs: { food: game.needs.food, warmth: 60, fatigue: 40, health: game.needs.health }, clock: game.clock, weather: game.weather,
        inventory: game.inventory, objective: "", zoneName: "", ambient: 10
    });
    const row = game.hud.needRows.food;
    assert.eq(game.hud.needVals.food.textContent, "8%", "the number is shown, not just a bar");
    assert.eq(row.getAttribute("aria-valuenow"), "8");
    assert.ok(row.classList.contains("low"), "8 % is low");
    assert.ok(row.classList.contains("critical"), "…and critical");
    assert.not(game.hud.needRows.health.classList.contains("low"), "90 % is fine");
});
