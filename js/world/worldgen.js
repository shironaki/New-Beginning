/**
 * v3 world — procedural zone generation.
 *
 * Authoring 41 000 tiles by hand is impossible; authoring *rules* is not.
 * Every zone is a deterministic function of (worldSeed, zoneId): terrain from
 * layered value noise, props scattered with density masks, borders sealed
 * except at the links declared in regions.js. Same seed → same valley, in the
 * browser and in tests.
 */
import { RNG, mixSeeds, hashSeed, fbm2D } from "../core/rng.js";
import { T, TILE_SIZE } from "./tiles.js";
import { TileMap } from "./tilemap.js";
import { ZONES, BIOMES, biomeDef, zoneDef } from "./regions.js";
import { propDef } from "../sandbox/gather.js";

const BORDER = 2;

/** Ground palettes: [dry/low, main, lush/high] per biome ground key. */
const GROUND_SETS = {
    ash:    [T.SOOT, T.ASH, T.DIRT],
    meadow: [T.GRASS, T.MEADOW, T.GRASS_DRY],
    pine:   [T.PINE_FLOOR, T.MOSS, T.GRASS],
    stone:  [T.GRAVEL, T.STONE, T.DIRT],
    mud:    [T.MUD, T.MUD, T.MOSS],
    dry:    [T.GRASS_DRY, T.DIRT, T.GRASS],
    soot:   [T.SOOT, T.ASH, T.GRAVEL],
    sand:   [T.SAND, T.SAND, T.GRASS_DRY],
    moss:   [T.MOSS, T.GRASS, T.MEADOW],
    snow:   [T.SNOW, T.SNOW, T.GRAVEL]
};

/** Which prop set a biome scatters. */
const TREE_KINDS = {
    ashfall: ["burnt_stump", "burnt_tree"],
    meadow: ["oak", "birch"],
    forest: ["pine", "pine", "spruce"],
    highland: ["pine", "dead_tree"],
    swamp: ["willow", "dead_tree"],
    road: ["birch", "oak"],
    ruins: ["burnt_tree", "burnt_stump"],
    shore: ["palm", "driftwood"],
    sacred: ["ancient_oak", "oak", "birch"],
    pass: ["spruce", "dead_tree"]
};

export class Zone {
    constructor(def, map) {
        this.id = def.id;
        this.def = def;
        this.map = map;
        this.blocked = new Uint8Array(map.w * map.h); // terrain-level blocking (rare)
        this.objects = [];
        // Props block with a circular footprint around their base, not with a
        // whole 32×32 tile — otherwise you cannot squeeze between two rocks
        // and every twig gets an invisible wall. Keyed by tile for lookup.
        this.solidIndex = new Map();
        this.portals = [];
        this.spawn = { x: map.widthPx / 2, y: map.heightPx / 2 };
        this.generated = true;
    }

    get w() { return this.map.w; }
    get h() { return this.map.h; }

    blockTile(tx, ty, on = true) {
        if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return this;
        this.blocked[ty * this.map.w + tx] = on ? 1 : 0;
        return this;
    }

    isBlockedTile(tx, ty) {
        if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return true;
        return this.blocked[ty * this.map.w + tx] === 1;
    }

    /* ---- prop footprints ---------------------------------------------- */

    /** Register a prop's circular footprint (world units). r <= 0 = walk over it. */
    addSolid(obj, r) {
        if (!(r > 0)) return this;
        obj.block = r;
        const key = `${obj.tx},${obj.ty}`;
        const list = this.solidIndex.get(key);
        if (list) list.push(obj); else this.solidIndex.set(key, [obj]);
        return this;
    }

