/**
 * world — chunked tile map.
 *
 * Tiles live in one flat Uint8Array per zone (cheap), but everything the
 * renderer does is organised in 16×16 **chunks**: each chunk bakes its static
 * ground into an offscreen canvas once and is redrawn only when dirtied. That
 * is what lets a 96×72 zone with thousands of tiles run at 60 fps on Canvas 2D
 * without a single dependency.
 */
import { waterIce } from "./water-state.js";
import { T, TILE_SIZE, tileInfo, isSolidTile, tileSpeed } from "./tiles.js";

export const CHUNK = 16;

export class TileMap {
    constructor(w, h, fill = T.GRASS) {
        this.w = w; this.h = h;
        this.tileSize = TILE_SIZE;
        this.data = new Uint8Array(w * h).fill(fill);
        this.chunksX = Math.ceil(w / CHUNK);
        this.chunksY = Math.ceil(h / CHUNK);
        this.dirtyChunks = new Set();   // chunk keys needing a re-bake
        this.markAllDirty();
    }

    get widthPx() { return this.w * this.tileSize; }
    get heightPx() { return this.h * this.tileSize; }

    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    index(x, y) { return y * this.w + x; }

    get(x, y) { return this.inBounds(x, y) ? this.data[this.index(x, y)] : T.VOID; }

    set(x, y, id) {
        if (!this.inBounds(x, y)) return this;
        const previous = this.data[this.index(x, y)];
        this.data[this.index(x, y)] = id;
        this.revision = (this.revision || 0) + 1;
        // Coast distances can propagate beyond a neighbouring chunk.
        if (!!tileInfo(previous).liquid !== !!tileInfo(id).liquid) this.markAllDirty();
        this.markDirtyAt(x, y);
        return this;
    }

    /** Tile under a world-unit position. */
    at(wx, wy) { return this.terrain ? this.terrain.sample(wx, wy).id : this.get(Math.floor(wx / this.tileSize), Math.floor(wy / this.tileSize)); }

    solidAt(wx, wy) {
        const id = this.at(wx, wy);
        if (id === T.DEEP && waterIce(this, wx, wy, id).walkable) return false;
        return isSolidTile(id);
    }
    speedAt(wx, wy) {
        const id = this.at(wx, wy), ice = waterIce(this, wx, wy, id);
        return ice.walkable || (id === T.WATER && ice.cover >= 0.55) ? 1 : tileSpeed(id);
    }
    infoAt(wx, wy) { return tileInfo(this.at(wx, wy)); }

    chunkKey(cx, cy) { return cy * this.chunksX + cx; }

    markDirtyAt(x, y) {
        const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
        this.dirtyChunks.add(this.chunkKey(cx, cy));
        // Bilinear natural contours also cross diagonal chunk boundaries.
        for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
            const nx = Math.floor((x + dx) / CHUNK), ny = Math.floor((y + dy) / CHUNK);
            if (nx >= 0 && ny >= 0 && nx < this.chunksX && ny < this.chunksY) this.dirtyChunks.add(this.chunkKey(nx, ny));
        }
        return this;
    }

    markAllDirty() {
        for (let cy = 0; cy < this.chunksY; cy++) {
            for (let cx = 0; cx < this.chunksX; cx++) this.dirtyChunks.add(this.chunkKey(cx, cy));
        }
        return this;
    }

    /** Chunk indices overlapping a world-unit rectangle (the camera view). */
    chunksInRect(x, y, w, h) {
        const px = this.tileSize * CHUNK;
        const cx0 = Math.max(0, Math.floor(x / px));
        const cy0 = Math.max(0, Math.floor(y / px));
        const cx1 = Math.min(this.chunksX - 1, Math.floor((x + w) / px));
        const cy1 = Math.min(this.chunksY - 1, Math.floor((y + h) / px));
        const out = [];
        for (let cy = cy0; cy <= cy1; cy++) {
            for (let cx = cx0; cx <= cx1; cx++) out.push({ cx, cy, key: this.chunkKey(cx, cy) });
        }
        return out;
    }

    /** Rectangular fill, in tile coordinates. */
    fillRect(x, y, w, h, id) {
        for (let yy = y; yy < y + h; yy++) {
            for (let xx = x; xx < x + w; xx++) this.set(xx, yy, id);
        }
        return this;
    }

    /** Count of a given tile id — used by tests and by zone statistics. */
    count(id) {
        let n = 0;
        for (let i = 0; i < this.data.length; i++) if (this.data[i] === id) n++;
        return n;
    }

    /** 4-neighbourhood sameness mask (N,E,S,W) — the basis of autotiling. */
    neighbourMask(x, y, predicate) {
        const p = predicate || ((id) => id === this.get(x, y));
        let m = 0;
        if (p(this.get(x, y - 1))) m |= 1;
        if (p(this.get(x + 1, y))) m |= 2;
        if (p(this.get(x, y + 1))) m |= 4;
        if (p(this.get(x - 1, y))) m |= 8;
        return m;
    }

    toJSON() {
        return { w: this.w, h: this.h, data: Array.from(this.data) };
    }

    static fromJSON(obj) {
        const map = new TileMap(obj.w, obj.h);
        map.data.set(obj.data);
        map.markAllDirty();
        return map;
    }
}

