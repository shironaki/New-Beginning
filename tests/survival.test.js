/** v3 tests — survival: needs, temperature, campfire, cooking, inventory, gathering. */
import { suite, test, assert, run } from "./tiny.js";
import { EventBus } from "../js/core/events.js";
import { RNG } from "../js/core/rng.js";
import { Needs } from "../js/survival/needs.js";
import { ambientTemperature, feltWarmth, warmthBand } from "../js/survival/temperature.js";
import { Campfire, COOK_STATE } from "../js/survival/campfire.js";
import { resolveSpit, resolvePot, isCookable, CookingJournal } from "../js/survival/cooking.js";
import { Inventory } from "../js/sandbox/inventory.js";
import { ITEMS, itemDef, foodValue, burnValue } from "../js/sandbox/items.js";
import { PROPS, propDef, rollDrops, requiredTool, toolHint } from "../js/sandbox/gather.js";
import { Player } from "../js/entities/player.js";
import { generateZone } from "../js/world/worldgen.js";
import { GAIT } from "../js/render/charspec.js";

suite("items");

test("every item is well formed", () => {
    for (const [id, d] of Object.entries(ITEMS)) {
        assert.ok(d.name, `${id} has no name`);
        assert.ok(Array.isArray(d.tags), `${id} has no tags`);
        assert.gte(d.stack, 1);
    }
});

test("cooked food is strictly more nourishing than raw", () => {
    assert.gt(foodValue("meat_roast").food, foodValue("meat_raw").food);
    assert.gt(foodValue("fish_grill").food, foodValue("fish_raw").food);
    assert.gt(foodValue("stew_meat").food, foodValue("meat_roast").food);
});

test("fuel values are ordered: hay < firewood < log < coal", () => {
    assert.lt(burnValue("hay"), burnValue("firewood"));
    assert.lt(burnValue("firewood"), burnValue("log"));
    assert.lt(burnValue("log"), burnValue("coal"));
    assert.eq(burnValue("stone"), 0);
});

suite("inventory");

test("stacking spills into new slots", () => {
    const inv = new Inventory({ slots: 3 });
    assert.eq(inv.add("firewood", 60), 0, "60 of 150 capacity must fit");
    assert.eq(inv.count("firewood"), 60);
    assert.eq(inv.used, 2, "50 + 10 across two slots");
    assert.eq(inv.free, 1);
});

test("a full backpack reports what did not fit", () => {
    const inv = new Inventory({ slots: 1 });
    const left = inv.add("stone", 120);         // stack of 50 in a single slot
    assert.eq(left, 70);
    assert.eq(inv.count("stone"), 50);
});

test("remove takes from the end and frees slots", () => {
    const inv = new Inventory({ slots: 4 });
    inv.add("berry", 45);
    assert.eq(inv.remove("berry", 45), 45);
    assert.eq(inv.used, 0);
    assert.eq(inv.remove("berry", 1), 0);
});

test("tools are found anywhere in the bag, not just the hotbar", () => {
    const inv = new Inventory({ slots: 10 });
    for (let i = 0; i < 8; i++) inv.add("stone", 1);
    inv.add("axe_stone", 1);
    const found = inv.findTool("axe");
    assert.ok(found);
    assert.eq(found.id, "axe_stone");
    assert.eq(inv.findTool("pick"), null);
});

test("weight accumulates and survives a save round-trip", () => {
    const inv = new Inventory({ slots: 6 });
    inv.add("log", 3);
    assert.gt(inv.weight, 8);
    const copy = new Inventory({ slots: 6 }).load(inv.toJSON());
    assert.eq(copy.count("log"), 3);
});

suite("temperature");

test("night is colder than noon, winter colder than summer", () => {
    const noon = ambientTemperature({ season: "summer", daylight: 1 });
    const night = ambientTemperature({ season: "summer", daylight: 0 });
    const winter = ambientTemperature({ season: "winter", daylight: 1 });
    assert.gt(noon, night);
    assert.gt(noon, winter);
});