    /** Drop a prop out of the collision index (chopped down, picked up). */
    removeSolid(obj) {
        const key = `${obj.tx},${obj.ty}`;
        const list = this.solidIndex.get(key);
        if (!list) return this;
        const i = list.indexOf(obj);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) this.solidIndex.delete(key);
        return this;
    }

    /**
     * Wipe every prop standing on a tile — out of the list *and* out of the
     * collision index. Clearing only the list used to leave ghost footprints
     * behind: invisible walls where a rock had been removed.
     */
    clearTile(tx, ty) {
        for (const o of this.objects) {
            if (o.tx === tx && o.ty === ty) this.removeSolid(o);
        }
        this.objects = this.objects.filter((o) => !(o.tx === tx && o.ty === ty));
        return this;
    }

    /** Does any prop footprint cover this world point? */
    propSolidAt(wx, wy) {
        const tx = Math.floor(wx / TILE_SIZE), ty = Math.floor(wy / TILE_SIZE);
        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                const list = this.solidIndex.get(`${tx + ox},${ty + oy}`);
                if (!list) continue;
                for (const o of list) {
                    if (o.removed) continue;
                    const dx = wx - o.x, dy = wy - o.y;
                    if (dx * dx + dy * dy <= o.block * o.block) return true;
                }
            }
        }
        return false;
    }

    /**
     * The prop a BODY of `radius` centred here is pushed into, if any.
     *
     * Props are circles and so is the hero, so this is exact: distance of
     * centres against the sum of radii. Sampling a ring of points around the
     * body instead (the old way) turns the body into a 16-gon whose corners
     * poke into the prop and whose edges let it slip through — and a body
     * whose shape depends on the direction it is tested from gets wedged,
     * because sliding sideways can take it from "free" to "blocked".
     *
     * @returns {null|{nx:number, ny:number, r:number, depth:number}}
     *          outward normal, the prop's radius, and how deep the overlap is
     */
    propContact(wx, wy, radius) {
        const tx = Math.floor(wx / TILE_SIZE), ty = Math.floor(wy / TILE_SIZE);
        const reach = Math.ceil((radius + 12) / TILE_SIZE);
        let best = null;
        for (let oy = -reach; oy <= reach; oy++) {
            for (let ox = -reach; ox <= reach; ox++) {
                const list = this.solidIndex.get(`${tx + ox},${ty + oy}`);
                if (!list) continue;
                for (const o of list) {
                    if (o.removed) continue;
                    const dx = wx - o.x, dy = wy - o.y;
                    const sum = o.block + radius;
                    const d2 = dx * dx + dy * dy;
                    if (d2 > sum * sum) continue;
                    const d = Math.sqrt(d2) || 0.0001;
                    const depth = sum - d;
                    if (!best || depth > best.depth) {
                        best = { nx: dx / d, ny: dy / d, r: o.block, depth };
                    }
                }
            }
        }
        return best;
    }

    /** Boolean form of {@link propContact}. */
    propBlocksBody(wx, wy, radius) { return this.propContact(wx, wy, radius) !== null; }

    /** Combined solidity test in world units: terrain + props. */
    solidAt(wx, wy) {
        if (this.map.solidAt(wx, wy)) return true;
        if (this.isBlockedTile(Math.floor(wx / TILE_SIZE), Math.floor(wy / TILE_SIZE))) return true;
        return this.propSolidAt(wx, wy);
    }

    /** Is a tile free for walking / building / placing a prop? */
    isFree(tx, ty) {
        if (tx < BORDER || ty < BORDER || tx >= this.map.w - BORDER || ty >= this.map.h - BORDER) return false;
        if (this.isBlockedTile(tx, ty)) return false;
        const info = this.map.get(tx, ty);
        if (info === T.DEEP || info === T.CLIFF || info === T.VOID || info === T.WATER) return false;
        return !this.propSolidAt(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2);
    }

    portalAt(wx, wy) {
        for (const p of this.portals) {
            if (wx >= p.x && wx <= p.x + p.w && wy >= p.y && wy <= p.y + p.h) return p;
        }
        return null;
    }
}

