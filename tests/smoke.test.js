/**
 * tests — headless prologue playthrough.
 *
 * No DOM, no renderer: we drive the same systems main.js drives and play
 * "Act I" start to finish — wake up on the ashes, read the diary, gather
 * firewood, light the fire, roast a fish, eat it, survive the night, walk
 * north. If this test passes, the prologue is actually completable.
 */
import { suite, test, assert, run } from "./tiny.js";
import { EventBus } from "../js/core/events.js";
import { GameClock } from "../js/core/time.js";
import { RNG } from "../js/core/rng.js";
import { WorldMap } from "../js/world/worldgen.js";
import { WeatherSystem } from "../js/world/weather.js";
import { biomeDef } from "../js/world/regions.js";
import { TILE_SIZE } from "../js/world/tiles.js";
import { Player } from "../js/entities/player.js";
import { Inventory } from "../js/sandbox/inventory.js";
import { Needs } from "../js/survival/needs.js";
import { Campfire } from "../js/survival/campfire.js";
import { CookingJournal } from "../js/survival/cooking.js";
import { ambientTemperature } from "../js/survival/temperature.js";
import { StoryEngine } from "../js/story/acts.js";
import { rollDrops, propDef, requiredTool } from "../js/sandbox/gather.js";
import { foodValue } from "../js/sandbox/items.js";

/** A headless mirror of the parts of Game that do not need a canvas. */
function bootstrap(seed = "ashes-and-grain") {
    const bus = new EventBus();
    const rng = new RNG(seed);
    const clock = new GameClock({ bus, minute: 16 * 60 + 40, day: 1 });
    const weather = new WeatherSystem({ bus, seed: 1, clock });
    const world = new WorldMap(1);
    const zone = world.get("ashfall");
    const player = new Player({ x: zone.spawn.x, y: zone.spawn.y });
    const inventory = new Inventory({ bus });
    const needs = new Needs({ bus });
    const journal = new CookingJournal({ bus });
    const game = { bus, clock, weather, world, zone, player, inventory, needs, journal, rng };
    game.story = new StoryEngine({ bus, game });
    game.fires = new Map();

    inventory.add("knife", 1);
    inventory.add("flint", 1);

    game.fireFor = (obj) => {
        const key = `${obj.tx},${obj.ty}`;
        if (!game.fires.has(key)) game.fires.set(key, new Campfire({ bus }));
        return game.fires.get(key);
    };
    game.ambient = () => ambientTemperature({
        season: clock.season.key, daylight: clock.daylight,
        weather: weather.current, biomeTemp: biomeDef(zone.def.biome).temp
    });
    game.fireWarmth = () => {
        let best = 0;
        for (const obj of zone.objects) {
            if (obj.kind !== "campfire" || obj.removed) continue;
            const f = game.fires.get(`${obj.tx},${obj.ty}`);
            if (f && f.lit) best = Math.max(best, f.warmth);
        }
        return best;
    };
    game.simulate = (minutes, sleeping = false) => {
        clock.advanceMinutes(minutes);
        for (const [, f] of game.fires) f.update(minutes * 60);
        needs.update(minutes, {
            ambient: game.ambient(), fireWarmth: game.fireWarmth(),
            sheltered: sleeping, sleeping, activity: sleeping ? 0.3 : 1
        });
    };
    game.harvest = (obj) => {
        const tool = requiredTool(obj.kind);
        if (tool && !inventory.findTool(tool)) return false;
        const drops = rollDrops(obj, rng);
        for (const d of drops) inventory.add(d.id, d.n);
        obj.removed = true;
        zone.removeSolid(obj);
        bus.emit("world:harvest", { kind: obj.kind, drops });
        return true;
    };
    return game;
}

suite("prologue");

test("the world boots with a camp and a starting kit", () => {
    const g = bootstrap();
    assert.ok(g.zone.objects.some((o) => o.kind === "tent"));
    assert.ok(g.zone.objects.some((o) => o.kind === "campfire"));
    assert.ok(g.inventory.has("flint"));
    assert.eq(g.story.current.id, "wake");
    assert.eq(g.clock.day, 1);
    assert.ok(g.clock.minute > 16 * 60, "the prologue starts in the late afternoon");
});

test("there is enough firewood lying around to survive the first night", () => {
    const g = bootstrap();
    let wood = 0;
    for (const obj of g.zone.objects) {
        if (obj.kind === "firewood" || obj.kind === "burnt_stump" || obj.kind === "dead_tree") wood++;
    }
    assert.gt(wood, 10, `only ${wood} sources of fuel in the starting zone`);
});