test("rain and the mountain pass bite", () => {
    const dry = ambientTemperature({ season: "autumn", daylight: 1, weather: "clear" });
    const wet = ambientTemperature({ season: "autumn", daylight: 1, weather: "rain" });
    assert.lt(wet, dry);
    assert.lt(ambientTemperature({ season: "winter", daylight: 1, biomeTemp: -12 }), -8);
});

test("a fire turns a deadly night into a survivable one", () => {
    const cold = feltWarmth({ ambient: -5 });
    const byFire = feltWarmth({ ambient: -5, fireWarmth: 24, sheltered: true });
    assert.lt(cold, 25);
    assert.gt(byFire, 45);
    assert.eq(warmthBand(5).key, "freezing");
    assert.eq(warmthBand(55).key, "ok");
});

suite("needs");

test("hunger drains and food restores it", () => {
    const n = new Needs();
    n.food = 50;
    n.update(60, { ambient: 18 });
    assert.lt(n.food, 50);
    const before = n.food;
    n.consume(foodValue("meat_roast"));
    assert.gt(n.food, before + 30);
});

test("a freezing night kills, a warm camp does not", () => {
    const cold = new Needs();
    cold.warmth = 5; cold.food = 60;
    cold.update(240, { ambient: -20 });
    assert.lt(cold.health, 100, "cold must hurt");

    const warm = new Needs();
    warm.food = 80; warm.warmth = 55; warm.health = 80;
    warm.update(240, { ambient: -20, fireWarmth: 26, sheltered: true });
    assert.gte(warm.health, 80, "a fire should keep you alive");
});

test("collapse fires once and revive brings you back weakened", () => {
    const bus = new EventBus();
    let collapses = 0;
    bus.on("player:collapse", () => collapses++);
    const n = new Needs({ bus });
    n.health = 1; n.food = 0; n.warmth = 0;
    n.update(120, { ambient: -30 });
    n.update(120, { ambient: -30 });
    assert.eq(collapses, 1);
    assert.not(n.alive);
    n.revive();
    assert.ok(n.alive);
    assert.lt(n.health, 50);
});

test("sleeping restores stamina and heals", () => {
    const n = new Needs();
    n.fatigue = 90; n.health = 60; n.food = 70; n.warmth = 55;
    n.update(480, { ambient: 10, sleeping: true, sheltered: true });
    assert.lt(n.fatigue, 20);
    assert.gt(n.health, 60);
});

test("hunger, cold and exhaustion slow you down", () => {
    const n = new Needs();
    assert.near(n.speedFactor(), 1, 0.01);
    n.food = 5; n.fatigue = 95; n.warmth = 10;
    assert.lt(n.speedFactor(), 0.7);
    assert.gte(n.speedFactor(), 0.42);
});

test("difficulty scales the drain", () => {
    const soft = new Needs({ difficulty: "soft" });
    const hard = new Needs({ difficulty: "hard" });
    soft.update(120, { ambient: 15 });
    hard.update(120, { ambient: 15 });
    assert.gt(soft.food, hard.food);
});

suite("cooking");

test("the fire knows what to do with raw food by tags alone", () => {
    assert.eq(resolveSpit("meat_raw").out, "meat_roast");
    assert.eq(resolveSpit("fish_raw").out, "fish_grill");
    assert.eq(resolveSpit("root").out, "root_baked");
    assert.eq(resolveSpit("meat_roast"), null, "already cooked");
    assert.eq(resolveSpit("stone"), null, "stone is not food");
    assert.ok(isCookable("mushroom"));
});

test("the pot resolves combinations, not a recipe list", () => {
    assert.eq(resolvePot(["meat_raw", "root"]).id, "stew_meat");
    assert.eq(resolvePot(["fish_raw", "root"]).id, "fish_soup");
    assert.eq(resolvePot(["herb_mint"]).id, "herb_tea");
    assert.eq(resolvePot(["berry", "berry"], false).id, "berry_jam");
    assert.eq(resolvePot(["stone", "flint"]), null);
    assert.eq(resolvePot(["herb_mint"], false), null, "tea needs water");
});