/**
 * Circle-vs-tiles collision with axis separation, so sliding along a wall feels
 * smooth instead of sticky. Returns the resolved position and whether the mover
 * was blocked on each axis.
 */
/**
 * The player's body as a set of probe points, in units of `radius`.
 *
 * ONE source of truth: `moveAndCollide` and every "does the hero fit here?"
 * check in the game must use this, or they disagree — a spot the mover is
 * happy with gets judged occupied elsewhere and the hero is teleported out
 * of it. The body is a CIRCLE, so the diagonals sit on the circle
 * (cos 45° = 0.7071), never on the corners of a square: square corners stick
 * out 41 % further than the body ever does.
 *
 * The centre and the inner ring matter just as much as the rim: a small prop
 * (a stump, block 3.6) fits entirely between rim probes, and without them the
 * hero walks into it and stands inside it.
 */
function ring(count, radius, offset = 0) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const a = offset + (i / count) * Math.PI * 2;
        out.push([Math.cos(a) * radius, Math.sin(a) * radius]);
    }
    return out;
}

/**
 * Centre + an inner ring + a dense rim.
 *
 * The spacing is derived, not guessed. The smallest prop that blocks is a
 * stump at `block 3.6 * size 0.85 = 3.06`. Two conditions must hold:
 *
 *   - a prop that small must not fit *between* the rings: the radial gap is
 *     `radius/2 = 4.5` and the inner chord `3.44`, both under its diameter;
 *   - a prop touching the body from outside must be caught before it bites
 *     more than ~0.5 px: with 16 rim probes (every 22.5°) detection starts at
 *     centre distance 13.2 against the ideal 13.7 for a 4.7-wide trunk.
 *
 * Eight rim probes — the old set — left a 1.9 px bite, which is exactly how
 * the hero ended up welded to the side of a stump.
 */
export const BODY_PROBES = [[0, 0], ...ring(8, 0.5), ...ring(16, 1)];

/**
 * Is the body of `radius` centred on (px, py) overlapping anything solid?
 *
 * Tiles are sampled with the probe set (they are big axis-aligned squares, so
 * points are plenty). Round props are handed to `bodyExtra`, which tests them
 * exactly — see `Zone.propBlocksBody`.
 */
export function bodyBlocked(solid, px, py, radius, bodyExtra = null) {
    if (bodyExtra && bodyExtra(px, py, radius)) return true;
    for (const [ox, oy] of BODY_PROBES) {
        if (solid(px + ox * radius, py + oy * radius)) return true;
    }
    return false;
}

/**
 * Estimate the surface normal the body is pressed against from the probes
 * that are inside something. Used for tiles, where the surface is flat and a
 * probe estimate is exact enough; round props report their normal themselves.
 */
export function contactNormal(solid, px, py, radius) {
    let nx = 0, ny = 0, hits = 0;
    for (const [ox, oy] of BODY_PROBES) {
        if (ox === 0 && oy === 0) continue;
        if (solid(px + ox * radius, py + oy * radius)) { nx -= ox; ny -= oy; hits++; }
    }
    if (!hits) return null;
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) return null;
    return [nx / len, ny / len];
}

