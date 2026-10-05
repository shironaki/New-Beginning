/** v3 tests — world: tiles, chunked map, collision, zone generation, weather. */
import { suite, test, assert, run } from "./tiny.js";
import { T, TILES, tileInfo, isSolidTile, TILE_SIZE } from "../js/world/tiles.js";
import { TileMap, moveAndCollide, CHUNK } from "../js/world/tilemap.js";
import { generateZone, WorldMap, Zone } from "../js/world/worldgen.js";
import { ZONES, BIOMES, valleyTileCount, oppositeEdge, zoneDef } from "../js/world/regions.js";
import { WeatherSystem, WEATHER } from "../js/world/weather.js";
import { GameClock } from "../js/core/time.js";
import { EventBus } from "../js/core/events.js";

suite("tiles");

test("every tile has a complete definition", () => {
    for (const [id, def] of Object.entries(TILES)) {
        assert.ok(def.key, `tile ${id} has no key`);
        assert.ok(Array.isArray(def.colors) && def.colors.length === 3, `tile ${def.key} needs 3 colours`);
        assert.ok(typeof def.solid === "boolean");
        assert.gte(def.speed, 0);
    }
});

test("water stops you at the shoreline; paths are faster than mud", () => {
    assert.ok(isSolidTile(T.WATER), "no swimming yet — the shallows stop you");
    assert.ok(isSolidTile(T.DEEP));
    assert.ok(isSolidTile(T.CLIFF));
    assert.gt(tileInfo(T.PATH).speed, tileInfo(T.MUD).speed);
});

suite("tilemap");

test("get/set, bounds and out-of-range reads", () => {
    const m = new TileMap(10, 8, T.GRASS);
    assert.eq(m.get(0, 0), T.GRASS);
    m.set(3, 3, T.WATER);
    assert.eq(m.get(3, 3), T.WATER);
    assert.eq(m.get(-1, 0), T.VOID);
    assert.eq(m.get(99, 99), T.VOID);
    assert.eq(m.widthPx, 10 * TILE_SIZE);
});

test("dirty chunks track edits and clear on demand", () => {
    const m = new TileMap(40, 40);
    m.dirtyChunks.clear();
    m.set(20, 20, T.PATH);
    assert.gte(m.dirtyChunks.size, 1);
    assert.eq(m.chunksX, Math.ceil(40 / CHUNK));
});

test("chunksInRect only returns visible chunks", () => {
    const m = new TileMap(64, 64);
    const all = m.chunksInRect(0, 0, m.widthPx, m.heightPx);
    const few = m.chunksInRect(0, 0, 100, 100);
    assert.eq(all.length, m.chunksX * m.chunksY);
    assert.lt(few.length, all.length);
});

test("collision slides along walls instead of sticking", () => {
    const m = new TileMap(10, 10, T.GRASS);
    m.fillRect(5, 0, 1, 10, T.CLIFF);          // vertical wall at x=5
    const start = { x: 4 * TILE_SIZE + 10, y: 2 * TILE_SIZE };
    const res = moveAndCollide(m, start.x, start.y, 20, 10, 9);
    assert.ok(res.hitX, "should be blocked horizontally");
    assert.gt(res.y, start.y, "should still slide vertically");
});

test("collision keeps the mover inside the map", () => {
    const m = new TileMap(10, 10, T.GRASS);
    const res = moveAndCollide(m, 5, 5, -500, -500, 9);
    assert.gte(res.x, 9);
    assert.gte(res.y, 9);
});

suite("regions");

test("the valley is far bigger than the v2 village", () => {
    const v2Tiles = 26 * 18;                    // the whole v2 map
    const total = valleyTileCount();
    assert.gt(total, v2Tiles * 5, "world must be at least 5× bigger");
    assert.gt(total, 40000, `expected 40k+ tiles, got ${total}`);
});

