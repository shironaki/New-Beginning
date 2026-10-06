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
import { T, TILE_SIZE, tileInfo } from "./tiles.js";
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
/**
 * How far from the bank you can still feel the bottom.
 * Wading is a thing you do at the edge of the water, not a way to cross a
 * lake on foot: everything deeper than this band becomes `T.DEEP`, which
 * stops you.
 */
export const SHORE = {
    wade: 1.7,          // base width of the shallows, tiles
    vary: 1.1,          // noise adds up to this many tiles to the band
    scale: 22,          // noise scale of that variation (big, slow waves)
    maxBand: 3,         // hard cap, tiles
    smooth: 3           // a tile surrounded by the other depth flips over
};

/**
 * Second pass over the water: depth by distance to the nearest bank.
 * Multi-source BFS from every piece of land, so a pond keeps its rim of
 * shallows and the middle of a lake stays deep whatever the height noise did.
 */
function deepenWater(zone, seed) {
    const map = zone.map, W = map.w, H = map.h;
    const dist = new Int16Array(W * H).fill(-1);
    const queue = new Int32Array(W * H);
    let head = 0, tail = 0;
    for (let i = 0; i < W * H; i++) {
        if (!tileInfo(map.data[i]).liquid) { dist[i] = 0; queue[tail++] = i; }
    }
    if (tail === 0) return zone;        // a zone that is all water: leave it
    while (head < tail) {
        const i = queue[head++];
        const x = i % W, y = (i / W) | 0, d = dist[i] + 1;
        for (let k = 0; k < 4; k++) {
            const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
            const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (dist[j] !== -1) continue;
            dist[j] = d;
            queue[tail++] = j;
        }
    }
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (!tileInfo(map.data[i]).liquid) continue;
            // A wobbly edge: a straight band of shallows around every lake
            // would read as a drawn outline.
            const n = fbm2D(seed + 733, x, y, { octaves: 2, scale: SHORE.scale });
            const band = Math.min(SHORE.maxBand, SHORE.wade + n * SHORE.vary);
            map.data[i] = dist[i] <= band ? T.WATER : T.DEEP;
        }
    }
    // Clean the edge: a lone shallow tile out at sea (or a lone deep hole in
    // the shallows) reads as a bright square, not as depth.
    for (let pass = 0; pass < 2; pass++) {
        const copy = map.data.slice();
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const i = y * W + x, id = copy[i];
                if (id !== T.WATER && id !== T.DEEP) continue;
                const other = id === T.WATER ? T.DEEP : T.WATER;
                let n = 0;
                for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    if (copy[(y + ddy) * W + x + ddx] === other) n++;
                }
                if (n >= SHORE.smooth) map.data[i] = other;
            }
        }
    }
    return zone;
}

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
                // Underground starts as SOLID rock. The galleries are cut out
                // of it afterwards by `carveGallery` — noise thresholds gave
                // open fields with boulders, which is not a mine.
                map.data[y * def.w + x] = T.CLIFF;
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

    if (!biome.cave) deepenWater(zone, seed);
    if (biome.cave) carveGallery(zone, rng);
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
/**
 * A mine is a NETWORK, not a cavern: chambers joined by tunnels two or three
 * tiles wide, cut from solid rock. The player should always be able to see a
 * wall on at least one side and a way on at the end — that is what makes the
 * dark feel like a mine instead of a field at night.
 *
 * Layout, in numbers:
 *   rooms      5…7, each 5…11 × 4…8 tiles
 *   tunnels    L-shaped between consecutive rooms, 2…3 wide
 *   floor      STONE, with GRAVEL spoil along the walls
 *   water      puddles in the lowest corners — wadeable, now that the
 *              shallows are
 */
export const MINE = {
    rooms: [5, 7], roomW: [5, 11], roomH: [4, 8],
    tunnel: [2, 3], margin: 4,
    spoil: 0.22,        // chance a floor tile touching rock is spoil
    puddle: 0.18,       // chance a chamber grows a puddle
    rough: 0.3,         // chance a wall tile on the rim is bitten back
    erode: 0.4,         // chance a corner of rock sticking into a room goes
    pillars: [2, 5],    // rock pillars left standing in the big chambers
    pillarRoom: 30      // a chamber needs this many floor tiles to get one
};

