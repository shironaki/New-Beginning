/**
 * v3 world — chunked tile map.
 *
 * Tiles live in one flat Uint8Array per zone (cheap), but everything the
 * renderer does is organised in 16×16 **chunks**: each chunk bakes its static
 * ground into an offscreen canvas once and is redrawn only when dirtied. That
 * is what lets a 96×72 zone with thousands of tiles run at 60 fps on Canvas 2D
 * without a single dependency.
 */
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
        this.data[this.index(x, y)] = id;
        this.markDirtyAt(x, y);
        return this;
    }

    /** Tile under a world-unit position. */
    at(wx, wy) { return this.get(Math.floor(wx / this.tileSize), Math.floor(wy / this.tileSize)); }

    solidAt(wx, wy) { return isSolidTile(this.at(wx, wy)); }
    speedAt(wx, wy) { return tileSpeed(this.at(wx, wy)); }
    infoAt(wx, wy) { return tileInfo(this.at(wx, wy)); }

    chunkKey(cx, cy) { return cy * this.chunksX + cx; }

    markDirtyAt(x, y) {
        const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
        this.dirtyChunks.add(this.chunkKey(cx, cy));
        // Neighbouring chunks may blend across the seam (autotiling).
        if (x % CHUNK === 0 && cx > 0) this.dirtyChunks.add(this.chunkKey(cx - 1, cy));
        if (y % CHUNK === 0 && cy > 0) this.dirtyChunks.add(this.chunkKey(cx, cy - 1));
        if (x % CHUNK === CHUNK - 1 && cx < this.chunksX - 1) this.dirtyChunks.add(this.chunkKey(cx + 1, cy));
        if (y % CHUNK === CHUNK - 1 && cy < this.chunksY - 1) this.dirtyChunks.add(this.chunkKey(cx, cy + 1));
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
const D = 0.70710678, M = 0.5, MD = 0.46194, MX = 0.19134;
export const BODY_PROBES = [
    [0, 0],
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [D, D], [D, -D], [-D, D], [-D, -D],
    [M, 0], [-M, 0], [0, M], [0, -M],
    [MD, MX], [MD, -MX], [-MD, MX], [-MD, -MX],
    [MX, MD], [MX, -MD], [-MX, MD], [-MX, -MD]
];

/** Is the body of `radius` centred on (px, py) overlapping anything solid? */
export function bodyBlocked(solid, px, py, radius) {
    for (const [ox, oy] of BODY_PROBES) {
        if (solid(px + ox * radius, py + oy * radius)) return true;
    }
    return false;
}

export function moveAndCollide(map, x, y, dx, dy, radius = 9, extraSolid = null) {
    const solid = (wx, wy) => {
        if (map.solidAt(wx, wy)) return true;
        return extraSolid ? extraSolid(wx, wy) : false;
    };
    const blockedAt = (px, py) => bodyBlocked(solid, px, py, radius);

    let nx = x, ny = y, hitX = false, hitY = false;
    if (dx !== 0) {
        const tx = nx + dx;
        if (!blockedAt(tx, ny)) nx = tx; else hitX = true;
    }
    if (dy !== 0) {
        const ty = ny + dy;
        if (!blockedAt(nx, ty)) ny = ty; else hitY = true;
    }

    // Corner assist. Walking straight at a tree trunk or into the edge of a
    // gap used to stop you dead until you pressed a second direction by hand.
    // When the way forward is blocked and the player is NOT steering sideways,
    // look for clearance a little to either side and slip round the obstacle.
    // The sideways step is proportional to the frame's own movement, so the
    // result is identical at 30, 60 and 120 FPS, and it only fires when the
    // forward step genuinely becomes possible — it can never push you into
    // geometry or move you when there is a real wall ahead.
    const slip = (horizontal) => {
        const along = horizontal ? dx : dy;
        const step = Math.abs(along) * 0.85;         // gentle: never outruns the player
        const far = radius * 1.6;                    // how far aside we are willing to look
        const at = (lat, forward) => (horizontal
            ? blockedAt(nx + (forward ? dx : 0), ny + lat)
            : blockedAt(nx + lat, ny + (forward ? dy : 0)));
        // Commit to a side only if the way forward is genuinely open there.
        // Against a solid wall both probes are blocked and nothing happens.
        let best = 0;
        for (const sgn of [1, -1]) {
            if (at(sgn * far, true) || at(sgn * far, false)) continue;
            if (!best) best = sgn;
            else if (!at(sgn * far * 0.5, true)) { best = sgn; break; }
        }
        if (!best) return false;
        if (!at(best * step, true)) {                // forward is already clear aside
            if (horizontal) { nx += dx; ny += best * step; } else { ny += dy; nx += best * step; }
            return true;
        }
        if (!at(best * step, false)) {               // still shouldering past: slide only
            if (horizontal) ny += best * step; else nx += best * step;
            return true;
        }
        return false;
    };
    if (hitX && dy === 0 && slip(true)) hitX = false;
    else if (hitY && dx === 0 && slip(false)) hitY = false;
    // Keep inside the zone rectangle.
    nx = Math.max(radius, Math.min(map.widthPx - radius, nx));
    ny = Math.max(radius, Math.min(map.heightPx - radius, ny));
    return { x: nx, y: ny, hitX, hitY };
}