test("every zone declares a known biome and valid links", () => {
    for (const z of Object.values(ZONES)) {
        assert.ok(BIOMES[z.biome], `zone ${z.id} has unknown biome ${z.biome}`);
        assert.gt(z.w, 20); assert.gt(z.h, 20);
        for (const l of z.links || []) {
            assert.ok(ZONES[l.target], `zone ${z.id} links to missing ${l.target}`);
            assert.lt(l.from, l.to);
            const limit = (l.edge === "north" || l.edge === "south") ? z.w : z.h;
            assert.lt(l.to, limit, `link on ${z.id}.${l.edge} runs off the edge`);
        }
    }
});

test("links are mutual where they should be", () => {
    assert.eq(oppositeEdge("north"), "south");
    const ash = zoneDef("ashfall");
    const north = ash.links.find((l) => l.edge === "north");
    assert.eq(north.target, "meadow");
    const back = zoneDef("meadow").links.find((l) => l.target === "ashfall");
    assert.ok(back, "meadow must link back to ashfall");
    assert.eq(back.edge, "south");
});

suite("worldgen");

test("generation is deterministic for a given seed", () => {
    const a = generateZone("meadow", 777);
    const b = generateZone("meadow", 777);
    assert.deep(Array.from(a.map.data.slice(0, 500)), Array.from(b.map.data.slice(0, 500)));
    assert.eq(a.objects.length, b.objects.length);
});

test("different seeds make different valleys", () => {
    const a = generateZone("meadow", 1);
    const b = generateZone("meadow", 2);
    let diff = 0;
    for (let i = 0; i < a.map.data.length; i++) if (a.map.data[i] !== b.map.data[i]) diff++;
    assert.gt(diff, 100);
});

test("borders are sealed except at portals", () => {
    const z = generateZone("ashfall", 5);
    let open = 0;
    for (let x = 0; x < z.w; x++) {
        if (!isSolidTile(z.map.get(x, 0))) open++;
        if (!isSolidTile(z.map.get(x, z.h - 1))) open++;
    }
    assert.gt(open, 0, "there must be at least one way out");
    assert.eq(z.portals.length, zoneDef("ashfall").links.length);
    for (const p of z.portals) {
        assert.ok(ZONES[p.target]);
        assert.gt(p.w * p.h, 0);
    }
});

test("the spawn point is walkable and inside the zone", () => {
    for (const id of ["ashfall", "meadow", "forest", "shore", "pass"]) {
        const z = generateZone(id, 11);
        assert.not(z.solidAt(z.spawn.x, z.spawn.y), `spawn blocked in ${id}`);
        assert.gt(z.spawn.x, 0);
        assert.lt(z.spawn.x, z.map.widthPx);
    }
});

test("the prologue zone contains the camp: tent, fire and the hearth", () => {
    const z = generateZone("ashfall", 3);
    const kinds = z.objects.map((o) => o.kind);
    assert.ok(kinds.includes("tent"), "no tent");
    assert.ok(kinds.includes("campfire"), "no campfire");
    assert.ok(kinds.includes("hearth_ruin"), "no burnt hearth");
    assert.ok(kinds.includes("diary"), "no diary");
    assert.ok(z.campSite, "camp site not recorded");
    // You cannot stand *in* the fire, but you must be able to walk up to it.
    const fire = z.objects.find((o) => o.kind === "campfire");
    assert.ok(z.solidAt(fire.x, fire.y), "standing inside the flames is not a feature");
    const approaches = [[0, 26], [0, -26], [26, 0], [-26, 0]]
        .filter(([dx, dy]) => !z.solidAt(fire.x + dx, fire.y + dy));
    assert.gte(approaches.length, 3, "the fire must be approachable from most sides");
});

test("forest really is denser than the meadow", () => {
    const forest = generateZone("forest", 9);
    const meadow = generateZone("meadow", 9);
    const dens = (z) => z.objects.filter((o) => ["pine", "spruce", "oak", "birch"].includes(o.kind)).length / (z.w * z.h);
    assert.gt(dens(forest), dens(meadow));
});