test("the journal fills by discovery and never duplicates", () => {
    const bus = new EventBus();
    let found = 0;
    bus.on("cook:discovered", () => found++);
    const j = new CookingJournal({ bus });
    assert.ok(j.discover("stew_meat"));
    assert.not(j.discover("stew_meat"));
    assert.eq(j.count, 1);
    assert.eq(found, 1);
    assert.ok(j.knows("stew_meat"));
});

suite("campfire");

test("needs fuel and a spark to light", () => {
    const f = new Campfire();
    assert.not(f.light(), "nothing to burn");
    f.addFuel("firewood");
    assert.not(f.light({ hasFlint: false }), "no spark");
    assert.ok(f.light({ hasFlint: true }));
    assert.ok(f.lit);
    assert.gt(f.lightRadius, 0);
    assert.gt(f.warmth, 8);
});

test("fuel burns down and the fire goes out", () => {
    const bus = new EventBus();
    let out = 0;
    bus.on("fire:out", () => out++);
    const f = new Campfire({ bus });
    f.addFuel("hay");                 // kindling: 4 in-game minutes
    f.light();
    f.update(300);
    assert.not(f.lit);
    assert.eq(out, 1);
    assert.eq(f.lightRadius, 0);
});

test("food goes raw → cooking → done → burnt if you forget it", () => {
    const f = new Campfire();
    f.addFuel("coal"); f.light();
    const i = f.putOnSpit("meat_raw");
    assert.gte(i, 0);
    f.update(60);
    assert.eq(f.spit[0].state, COOK_STATE.COOKING);
    f.update(700);
    assert.eq(f.spit[0].state, COOK_STATE.DONE);
    const taken = new Campfire();
    taken.addFuel("coal"); taken.light(); taken.putOnSpit("fish_raw");
    for (let s = 0; s < 400; s++) taken.update(5);  // walked away for half an hour
    assert.eq(taken.spit[0].state, COOK_STATE.BURNT);
    assert.eq(taken.takeFromSpit(0).id, "food_burnt");
});

test("the pit shows what you threw in, and it chars as it burns", () => {
    const f = new Campfire();
    f.addFuel("log");
    f.addFuel("firewood");
    assert.eq(f.stack.length, 2);
    assert.eq(f.stack[0].id, "log");
    assert.eq(f.stack[1].burn, 1, "fresh fuel is untouched");

    f.light();
    f.update(2000);                         // the log is partly gone
    assert.lt(f.stack[0].burn, 1);
    assert.gt(f.stack[0].burn, 0);
    assert.eq(f.stack[1].burn, 1, "the piece underneath has not caught yet");
    assert.ok(f.lit);
});

test("one log burns for over an hour, and a night needs several", () => {
    const f = new Campfire();
    f.addFuel("log");
    f.light();
    f.update(60 * 60);                      // one in-game hour
    assert.ok(f.lit, "a log must survive a whole in-game hour");
    f.update(60 * 30);                      // and a half
    assert.not(f.lit, "but not two");

    const night = new Campfire();
    for (let i = 0; i < 8; i++) night.addFuel("log");
    night.light();
    night.update(60 * 60 * 8);              // dusk to dawn
    assert.ok(night.fuel >= 0);
    assert.gt(night.ashes, 0, "burnt fuel leaves ash behind");
});

test("the fire sinks to embers before it dies", () => {
    const f = new Campfire();
    f.addFuel("firewood");
    f.light();
    f.update(1000);                         // 200 s of fuel left
    assert.ok(f.lit);
    assert.lt(f.intensity, 1, "it should be dying down, not at full blaze");
    assert.gt(f.intensity, 0.2);
});

test("an unlit fire cooks nothing", () => {
    const f = new Campfire();
    f.putOnSpit("meat_raw");
    f.update(300);
    assert.eq(f.spit[0].state, COOK_STATE.RAW);
    assert.eq(f.takeFromSpit(0).id, "meat_raw", "raw food comes back unharmed");
});

test("embers are slower but more forgiving than the spit", () => {
    const a = new Campfire(); a.addFuel("coal"); a.light(); a.putOnSpit("root");
    const b = new Campfire(); b.addFuel("coal"); b.light(); b.putInEmbers("root");
    a.update(550); b.update(550);
    assert.eq(a.spit[0].state, COOK_STATE.DONE);
    assert.eq(b.embers[0].state, COOK_STATE.COOKING);
});

