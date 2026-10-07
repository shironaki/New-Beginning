/**
 * core — deterministic pseudo-random numbers.
 *
 * Every procedural thing in the valley (terrain, loot rolls, weather, NPC
 * quirks) must be reproducible from a single world seed, otherwise saves and
 * tests become impossible. No Math.random() anywhere in world generation.
 */

/** Hash an arbitrary string into a 32-bit unsigned integer seed. */
export function hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/** Mix several integers into one seed (zone id + chunk coords + salt…). */
export function mixSeeds(...nums) {
    let h = 0x9e3779b9 >>> 0;
    for (const n of nums) {
        h ^= (Number(n) | 0) >>> 0;
        h = Math.imul(h, 2654435761) >>> 0;
        h = (h << 13 | h >>> 19) >>> 0;
    }
    return h >>> 0;
}

/**
 * Small, fast, well-distributed PRNG (mulberry32).
 * Deterministic: same seed → same stream, in node and in the browser.
 */
export class RNG {
    constructor(seed = 1) {
        this.seed = typeof seed === "string" ? hashSeed(seed) : (seed >>> 0) || 1;
        this.state = this.seed;
    }

    /** Float in [0, 1). */
    next() {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Float in [min, max). */
    range(min, max) { return min + this.next() * (max - min); }

    /** Integer in [min, max] inclusive. */
    int(min, max) { return Math.floor(this.range(min, max + 1)); }

    /** True with probability p. */
    chance(p) { return this.next() < p; }

    /** Random element of an array (undefined for empty arrays). */
    pick(arr) { return arr.length ? arr[this.int(0, arr.length - 1)] : undefined; }

    /**
     * Weighted pick: entries are [value, weight] pairs or objects with
     * a `weight` field. Returns null when nothing has positive weight.
     */
    weighted(entries) {
        let total = 0;
        for (const e of entries) total += Array.isArray(e) ? e[1] : (e.weight || 0);
        if (total <= 0) return null;
        let roll = this.next() * total;
        for (const e of entries) {
            const w = Array.isArray(e) ? e[1] : (e.weight || 0);
            roll -= w;
            if (roll <= 0) return Array.isArray(e) ? e[0] : e;
        }
        const last = entries[entries.length - 1];
        return Array.isArray(last) ? last[0] : last;
    }

    /** In-place Fisher-Yates shuffle. */
    shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this.int(0, i);
            const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }

    /** Fork a derived generator — keeps subsystems from stealing each other's stream. */
    fork(salt) { return new RNG(mixSeeds(this.state, hashSeed(String(salt)))); }
}

/* ---------------------------------------------------------------------------
 * Value noise — the backbone of terrain, forest density and ore veins.
 * Grid-based, smoothly interpolated, tile-able per seed. Pure function of
 * (seed, x, y): no internal state, so chunks can be generated in any order.
 * ------------------------------------------------------------------------- */

function hash2(seed, x, y) {
    let h = mixSeeds(seed, x, y);
    h ^= h >>> 15;
    h = Math.imul(h, 2246822507) >>> 0;
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

function smoothstep(t) { return t * t * (3 - 2 * t); }

/** Smooth value noise in [0, 1] at continuous coordinates. */
export function valueNoise2D(seed, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smoothstep(xf), v = smoothstep(yf);
    const a = hash2(seed, xi, yi);
    const b = hash2(seed, xi + 1, yi);
    const c = hash2(seed, xi, yi + 1);
    const d = hash2(seed, xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Fractal (octave) noise in [0, 1]. More octaves = more detail, at a cost.
 * `scale` is in tiles per lowest-frequency cell.
 */
export function fbm2D(seed, x, y, { octaves = 4, scale = 24, persistence = 0.5, lacunarity = 2 } = {}) {
    let amp = 1, freq = 1 / scale, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
        sum += valueNoise2D(seed + o * 7919, x * freq, y * freq) * amp;
        norm += amp;
        amp *= persistence;
        freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
}