test("solid props block at their trunk, low clutter does not block at all", () => {
    const z = generateZone("forest", 4);
    const tree = z.objects.find((o) => o.kind === "pine");
    if (tree) {
        assert.ok(z.propSolidAt(tree.x, tree.y), "the trunk itself is solid");
        assert.not(z.propSolidAt(tree.x + 15, tree.y), "but not the whole tile around it");
    }
    const herb = z.objects.find((o) => o.kind === "herb");
    if (herb) assert.not(z.propSolidAt(herb.x, herb.y), "you can walk through herbs");
});

test("no ghost footprints: every blocker is a live object, every zone", () => {
    for (const id of Object.keys(ZONES)) {
        const z = generateZone(id, 5);
        const live = new Set(z.objects);
        for (const [, list] of z.solidIndex) {
            for (const o of list) {
                assert.ok(live.has(o), `${id}: ${o.kind} blocks movement but is not in the world`);
            }
        }
    }
});

test("the hero can walk away from his spawn in every direction", () => {
    for (const id of Object.keys(ZONES)) {
        const z = generateZone(id, 5);
        const sp = z.spawn;
        assert.not(z.solidAt(sp.x, sp.y), `${id}: spawn itself is solid`);
        // Walk 64 units out, probing with the player's radius.
        const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
            for (let d = 10; d <= 64; d += 6) {
                const x = sp.x + dx * d, y = sp.y + dy * d;
                for (const [ox, oy] of [[0, 0], [9, 0], [-9, 0], [0, 9], [0, -9]]) {
                    if (z.solidAt(x + ox, y + oy)) return false;
                }
            }
            return true;
        });
        assert.gte(open.length, 2, `${id}: spawn is walled in (${open.length} ways out)`);
    }
});

test("ore belongs underground and in the mountains, not in the meadow", () => {
    const surface = ["meadow", "forest", "shore", "ashfall"];
    for (const id of surface) {
        const z = generateZone(id, 11);
        const ore = z.objects.filter((o) => o.kind === "ore_rock");
        assert.eq(ore.length, 0, `${id}: ore has no business lying on the grass`);
    }
    const mine = generateZone("mine", 11);
    assert.gt(mine.objects.filter((o) => o.kind === "ore_rock").length, 10, "the mine must be full of ore");
    assert.eq(mine.objects.filter((o) => ["pine", "oak", "birch", "willow"].includes(o.kind)).length, 0,
        "no trees grow underground");
});

test("you can squeeze between two props that are a tile apart", () => {
    const z = generateZone("forest", 4);
    // Any two solid props sitting in neighbouring tiles must leave a gap
    // somewhere on the line between them — no invisible walls.
    const solids = z.objects.filter((o) => o.block > 0);
    let pairs = 0, passable = 0;
    for (let i = 0; i < solids.length && pairs < 40; i++) {
        for (let j = i + 1; j < solids.length; j++) {
            const a = solids[i], b = solids[j];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < 48 || d > 72) continue;
            pairs++;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            if (!z.propSolidAt(mx, my)) passable++;
            break;
        }
    }
    if (pairs) assert.gt(passable / pairs, 0.5, "most gaps of ~2 tiles must be walkable");
});

test("ore stays underground: no metal lying about on the surface", () => {
    for (const id of ["meadow", "forest", "highland", "pass", "shore", "ashfall"]) {
        const z = generateZone(id, 5);
        const ore = z.objects.filter((o) => o.kind === "ore_rock");
        assert.eq(ore.length, 0, `${id}: ${ore.length} ore veins on the surface`);
    }
    const mine = generateZone("mine", 5);
    assert.gt(mine.objects.filter((o) => o.kind === "ore_rock").length, 0,
        "the mine must actually have ore");
});