/** Generate a whole zone from its definition. */
export function generateZone(zoneId, worldSeed = 1) {
    const def = zoneDef(zoneId);
    if (!def) throw new Error(`Unknown zone: ${zoneId}`);
    const biome = biomeDef(def.biome);
    const seed = mixSeeds(worldSeed, hashSeed(def.id));
    const rng = new RNG(seed);
    const map = new TileMap(def.w, def.h, T.GRASS);
    const zone = new Zone(def, map);
    const ground = GROUND_SETS[biome.ground] || GROUND_SETS.meadow;

    // --- terrain ---------------------------------------------------------
    for (let y = 0; y < def.h; y++) {
        for (let x = 0; x < def.w; x++) {
            const hgt = fbm2D(seed, x, y, { octaves: 4, scale: 26 });
            const wet = fbm2D(seed + 1013, x, y, { octaves: 3, scale: 18 });
            let tile;
            if (biome.cave) {
                // Underground: galleries of rock floor between walls of stone.
                tile = hgt > 0.62 ? T.CLIFF : (wet > 0.62 ? T.GRAVEL : T.STONE);
                map.data[y * def.w + x] = tile;
                continue;
            }
            if (hgt < biome.water * 0.55) tile = T.DEEP;
            else if (hgt < biome.water) tile = T.WATER;
            else if (hgt > 0.80 && biome.rocks > 0.1) tile = T.CLIFF;
            else if (hgt > 0.72 && biome.rocks > 0.1) tile = T.STONE;
            else if (wet < 0.36) tile = ground[0];
            else if (wet > 0.64) tile = ground[2];
            else tile = ground[1];

            // Beaches: a sandy rim wherever land meets water.
            if (tile !== T.WATER && tile !== T.DEEP && hgt < biome.water + 0.035 &&
                (biome.ground === "sand" || biome.ground === "meadow" || biome.ground === "ash")) {
                tile = T.SAND;
            }
            map.data[y * def.w + x] = tile;
        }
    }

    carveMainPath(zone, rng);
    sealBorders(zone);
    makePortals(zone);
    scatterProps(zone, rng, biome);
    placeStoryProps(zone, rng);
    pickSpawn(zone, rng);

    map.markAllDirty();
    return zone;
}

/**
 * A worn path threading the zone between its links — keeps big maps readable
 * and gives the eye somewhere to go.
 */
function carveMainPath(zone, rng) {
    const { map, def } = zone;
    const links = def.links || [];
    if (links.length < 1) return;
    const cx = Math.floor(def.w / 2), cy = Math.floor(def.h / 2);
    const pathTile = def.biome === "pass" || def.biome === "highland" ? T.GRAVEL
        : def.biome === "shore" ? T.SAND
        : def.biome === "swamp" ? T.MUD : T.PATH;

    for (const link of links) {
        const mid = Math.floor((link.from + link.to) / 2);
        let x = cx, y = cy, tx, ty;
        if (link.edge === "north") { tx = mid; ty = 1; }
        else if (link.edge === "south") { tx = mid; ty = def.h - 2; }
        else if (link.edge === "east") { tx = def.w - 2; ty = mid; }
        else { tx = 1; ty = mid; }

        let guard = 0;
        while ((x !== tx || y !== ty) && guard++ < 600) {
            const wobble = rng.chance(0.25);
            if (Math.abs(tx - x) > Math.abs(ty - y) || (wobble && x !== tx)) x += Math.sign(tx - x);
            else if (y !== ty) y += Math.sign(ty - y);
            else x += Math.sign(tx - x);
            for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    const px = x + ox, py = y + oy;
                    if (!map.inBounds(px, py)) continue;
                    const cur = map.get(px, py);
                    if (cur === T.DEEP || cur === T.WATER) { map.data[py * def.w + px] = T.PLANK; continue; } // a plank crossing
                    if (cur === T.CLIFF) { map.data[py * def.w + px] = T.GRAVEL; continue; }
                    if (Math.abs(ox) + Math.abs(oy) <= 1) map.data[py * def.w + px] = pathTile;
                }
            }
        }
    }
}

/** Ring of impassable tiles so the player cannot walk off the zone. */
function sealBorders(zone) {
    const { map, def } = zone;
    const edgeTile = def.biome === "shore" ? T.DEEP
        : (def.biome === "highland" || def.biome === "pass") ? T.CLIFF : T.CLIFF;
    for (let y = 0; y < def.h; y++) {
        for (let x = 0; x < def.w; x++) {
            if (x < BORDER || y < BORDER || x >= def.w - BORDER || y >= def.h - BORDER) {
                map.data[y * def.w + x] = edgeTile;
            }
        }
    }
}