test("full Act I playthrough: ashes → fire → food → morning", () => {
    const g = bootstrap();
    const steps = [];
    g.bus.on("story:step", (s) => steps.push(s.title));

    // 1. Look at the hearth of your burnt house, read your own diary.
    const hearth = g.zone.objects.find((o) => o.kind === "hearth_ruin");
    const diary = g.zone.objects.find((o) => o.kind === "diary");
    assert.ok(hearth && diary);
    g.story.setFlag(hearth.story);
    g.story.setFlag(diary.story);
    assert.eq(g.story.current.id, "firewood");

    // 2. Gather fuel from the ash field.
    let gathered = 0;
    for (const obj of g.zone.objects.slice()) {
        if (gathered >= 6) break;
        if (obj.kind !== "firewood" || obj.removed) continue;
        if (g.harvest(obj)) gathered++;
    }
    assert.gte(g.inventory.count("firewood"), 5, "could not find firewood");
    assert.eq(g.story.current.id, "light_fire");

    // 3. Light the fire with flint.
    const fireObj = g.zone.objects.find((o) => o.kind === "campfire");
    const fire = g.fireFor(fireObj);
    g.inventory.remove("firewood", 3);
    fire.addFuel("firewood"); fire.addFuel("firewood"); fire.addFuel("firewood");
    assert.ok(fire.light({ hasFlint: g.inventory.has("flint") }));
    assert.eq(g.story.current.id, "cook");

    // 4. Cook a fish on the spit — and do not forget it.
    g.inventory.add("fish_raw", 1);
    g.inventory.remove("fish_raw", 1);
    fire.putOnSpit("fish_raw");
    g.simulate(9);                               // nine in-game minutes of heat
    assert.eq(fire.spit[0].state, "done");
    const taken = fire.takeFromSpit(0);
    assert.eq(taken.id, "fish_grill");
    g.inventory.add(taken.id, 1);
    g.journal.discover(taken.id);
    assert.eq(g.story.current.id, "eat");

    // 5. Eat it.
    const before = g.needs.food;
    g.inventory.remove("fish_grill", 1);
    g.needs.consume(foodValue("fish_grill"));
    assert.gt(g.needs.food, before);
    assert.eq(g.story.current.id, "survive_night");

    // 6. Keep the fire going and sleep through the night.
    for (let i = 0; i < 4; i++) { fire.addFuel("log"); }
    let guard = 0;
    while (!(g.clock.hour >= 6 && g.clock.hour < 12) && guard++ < 300) g.simulate(10, true);
    g.bus.emit("player:slept", { day: g.clock.day });

    assert.ok(g.needs.alive, "the hero must survive the first night by the fire");
    assert.gt(g.needs.health, 20);
    assert.eq(g.clock.day, 2, "a night has passed");
    assert.eq(g.story.current.id, "find_smoke");
    assert.eq(g.story.act, 2);
    assert.eq(steps.length, 7);
});

test("a night WITHOUT a fire is genuinely dangerous", () => {
    const g = bootstrap();
    g.clock.minute = 21 * 60;
    g.needs.food = 50; g.needs.warmth = 45;
    for (let i = 0; i < 48; i++) g.simulate(10, false);   // 8 hours outdoors, no fire
    assert.lt(g.needs.warmth, 45, "should be colder by morning");
    assert.lt(g.needs.health, 100, "exposure must cost health");
});

test("the fire burns out if you never feed it", () => {
    const g = bootstrap();
    const fireObj = g.zone.objects.find((o) => o.kind === "campfire");
    const fire = g.fireFor(fireObj);
    fire.addFuel("firewood");
    fire.light();
    for (let i = 0; i < 10; i++) g.simulate(10);
    assert.not(fire.lit, "one stick should not last an hour and a half");
});

suite("travel");

test("walking north out of the ashes leads to the meadow", () => {
    const g = bootstrap();
    const portal = g.zone.portals.find((p) => p.target === "meadow");
    assert.ok(portal, "the prologue zone must link onward");
    const next = g.world.get(portal.target);
    assert.eq(next.def.id, "meadow");
    assert.ok(next.portals.some((p) => p.target === "ashfall"), "and back again");
});

test("the valley loads every connected zone from the start zone", () => {
    const g = bootstrap();
    const seen = new Set();
    const queue = ["ashfall"];
    while (queue.length) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        const z = g.world.get(id);
        for (const p of z.portals) queue.push(p.target);
    }
    assert.gte(seen.size, 10, `only ${seen.size} zones reachable from the camp`);
});

test("a long session stays stable: 3 in-game days of simulation", () => {
    const g = bootstrap();
    const fireObj = g.zone.objects.find((o) => o.kind === "campfire");
    const fire = g.fireFor(fireObj);
    for (let i = 0; i < 432; i++) {               // 3 days in 10-minute ticks
        if (i % 24 === 0) { fire.addFuel("log"); if (!fire.lit) fire.light(); }
        if (i % 36 === 0) g.needs.consume(foodValue("meat_roast"));
        g.simulate(10, g.clock.isNight);
    }
    assert.eq(g.clock.day, 4);
    assert.ok(g.needs.alive, "a fed hero by a fire must survive three days");
    assert.gte(g.needs.health, 30);
});

run("smoke");