test("the spit has a limited number of places", () => {
    const f = new Campfire({ spitSlots: 2 });
    assert.gte(f.putOnSpit("meat_raw"), 0);
    assert.gte(f.putOnSpit("fish_raw"), 0);
    assert.eq(f.putOnSpit("root"), -1);
});

test("the pot needs to be installed, then cooks a discovered dish", () => {
    const f = new Campfire();
    assert.eq(f.startPot(["meat_raw", "root"]), null, "no pot yet");
    f.installPot();
    f.addFuel("coal"); f.light();
    const pot = f.startPot(["meat_raw", "root"]);
    assert.eq(pot.result, "stew_meat");
    f.update(1600);
    assert.ok(f.pot.done);
    assert.eq(f.takePot(), "stew_meat");
});

test("collectReady picks up everything finished in one go", () => {
    const f = new Campfire();
    f.addFuel("coal"); f.light();
    f.putOnSpit("meat_raw"); f.putInEmbers("root");
    f.update(1200);
    const got = f.collectReady();
    assert.gte(got.length, 1);
});

test("a campfire survives a save round-trip mid-cook", () => {
    const f = new Campfire();
    f.addFuel("log"); f.light(); f.putOnSpit("fish_raw");
    f.update(60);
    const copy = new Campfire().load(JSON.parse(JSON.stringify(f.toJSON())));
    assert.ok(copy.lit);
    assert.eq(copy.spit[0].itemId, "fish_raw");
    copy.update(600);
    assert.eq(copy.spit[0].state, COOK_STATE.DONE);
});

suite("gathering");

test("the tool rule holds: trees need an axe, berries do not", () => {
    assert.eq(requiredTool("pine"), "axe");
    assert.eq(requiredTool("rock"), "pick");
    assert.eq(requiredTool("firewood"), null);
    assert.eq(requiredTool("bush"), null);
    assert.ok(toolHint("pine").includes("топор"));
});

test("drops are deterministic per RNG and respect the object's state", () => {
    const rng = new RNG(4);
    const berries = rollDrops({ kind: "bush", berries: true }, rng);
    assert.ok(berries.some((d) => d.id === "berry"));
    const bare = rollDrops({ kind: "bush", berries: false }, new RNG(4));
    assert.not(bare.some((d) => d.id === "berry"));
    const ore = rollDrops({ kind: "ore_rock", ore: "copper" }, new RNG(1));
    assert.ok(ore.some((d) => d.id === "copper"));
});

test("every prop definition is coherent", () => {
    for (const [kind, d] of Object.entries(PROPS)) {
        assert.ok(d.name, `${kind} has no name`);
        if (d.drops) assert.ok(Array.isArray(d.drops));
        if (d.tool) assert.ok(["axe", "pick", "knife", "hoe", "rod"].includes(d.tool), `${kind}: odd tool`);
    }
});

suite("player");

test("movement is analogue: a gentle push walks, a full push runs", () => {
    const zone = generateZone("meadow", 6);
    const p = new Player({ x: zone.spawn.x, y: zone.spawn.y });
    const start = p.x;
    p.update(0.5, { x: 0.3, y: 0 }, zone, {});
    const slow = p.x - start;
    p.x = start;
    p.update(0.5, { x: 1, y: 0 }, zone, { wantRun: true });
    const fast = p.x - start;
    assert.gt(Math.abs(fast), Math.abs(slow));
    assert.eq(p.dir, "right");
});

test("sprinting drains stamina and resting restores it", () => {
    const p = new Player({ x: 100, y: 100 });
    p.update(2, { x: 1, y: 0 }, null, { wantRun: true });
    assert.lt(p.stamina, 100);
    const low = p.stamina;
    p.update(2, { x: 0, y: 0 }, null, {});
    assert.gt(p.stamina, low);
});