/** Cut the doorways declared in regions.js back out of the sealed border. */
function makePortals(zone) {
    const { map, def } = zone;
    const gate = def.biome === "shore" ? T.SAND : def.biome === "pass" ? T.SNOW : T.PATH;
    for (const link of def.links || []) {
        const from = Math.max(BORDER, link.from), to = Math.min(
            (link.edge === "north" || link.edge === "south") ? def.w - BORDER - 1 : def.h - BORDER - 1,
            link.to
        );
        let px, py, pw, ph;
        for (let i = from; i <= to; i++) {
            if (link.edge === "north") { for (let y = 0; y < BORDER + 1; y++) map.data[y * def.w + i] = gate; }
            else if (link.edge === "south") { for (let y = def.h - BORDER - 1; y < def.h; y++) map.data[y * def.w + i] = gate; }
            else if (link.edge === "west") { for (let x = 0; x < BORDER + 1; x++) map.data[i * def.w + x] = gate; }
            else { for (let x = def.w - BORDER - 1; x < def.w; x++) map.data[i * def.w + x] = gate; }
        }
        if (link.edge === "north") { px = from * TILE_SIZE; py = 0; pw = (to - from + 1) * TILE_SIZE; ph = TILE_SIZE; }
        else if (link.edge === "south") { px = from * TILE_SIZE; py = (def.h - 1) * TILE_SIZE; pw = (to - from + 1) * TILE_SIZE; ph = TILE_SIZE; }
        else if (link.edge === "west") { px = 0; py = from * TILE_SIZE; pw = TILE_SIZE; ph = (to - from + 1) * TILE_SIZE; }
        else { px = (def.w - 1) * TILE_SIZE; py = from * TILE_SIZE; pw = TILE_SIZE; ph = (to - from + 1) * TILE_SIZE; }
        zone.portals.push({ x: px, y: py, w: pw, h: ph, target: link.target, edge: link.edge, label: link.label });
    }
}

function addProp(zone, kind, tx, ty, extra = {}) {
    const obj = Object.assign({
        kind, tx, ty,
        x: tx * TILE_SIZE + TILE_SIZE / 2,
        y: ty * TILE_SIZE + TILE_SIZE / 2,
        variant: 0
    }, extra);
    zone.objects.push(obj);
    // Footprint: the catalogue decides, scaled by how big this instance grew.
    const def = propDef(kind);
    let r = def && def.block !== undefined ? def.block : (extra.solid === false ? 0 : 10);
    if (extra.solid === false && (!def || def.block === undefined)) r = 0;
    if (obj.size) r *= Math.min(1.35, obj.size);
    zone.addSolid(obj, r);
    return obj;
}