test("two blockers one tile apart leave a gap the player fits through", () => {
    const PLAYER_R = 9;
    let pairs = 0, passable = 0;
    for (const id of ["forest", "highland", "meadow"]) {
        const z = generateZone(id, 9);
        const solids = z.objects.filter((o) => o.block > 0 && o.kind !== "ruin_wall" &&
            o.kind !== "tent" && o.kind !== "hearth_ruin");
        for (let i = 0; i < solids.length; i++) {
            for (let j = i + 1; j < solids.length; j++) {
                const a = solids[i], b = solids[j];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d < 28 || d > 40) continue;            // neighbouring tiles
                pairs++;
                const half = d / 2;
                if (half > a.block + PLAYER_R && half > b.block + PLAYER_R) passable++;
                break;
            }
        }
    }
    assert.gt(pairs, 0, "no neighbouring pairs to test");
    assert.gte(passable / pairs, 0.95, `only ${passable}/${pairs} gaps are walkable`);
});

test("you can walk right up to anything you are meant to pick up", () => {
    const PLAYER_R = 9, REACH = 18;
    for (const id of ["shore", "meadow", "swamp"]) {
        const z = generateZone(id, 3);
        const loot = z.objects.filter((o) => o.block === 0 &&
            ["driftwood", "firewood", "herb", "grass_tuft", "reed", "flower"].includes(o.kind));
        for (const o of loot.slice(0, 40)) {
            // Somewhere on a ring at arm's length there must be solid ground.
            let reachable = false;
            for (let a = 0; a < Math.PI * 2 && !reachable; a += Math.PI / 8) {
                const x = o.x + Math.cos(a) * REACH, y = o.y + Math.sin(a) * REACH;
                if (!z.solidAt(x, y) && !z.propSolidAt(x, y)) {
                    // and the player's body must fit there too
                    const clear = [[PLAYER_R, 0], [-PLAYER_R, 0], [0, PLAYER_R], [0, -PLAYER_R]]
                        .every(([dx, dy]) => !z.propSolidAt(x + dx, y + dy));
                    if (clear) reachable = true;
                }
            }
            assert.ok(reachable, `${id}: ${o.kind} at ${o.tx},${o.ty} is walled off`);
        }
    }
});


test("WorldMap caches zones lazily", () => {
    const w = new WorldMap(12);
    assert.eq(w.loadedCount, 0);
    const a = w.get("meadow");
    const b = w.get("meadow");
    assert.eq(a, b);
    assert.eq(w.loadedCount, 1);
    w.get("forest");
    assert.eq(w.loadedCount, 2);
});

test("every zone in the valley generates without throwing", () => {
    for (const id of Object.keys(ZONES)) {
        const z = generateZone(id, 2024);
        assert.ok(z instanceof Zone);
        assert.eq(z.map.w, ZONES[id].w);
        assert.gt(z.objects.length, 10, `${id} feels empty`);
    }
});

suite("weather");

test("weather is deterministic per day and seed", () => {
    const bus = new EventBus();
    const clock = new GameClock({ bus, day: 1 });
    const a = new WeatherSystem({ bus: new EventBus(), seed: 42, clock });
    const b = new WeatherSystem({ bus: new EventBus(), seed: 42, clock });
    assert.eq(a.current, b.current);
    assert.ok(WEATHER[a.current]);
});

test("the forecast matches what tomorrow actually rolls", () => {
    const clock = new GameClock({ day: 5 });
    const w = new WeatherSystem({ seed: 3, clock });
    const predicted = w.tomorrow;
    w.rollForDay(6, clock.season.key);
    assert.eq(w.current, predicted);
});

test("winter snows and summer does not", () => {
    const w = new WeatherSystem({ seed: 8 });
    let snowyWinter = 0, snowySummer = 0;
    for (let d = 1; d < 120; d++) {
        if (w.pick(d, "winter") === "snow") snowyWinter++;
        if (w.pick(d, "summer") === "snow") snowySummer++;
    }
    assert.gt(snowyWinter, 10);
    assert.eq(snowySummer, 0);
});

run("v3 world");