test("the player cannot walk through a tree", () => {
    const zone = generateZone("forest", 15);
    const tree = zone.objects.find((o) => o.kind === "pine" || o.kind === "spruce");
    assert.ok(tree, "forest must have trees");
    const p = new Player({ x: tree.x, y: tree.y + 40 });
    for (let i = 0; i < 60; i++) p.update(1 / 60, { x: 0, y: -1 }, zone, {});
    assert.gt(Math.hypot(p.x - tree.x, p.y - tree.y), 14, "walked into a tree");
});

suite("locomotion");

const walkFor = (seconds, dt) => {
    const p = new Player({ x: 0, y: 0 });
    for (let i = 0; i < Math.round(seconds / dt); i++) p.update(dt, { x: 1, y: 0 }, null, {});
    return p;
};

test("the walk cycle is distance driven: 30, 60 and 120 FPS agree", () => {
    const a = walkFor(1, 1 / 30), b = walkFor(1, 1 / 60), c = walkFor(1, 1 / 120);
    assert.near(a.dist, b.dist, 1e-9, "distance must not depend on the frame rate");
    assert.near(b.dist, c.dist, 1e-9);
    assert.near(a.anim, b.anim, 1e-9, "walk phase must not depend on the frame rate");
    assert.near(b.anim, c.anim, 1e-9);
});

test("one stride of ground equals exactly one cycle of the legs", () => {
    const p = new Player({ x: 0, y: 0 });
    const dt = 1 / 60;
    // Walk exactly one stride worth of ground.
    const steps = Math.round((GAIT.strideWalk / p.walkSpeed) / dt);
    for (let i = 0; i < steps; i++) p.update(dt, { x: 1, y: 0 }, null, {});
    const cycles = p.dist / GAIT.strideWalk;
    assert.near(p.dist, GAIT.strideWalk, 0.6, "walked the wrong distance");
    assert.near(cycles, 1, 0.03, "feet and ground drifted apart");
    assert.near(Math.cos(p.anim), 1, 0.05, "the cycle did not close");
});

test("a slowdown slows the legs too: no skating in mud", () => {
    const fast = new Player({ x: 0, y: 0 });
    const slow = new Player({ x: 0, y: 0 });
    for (let i = 0; i < 60; i++) {
        fast.update(1 / 60, { x: 1, y: 0 }, null, {});
        slow.update(1 / 60, { x: 1, y: 0 }, null, { speedFactor: 0.5 });
    }
    assert.near(slow.dist, fast.dist / 2, 1e-6);
    assert.near(slow.anim / slow.dist, fast.anim / fast.dist, 1e-6,
        "phase per pixel must be constant whatever the speed");
});

test("idle to walk to idle blends instead of snapping", () => {
    const p = new Player({ x: 0, y: 0 });
    p.update(1 / 60, { x: 1, y: 0 }, null, {});
    assert.lt(p.gait, 0.25, "the gait blend snapped open in one frame");
    for (let i = 0; i < 60; i++) p.update(1 / 60, { x: 1, y: 0 }, null, {});
    assert.near(p.gait, 1, 1e-9, "the blend never reached a full stride");
    p.update(1 / 60, { x: 0, y: 0 }, null, {});
    assert.gt(p.gait, 0.7, "the gait blend snapped shut in one frame");
});

test("stopping parks the legs on a contact pose", () => {
    const p = new Player({ x: 0, y: 0 });
    for (let i = 0; i < 37; i++) p.update(1 / 60, { x: 1, y: 0 }, null, {});
    for (let i = 0; i < 30; i++) p.update(1 / 60, { x: 0, y: 0 }, null, {});
    const k = p.anim / Math.PI;
    assert.near(k - Math.round(k), 0, 1e-9, "the hero stopped mid-stride");
    assert.near(p.gait, 0, 1e-9);
});

test("the cadence is capped so a speed buff cannot sew", () => {
    const p = new Player({ x: 0, y: 0 });
    const before = p.anim;
    p.update(1 / 60, { x: 1, y: 0 }, null, { speedFactor: 40 });
    const cap = GAIT.cadenceCap * Math.PI * 2 / 60;
    assert.lte(p.anim - before, cap + 1e-9);
});


run("v3 survival");