/** Scatter trees, rocks, bushes, herbs, firewood and reeds with density masks. */
function scatterProps(zone, rng, biome) {
    const { map, def } = zone;
    const seed = mixSeeds(hashSeed(def.id), 7777);
    const treeKinds = TREE_KINDS[def.biome] || TREE_KINDS.meadow;

    for (let y = BORDER; y < def.h - BORDER; y++) {
        for (let x = BORDER; x < def.w - BORDER; x++) {
            const tile = map.get(x, y);
            if (tile === T.CLIFF || tile === T.DEEP || tile === T.PATH ||
                tile === T.PLANK || tile === T.COBBLE) continue;
            const forest = fbm2D(seed, x, y, { octaves: 3, scale: 14 });
            const jitter = rng.next();

            // Underground there is nothing but stone, ore and cave mushrooms.
            if (biome.cave) {
                if (jitter > 1 - biome.rocks * 0.6) {
                    const ore = rng.chance(0.55)
                        ? rng.weighted([["coal", 5], ["iron", 4], ["copper", 4], ["gem", 1]])
                        : null;
                    addProp(zone, ore ? "ore_rock" : "rock", x, y, {
                        variant: rng.int(0, 2), ore, hp: ore ? 5 : 3, yields: ore || "stone"
                    });
                } else if (rng.chance(0.012)) {
                    addProp(zone, "mushroom_patch", x, y, { solid: false, amount: rng.int(1, 3) });
                } else if (rng.chance(0.006)) {
                    addProp(zone, "burnt_beam", x, y, { variant: rng.int(0, 1) });  // old pit prop
                }
                continue;
            }

            // Trees cluster where the forest mask is high.
            if (tile !== T.WATER && jitter < biome.trees * (0.35 + forest * 1.5)) {
                const kind = rng.pick(treeKinds);
                addProp(zone, kind, x, y, {
                    variant: rng.int(0, 2),
                    size: rng.range(0.85, 1.2),
                    hp: kind.includes("stump") ? 2 : 4,
                    yields: kind.includes("stump") ? "wood" : "log"
                });
                continue;
            }
            // Rocks, and — only in the mountains and underground — ore veins.
            // Ore does not lie around in meadows: that is what mines are for.
            if (tile !== T.WATER && jitter > 1 - biome.rocks * (0.4 + (1 - forest) * 1.2)) {
                // Ore belongs underground. Surface zones — highland and the
                // pass included — give plain stone and flint only; metal is a
                // reason to go into the dark, not a thing you trip over.
                const oreCountry = !!def.underground || def.id === "mine";
                const ore = (oreCountry && rng.chance(0.42))
                    ? rng.weighted([["copper", 5], ["iron", 3], ["coal", 4], ["gem", 1]])
                    : null;
                addProp(zone, ore ? "ore_rock" : "rock", x, y, {
                    variant: rng.int(0, 2), ore, hp: ore ? 5 : 3, yields: ore || "stone"
                });
                continue;
            }
            // Low clutter — walkable, pickable.
            const roll = rng.next();
            if (tile === T.WATER) {
                // Reeds only in the shallows you can actually reach from land.
                const nearLand = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
                    const t = map.get(x + dx, y + dy);
                    return t !== T.WATER && t !== T.DEEP && t !== T.VOID;
                });
                if (nearLand && roll < 0.3) addProp(zone, "reed", x, y, { solid: false, variant: rng.int(0, 1) });
                continue;
            }
            if (roll < biome.bushes * 0.5) {
                addProp(zone, "bush", x, y, { solid: false, berries: rng.chance(0.5), variant: rng.int(0, 2) });
            } else if (roll < biome.bushes * 0.75) {
                addProp(zone, "herb", x, y, { solid: false, herbType: rng.pick(["mint", "sage", "yarrow"]) });
            } else if (roll < biome.bushes * 0.9) {
                addProp(zone, "firewood", x, y, { solid: false, amount: rng.int(1, 3) });
            } else if (roll < biome.bushes * 0.97) {
                addProp(zone, "grass_tuft", x, y, { solid: false, variant: rng.int(0, 3) });
            } else if (roll > 0.995) {
                addProp(zone, "flower", x, y, { solid: false, variant: rng.int(0, 3) });
            }
        }
    }
}

/** Hand-placed, story-relevant props: the burnt homestead, ruins, landmarks. */
function placeStoryProps(zone, rng) {
    const { def, map } = zone;
    if (def.id === "ashfall") {
        // The hero's burnt house: a scorched footprint with a surviving hearth.
        const hx = Math.floor(def.w * 0.42), hy = Math.floor(def.h * 0.55);
        for (let y = hy; y < hy + 5; y++) {
            for (let x = hx; x < hx + 7; x++) {
                if (!map.inBounds(x, y)) continue;
                map.data[y * def.w + x] = (x === hx || x === hx + 6 || y === hy || y === hy + 4) ? T.SOOT : T.ASH;
                zone.blockTile(x, y, false);
                zone.clearTile(x, y);
            }
        }
        for (let x = hx; x < hx + 7; x += 2) addProp(zone, "burnt_beam", x, hy, { solid: true });
        for (let x = hx + 1; x < hx + 6; x += 2) addProp(zone, "burnt_beam", x, hy + 4, { solid: true });
        addProp(zone, "hearth_ruin", hx + 3, hy + 2, { solid: true, story: "home_hearth" });
        addProp(zone, "diary", hx + 2, hy + 3, { solid: false, story: "own_diary" });

        // Starting camp: clear ground just south-east of the ruin.
        const cx = hx + 3, cy = hy + 7;
        for (let y = cy - 2; y <= cy + 2; y++) {
            for (let x = cx - 3; x <= cx + 3; x++) {
                if (!map.inBounds(x, y)) continue;
                if (map.get(x, y) === T.DEEP || map.get(x, y) === T.WATER) continue;
                map.data[y * def.w + x] = T.ASH;
                zone.blockTile(x, y, false);
                zone.clearTile(x, y);
            }
        }
        zone.campSite = { tx: cx, ty: cy };
        addProp(zone, "tent", cx - 2, cy, { solid: true, story: "start_tent" });
        addProp(zone, "campfire", cx + 1, cy, { solid: false, story: "start_fire", fuel: 0 });
        addProp(zone, "firewood", cx + 1, cy + 1, { solid: false, amount: 2 });
        addProp(zone, "firewood", cx, cy - 1, { solid: false, amount: 2 });
        zone.spawnHint = { tx: cx, ty: cy + 1 };
    }

    if (def.id === "ruins") {
        // A burnt-out hamlet: four house footprints with collapsed walls.
        for (let i = 0; i < 5; i++) {
            const bx = rng.int(8, def.w - 16), by = rng.int(8, def.h - 14);
            const bw = rng.int(5, 8), bh = rng.int(4, 6);
            for (let y = by; y < by + bh; y++) {
                for (let x = bx; x < bx + bw; x++) {
                    if (!map.inBounds(x, y)) continue;
                    map.data[y * def.w + x] = T.SOOT;
                    const edge = (x === bx || x === bx + bw - 1 || y === by || y === by + bh - 1);
                    zone.clearTile(x, y);
                    zone.blockTile(x, y, false);
                    if (edge && rng.chance(0.55)) addProp(zone, "ruin_wall", x, y, { solid: true, variant: rng.int(0, 2) });
                }
            }
            if (rng.chance(0.6)) addProp(zone, "chest_old", bx + 1, by + 1, { solid: true, looted: false });
        }
    }
}

