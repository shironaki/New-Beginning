/** tests — story engine and the prologue script. */
import { suite, test, assert, run } from "./tiny.js";
import { EventBus } from "../js/core/events.js";
import { StoryEngine, STORY_STEPS, ACTS } from "../js/story/acts.js";
import { Inventory } from "../js/sandbox/inventory.js";

function makeStory() {
    const bus = new EventBus();
    const game = { inventory: new Inventory({ bus }) };
    const story = new StoryEngine({ bus, game });
    return { bus, game, story };
}

suite("story data");

test("steps are unique, ordered by act and all have an objective", () => {
    const seen = new Set();
    let act = 1;
    for (const s of STORY_STEPS) {
        assert.not(seen.has(s.id), `duplicate step id ${s.id}`);
        seen.add(s.id);
        assert.ok(s.title && s.text && s.objective, `step ${s.id} is incomplete`);
        assert.ok(s.on, `step ${s.id} has no trigger`);
        assert.gte(s.act, act, "acts must not go backwards");
        act = s.act;
    }
    assert.eq(ACTS.length, 5);
});

suite("story engine");

test("the prologue advances only on the right event", () => {
    const { bus, story } = makeStory();
    assert.eq(story.current.id, "wake");
    bus.emit("fire:lit", {});                       // wrong event for this step
    assert.eq(story.current.id, "wake");
    story.setFlag("home_hearth");
    assert.eq(story.current.id, "diary");
});

test("a predicate gates the step: 5 firewood, not 1", () => {
    const { bus, game, story } = makeStory();
    story.setFlag("home_hearth");
    story.setFlag("own_diary");
    assert.eq(story.current.id, "firewood");
    game.inventory.add("firewood", 2);
    assert.eq(story.current.id, "firewood", "two sticks is not enough");
    game.inventory.add("firewood", 3);
    assert.eq(story.current.id, "light_fire");
});

test("the whole prologue can be completed and reaches act 2", () => {
    const { bus, game, story } = makeStory();
    const titles = [];
    bus.on("story:step", (s) => titles.push(s.title));

    story.setFlag("home_hearth");
    story.setFlag("own_diary");
    game.inventory.add("firewood", 5);
    bus.emit("fire:lit", {});
    bus.emit("cook:take", { state: "done", id: "meat_roast" });
    bus.emit("needs:consume", { food: 34 });
    bus.emit("player:slept", { day: 2 });
    assert.eq(story.current.id, "find_smoke");
    assert.eq(story.act, 2);
    bus.emit("zone:enter", { zone: "meadow" });
    assert.ok(story.done, "prologue should be finished");
    assert.eq(titles.length, STORY_STEPS.length);
});

test("flags fire once and survive a save round-trip", () => {
    const { bus, story } = makeStory();
    let flags = 0;
    bus.on("story:flag", () => flags++);
    assert.ok(story.setFlag("home_hearth"));
    assert.not(story.setFlag("home_hearth"));
    assert.eq(flags, 1);

    const copy = new StoryEngine({ bus: new EventBus(), game: {} });
    copy.load(JSON.parse(JSON.stringify(story.toJSON())));
    assert.ok(copy.hasFlag("home_hearth"));
    assert.eq(copy.index, story.index);
});

test("an unfinished objective is always readable for the HUD", () => {
    const { story } = makeStory();
    assert.ok(story.objective.length > 3);
});

run("story");
