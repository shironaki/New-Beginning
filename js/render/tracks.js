/**
 * render — footprints.
 *
 * A separate, very cheap layer between the ground and the objects: the hero
 * leaves prints on soft ground (sand, snow, mud, ash) and they fade away.
 * Not baked into the chunk — baking would make them permanent and would blow
 * the chunk cache on every step.
 *
 * Rules of the house: everything by the numbers below, a fixed pool, zero
 * allocation per frame (prints are reused in place, never created in `add`).
 */

import { TILES } from "../world/tiles.js";

export const TRACK = {
    max: 110,            // ring buffer; ~55 steps of history per foot
    rx: 3.0,             // sole, world units (the boot itself is 5.2 x 2.8)
    ry: 1.9,
    toe: 0.55,           // toe ellipse, share of the sole
    toeGap: 1.5,         // how far the toe sits ahead of the heel
    sideGap: 2.6,        // left/right offset from the body centre
    sink: 0.75,          // print offset along the heading, world units
    // The world is seen at three quarters, so a step sideways on the ground
    // covers LESS screen height than it does screen width. Without this the
    // right-foot print of a hero walking east landed a visible 3 px below
    // his boots instead of under them.
    vScale: 0.52,        // vertical squash of every ground offset
    footDrop: 0,         // px below the foot line; the boots ARE the line
    rimA: 0.45,          // rim highlight = depth alpha x this
    coreA: 0.5,          // the dark heart of the hollow, share of depth
    fadeIn: 0.12,        // seconds — a print appears, it does not pop
    minZoom: 1.1,        // below this the prints are mush; skip them
    // Soaked boots: for a while after wading, every step leaves a wet mark —
    // and it prints on stone and grass too, where dry boots leave nothing.
    wetLife: 9,          // seconds the boots stay wet after the last wading step
    wet: { life: 11, depth: 0.34 },
    wetDark: "#2b4a57",  // the stain
    wetRim: "#9ed8ea",   // the gleam on it
    // Per-surface: how long a print survives and how deep it reads.
    soil: {
        sand: { life: 18, depth: 0.38 },
        snow: { life: 34, depth: 0.34 },
        mud:  { life: 22, depth: 0.44 },
        ash:  { life: 16, depth: 0.36 },
        dirt: { life: 9,  depth: 0.20 }
    }
};

export class Tracks {
    constructor() {
        this.items = new Array(TRACK.max);
        for (let i = 0; i < TRACK.max; i++) {
            this.items[i] = {
                alive: false, x: 0, y: 0, dx: 0, dy: 1, wet: false,
                t: 0, life: 1, depth: 0, dark: "#000", rim: "#fff"
            };
        }
        this.head = 0;
        this.count = 0;
    }

    clear() {
        for (const p of this.items) p.alive = false;
        this.count = 0;
        return this;
    }

    /** Does this ground hold a print at all? */
    static soilOf(tileId, wet = false) {
        const info = TILES[tileId];
        if (!info || info.liquid) return null;
        if (wet) return TRACK.wet;              // water prints on anything
        return TRACK.soil[info.step] || null;
    }

    /**
     * Plant one print. `side` is +1 right foot / -1 left, `dx,dy` the heading.
     * Reuses the oldest slot — no object is built here.
     */
    add(x, y, dx, dy, side, tileId, wet = false) {
        const soil = Tracks.soilOf(tileId, wet);
        if (!soil) return this;
        const info = TILES[tileId];
        const len = Math.hypot(dx, dy) || 1;
        const hx = dx / len, hy = dy / len;
        const p = this.items[this.head];
        this.head = (this.head + 1) % TRACK.max;
        if (!p.alive) this.count++;
        p.alive = true;
        // Feet are not on the spine: step off the centre line by the side.
        p.x = x - hy * TRACK.sideGap * side + hx * TRACK.sink;
        p.y = y + (hx * TRACK.sideGap * side + hy * TRACK.sink) * TRACK.vScale + TRACK.footDrop;
        p.dx = hx; p.dy = hy;
        p.t = 0;
        p.life = soil.life;
        p.depth = soil.depth;
        p.wet = wet;
        p.dark = wet ? TRACK.wetDark : info.colors[1];
        p.rim = wet ? TRACK.wetRim : info.colors[2];
        return this;
    }

    update(dt) {
        const items = this.items;
        for (let i = 0; i < items.length; i++) {
            const p = items[i];
            if (!p.alive) continue;
            p.t += dt;
            if (p.t >= p.life) { p.alive = false; this.count--; }
        }
        return this;
    }

    /** Drawn right after the ground, before anything that stands on it. */
    draw(ctx, cam) {
        if (!this.count || cam.zoom < TRACK.minZoom) return this;
        const z = cam.zoom;
        ctx.save();
        for (const p of this.items) {
            if (!p.alive) continue;
            if (!cam.isVisible(p.x, p.y, 16)) continue;
            const age = p.t / p.life;
            // Linear fade for most of the life, a quick ramp at the start.
            const a = Math.min(1, p.t / TRACK.fadeIn) * (1 - age) * p.depth;
            if (a <= 0.004) continue;
            const s = cam.worldToScreen(p.x, p.y);
            const ang = Math.atan2(p.dy, p.dx) + Math.PI / 2;
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(ang);
            ctx.scale(z, z);
            // The hollow.
            ctx.globalAlpha = a;
            ctx.fillStyle = p.dark;
            ctx.beginPath();
            ctx.ellipse(0, 0, TRACK.rx, TRACK.ry, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(0, -TRACK.toeGap, TRACK.rx * TRACK.toe, TRACK.ry * TRACK.toe,
                        0, 0, Math.PI * 2);
            ctx.fill();
            // The heart of the hollow is in shade whatever the ground is —
            // without it a print on pale sand is invisible.
            ctx.globalAlpha = a * TRACK.coreA;
            ctx.fillStyle = "#000";
            ctx.beginPath();
            ctx.ellipse(0, -0.2, TRACK.rx * 0.62, TRACK.ry * 0.62, 0, 0, Math.PI * 2);
            ctx.fill();
            // Dry ground gets a lip of displaced soil (a dent); wet ground
            // gets a highlight (a puddle shaped like a boot).
            ctx.globalAlpha = a * (p.wet ? TRACK.rimA * 1.4 : TRACK.rimA);
            ctx.fillStyle = p.rim;
            ctx.beginPath();
            ctx.ellipse(0, TRACK.ry * 0.75, TRACK.rx * 0.95, TRACK.ry * 0.45,
                        0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();
        return this;
    }
}