/** Starting position: the camp in the prologue, otherwise a clear tile near the middle. */
function pickSpawn(zone, rng) {
    const { def, map } = zone;
    const R = 9;                       // the hero's radius

    /** Can the hero stand here and walk at least two tiles out in `ways`? */
    const roomy = (tx, ty, ways = 3) => {
        if (!zone.isFree(tx, ty)) return false;
        const cx = tx * TILE_SIZE + TILE_SIZE / 2, cy = ty * TILE_SIZE + TILE_SIZE / 2;
        for (const [ox, oy] of [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]]) {
            if (zone.solidAt(cx + ox, cy + oy)) return false;
        }
        let open = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            let clear = true;
            for (let d = 10; d <= 72 && clear; d += 6) {
                for (const [ox, oy] of [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]]) {
                    if (zone.solidAt(cx + dx * d + ox, cy + dy * d + oy)) { clear = false; break; }
                }
            }
            if (clear) open++;
        }
        return open >= ways;
    };

    const place = (tx, ty) => {
        zone.spawn = { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
    };

    if (zone.spawnHint && roomy(zone.spawnHint.tx, zone.spawnHint.ty, 2)) {
        place(zone.spawnHint.tx, zone.spawnHint.ty);
        return;
    }
    // Prefer a spot with elbow room; relax the requirement if the zone is tight.
    for (const ways of [3, 2, 1]) {
        for (let attempt = 0; attempt < 400; attempt++) {
            const tx = rng.int(BORDER + 2, def.w - BORDER - 3);
            const ty = rng.int(BORDER + 2, def.h - BORDER - 3);
            if (map.get(tx, ty) === T.WATER) continue;
            if (roomy(tx, ty, ways)) { place(tx, ty); return; }
        }
    }
    // Last resort: any free tile at all.
    for (let ty = BORDER + 2; ty < def.h - BORDER - 2; ty++) {
        for (let tx = BORDER + 2; tx < def.w - BORDER - 2; tx++) {
            if (zone.isFree(tx, ty)) { place(tx, ty); return; }
        }
    }
}

/**
 * Lazy zone cache: zones are generated on first visit and kept in memory
 * (a whole valley is a few hundred kilobytes), so travel has no hitch.
 */
export class WorldMap {
    constructor(worldSeed = 1) {
        this.seed = worldSeed;
        this.zones = new Map();
    }

    get(zoneId) {
        if (!this.zones.has(zoneId)) this.zones.set(zoneId, generateZone(zoneId, this.seed));
        return this.zones.get(zoneId);
    }

    has(zoneId) { return this.zones.has(zoneId); }
    get loadedCount() { return this.zones.size; }

    /** Drop far-away zones if memory ever becomes a concern. */
    unload(zoneId) { this.zones.delete(zoneId); return this; }
}
