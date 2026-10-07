/** Continuous terrain field shared by rasterisation, water FX and collision.
 * Tile IDs remain the saved/generated authoring grid; natural boundaries are
 * reconstructed from neighbouring centres, not four unrelated edge strips.
 */
import { T, TILE_SIZE, tileInfo } from "./tiles.js";
import { valueNoise2D } from "../core/rng.js";

const BUILT = new Set([T.PLANK, T.COBBLE, T.FARM, T.FARM_WET]);
const smooth = (v) => v * v * (3 - 2 * v);
export class TerrainField {
    constructor(map, seed = 1, biome = "ashfall") {
        this.map = map; this.seed = seed; this.biome = biome;
        this.relief = biome === "cave" ? 0 : biome === "highland" || biome === "pass" ? 100
            : biome === "shore" || biome === "swamp" ? 12 : 44;
    }

    noise(x, y, scale, salt = 0) { return valueNoise2D(this.seed + salt, x / scale, y / scale); }

    /** Height in world units; low rolling hills, higher ridges in the mountains. */
    elevation(x, y) {
        return this.relief * (this.noise(x, y, 260, 1021) * 0.75 + this.noise(x, y, 112, 1029) * 0.25);
    }

    slope(x, y, dx = 0, dy = 0) {
        if (!this.relief) return 1;
        const len = Math.hypot(dx, dy);
        if (!len) return 1;
        const rise = (this.elevation(x + dx / len * 12, y + dy / len * 12) - this.elevation(x, y)) / 12;
        return Math.max(0.72, Math.min(1.04, 1 - Math.max(0, rise) * 0.7));
    }

    sample(wx, wy) {
        const map = this.map, tx = Math.floor(wx / TILE_SIZE), ty = Math.floor(wy / TILE_SIZE);
        const original = map.get(tx, ty);
        if (original === T.VOID || BUILT.has(original)) return { id: original, water: 0, cliff: 0, weights: [[original, 1]] };
        // Small domain warp rounds corners but keeps the centre of a tile
        // and every authored doorway on its original side of the boundary.
        const warpX = (this.noise(wx, wy, 91, 23) - 0.5) * 24;
        const warpY = (this.noise(wx, wy, 79, 37) - 0.5) * 24;
        const x = (wx + warpX) / TILE_SIZE - 0.5, y = (wy + warpY) / TILE_SIZE - 0.5;
        const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
        const weights = [];
        let water = 0, deep = 0, cliff = 0, best = -1, id = original;
        for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
            let t = map.get(ix + dx, iy + dy);
            if (t === T.VOID || BUILT.has(t)) t = original;
            const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
            weights.push([t, w]);
            // Linear occupancy is rounder than smoothstep's square plateaus;
            // material colour retains the smooth interpolation above.
            const bw = (dx ? x - ix : 1 - (x - ix)) * (dy ? y - iy : 1 - (y - iy));
            if (tileInfo(t).liquid) water += bw;
            if (t === T.DEEP) deep += bw;
            if (t === T.CLIFF) cliff += bw;
            if (w > best) { best = w; id = t; }
        }
        if (water >= 0.5) id = deep >= 0.5 ? T.DEEP : T.WATER;
        else if (cliff >= 0.5) id = T.CLIFF;
        else if (tileInfo(id).liquid || id === T.CLIFF) {
            best = -1;
            for (const [t, w] of weights) if (!tileInfo(t).liquid && t !== T.CLIFF && w > best) { best = w; id = t; }
        }
        return { id, water, cliff, weights };
    }
}