/**
 * Move a body of `radius` by (dx, dy), resolving collisions.
 *
 *   1. the move as asked, as one vector, so a diagonal stays a diagonal;
 *   2. split into X and Y, so a surface only eats the component going into it;
 *   3. a slide ALONG what was hit: the remaining step minus its component into
 *      the contact normal. Against a flat wall that tangent is zero when you
 *      walk straight at it (no creeping sideways along walls) and full speed
 *      when you walk into it at an angle. Around a tree trunk it is what
 *      carries you past without touching a second key;
 *   4. if the body walked into something NARROW dead centre — a trunk, a
 *      stump, a rock — the tangent is zero by symmetry, so it steps round the
 *      side that is actually open.
 *
 * Each attempt binary-searches the largest fraction of the step that fits
 * (4 iterations). Without it the body stops a whole frame short of what it
 * touches, which reads as a stutter in tight gaps and makes "stand right next
 * to it" impossible.
 *
 * @param {function(number,number,number):?object} bodyContact
 *        exact round-obstacle test: returns `{nx, ny, r, depth}` or null
 */
export function moveAndCollide(map, x, y, dx, dy, radius = 9, extraSolid = null, bodyContact = null) {
    const solid = (wx, wy) => {
        if (map.solidAt(wx, wy)) return true;
        return extraSolid ? extraSolid(wx, wy) : false;
    };
    const blockedAt = (px, py) => {
        if (bodyContact && bodyContact(px, py, radius)) return true;
        return bodyBlocked(solid, px, py, radius);
    };

    let nx = x, ny = y;
    // Where the body last found something solid: the contact has to be read
    // there, not at the (free) spot it stopped in, or it reads as no contact.
    let bx = 0, by = 0, touched = false;

    /** Move as far along (ax, ay) as fits; returns the fraction spent. */
    const advance = (ax, ay) => {
        if (ax === 0 && ay === 0) return 1;
        if (!blockedAt(nx + ax, ny + ay)) { nx += ax; ny += ay; return 1; }
        bx = nx + ax; by = ny + ay; touched = true;
        let lo = 0, hi = 1;
        for (let i = 0; i < 4; i++) {
            const m = (lo + hi) / 2;
            if (blockedAt(nx + ax * m, ny + ay * m)) { hi = m; bx = nx + ax * m; by = ny + ay * m; }
            else lo = m;
        }
        if (lo > 0.02) { nx += ax * lo; ny += ay * lo; }
        return lo;
    };

    let rx = dx, ry = dy;
    const f0 = advance(rx, ry);
    rx *= 1 - f0; ry *= 1 - f0;

    if (f0 < 1) {
        const fx = advance(rx, 0); rx *= 1 - fx;
        const fy = advance(0, ry); ry *= 1 - fy;

        if ((rx !== 0 || ry !== 0) && touched) {
            const prop = bodyContact ? bodyContact(bx, by, radius) : null;
            let n = null, narrow = 0;
            if (prop) { n = [prop.nx, prop.ny]; narrow = prop.r; }
            else n = contactNormal(solid, bx, by, radius);
            if (n) {
                const left = Math.hypot(rx, ry);
                const dot = rx * n[0] + ry * n[1];
                let tx = rx - n[0] * dot, ty = ry - n[1] * dot;
                if (Math.hypot(tx, ty) < left * 0.15 && narrow > 0 && narrow <= radius * 1.2) {
                    // Dead centre on something narrow: step round whichever
                    // side is open instead of standing there pushing at it.
                    const px = -n[1], py = n[0];
                    const reach = radius + narrow + 2;
                    const okA = !blockedAt(nx + px * reach + dx, ny + py * reach + dy);
                    const okB = !blockedAt(nx - px * reach + dx, ny - py * reach + dy);
                    const s = okA === okB ? (okA ? 1 : 0) : (okA ? 1 : -1);
                    if (s) { tx = px * s * left; ty = py * s * left; }
                }
                const f = advance(tx, ty);
                rx -= tx * f; ry -= ty * f;
            }
        }
    }

    const hitX = dx !== 0 && Math.abs(rx) > Math.abs(dx) * 0.05;
    const hitY = dy !== 0 && Math.abs(ry) > Math.abs(dy) * 0.05;

    // Keep inside the zone rectangle.
    nx = Math.max(radius, Math.min(map.widthPx - radius, nx));
    ny = Math.max(radius, Math.min(map.heightPx - radius, ny));
    return { x: nx, y: ny, hitX, hitY };
}