function carveGallery(zone, rng) {
    const { map, def } = zone;
    const W = def.w, H = def.h, M = MINE.margin;
    const put = (x, y, tile) => {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
        map.data[y * W + x] = tile;
    };
    const box = (x0, y0, x1, y1, tile) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, tile);
    };

    // Chambers, spread across the map so tunnels have to travel.
    const rooms = [];
    const n = rng.int(MINE.rooms[0], MINE.rooms[1]);
    for (let i = 0; i < n; i++) {
        const w = rng.int(MINE.roomW[0], MINE.roomW[1]);
        const h = rng.int(MINE.roomH[0], MINE.roomH[1]);
        const x = rng.int(M, Math.max(M + 1, W - M - w));
        const y = rng.int(M, Math.max(M + 1, H - M - h));
        rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
        box(x, y, x + w - 1, y + h - 1, T.STONE);
    }
    // The entrance chamber is always the middle of the map, so the portal and
    // the spawn have somewhere to be.
    const hub = { cx: W >> 1, cy: H >> 1 };
    box(hub.cx - 4, hub.cy - 3, hub.cx + 4, hub.cy + 3, T.STONE);
    rooms.unshift(Object.assign({ x: hub.cx - 4, y: hub.cy - 3, w: 9, h: 7 }, hub));

    // Tunnels: every chamber is joined to the previous one, and the last one
    // back to the hub, so nothing is ever walled off.
    const dig = (ax, ay, bx, by) => {
        const wide = rng.int(MINE.tunnel[0], MINE.tunnel[1]);
        const half = wide >> 1;
        let x = ax, y = ay;
        while (x !== bx) {
            x += Math.sign(bx - x);
            for (let o = -half; o <= half; o++) put(x, y + o, T.STONE);
        }
        while (y !== by) {
            y += Math.sign(by - y);
            for (let o = -half; o <= half; o++) put(x + o, y, T.STONE);
        }
    };
    for (let i = 1; i < rooms.length; i++) dig(rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy);
    dig(rooms[rooms.length - 1].cx, rooms[rooms.length - 1].cy, rooms[0].cx, rooms[0].cy);

    // Erode the corners: a rectangle of rock with four right angles is a
    // room in a dungeon crawler, not a gallery cut by hand.
    for (let pass = 0; pass < 2; pass++) {
        const eaten = [];
        for (let y = 2; y < H - 2; y++) {
            for (let x = 2; x < W - 2; x++) {
                if (map.get(x, y) !== T.CLIFF) continue;
                let floor = 0;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const t = map.get(x + dx, y + dy);
                    if (t === T.STONE || t === T.GRAVEL) floor++;
                }
                if (floor >= 3 || (floor === 2 && rng.chance(MINE.erode))) eaten.push(x, y);
            }
        }
        for (let i = 0; i < eaten.length; i += 2) put(eaten[i], eaten[i + 1], T.STONE);
    }

    // Pillars: rock left standing so the roof has something to sit on. They
    // break the sight line and make a chamber read as a working.
    const pillars = rng.int(MINE.pillars[0], MINE.pillars[1]);
    for (let i = 0; i < pillars; i++) {
        const r = rooms[rng.int(0, rooms.length - 1)];
        if (r.w * r.h < MINE.pillarRoom) continue;
        const px0 = r.x + rng.int(1, Math.max(1, r.w - 2));
        const py0 = r.y + rng.int(1, Math.max(1, r.h - 2));
        const pw = rng.int(1, 2), ph = rng.int(1, 2);
        box(px0, py0, px0 + pw - 1, py0 + ph - 1, T.CLIFF);
    }

    // Spoil along the walls, a bitten rim, and standing water in the corners.
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const here = map.get(x, y);
            if (here !== T.STONE) continue;
            let rock = 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (map.get(x + dx, y + dy) === T.CLIFF) rock++;
            }
            if (rock > 0 && rng.chance(MINE.spoil)) map.data[y * W + x] = T.GRAVEL;
            if (rock >= 2 && rng.chance(MINE.puddle)) map.data[y * W + x] = T.WATER;
            // Bite the rim back here and there: a hand-cut gallery is not a
            // rectangle.
            if (rock === 1 && rng.chance(MINE.rough)) {
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    if (map.get(x + dx, y + dy) === T.CLIFF && rng.chance(0.4)) {
                        put(x + dx, y + dy, T.GRAVEL);
                    }
                }
            }
        }
    }
}

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
                // Ore sits in the WALL, not in the middle of the gallery:
                // a vein you can walk around is not a vein.
                let touchesRock = false;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    if (zone.map.get(x + dx, y + dy) === T.CLIFF) { touchesRock = true; break; }
                }
                if (touchesRock && jitter > 1 - biome.rocks * 1.4) {
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
