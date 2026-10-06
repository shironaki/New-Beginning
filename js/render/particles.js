/**
 * v3 render — particles and floating text.
 *
 * Sparks over the fire, smoke, rain, snow, dust from an axe hit, and the
 * "+2 🪵" numbers that make every action feel like it paid out.
 *
 * POOLED. Every particle and every label is created once, at construction,
 * and afterwards only has its fields rewritten. Spawning allocates nothing,
 * the update loop allocates nothing, the draw loop allocates nothing — dead
 * particles are removed by swapping the last live one into their slot, so
 * there is no `splice`, no `shift`, and nothing for the collector to sweep
 * mid-frame. A hitch in a particle burst is a hitch the player feels.
 */

export const FX = {
    maxParticles: 600,
    maxTexts: 40,
    /** Font sizes are bucketed so no frame ever builds a font string. */
    fontBuckets: [9, 11, 13, 16, 20, 26],
    smokeGrowth: 3,
    smokeDrag: 0.99,
    textDrag: 0.94,

    /**
     * Wind. The day's wind vector is handed to `setWind()` once per frame and
     * pushes each kind by its own share: smoke is a sail, a chip of stone is
     * not. px/s² per unit of wind strength.
     */
    wind: { smoke: 34, spark: 14, leaf: 26, dot: 8, chip: 0, ember: 10 },

    /** Sparks over a flame. */
    spark: { spread: 16, rise: 18, riseVar: 22, life: 0.5, lifeVar: 0.6,
             gravity: 10, size: 1, sizeVar: 1.4, hot: "#ffcf6a", cool: "#ff8a3a" },
    /** Smoke: rises, spreads, greys out as it cools. */
    smoke: { spread: 4, drift: 5, rise: 9, riseVar: 6, life: 1.6, lifeVar: 1,
             size: 3, sizeVar: 3, warm: [196, 176, 150], cold: [150, 150, 152] },
    /** Chips off a struck prop. */
    chip: { spread: 40, rise: 20, riseVar: 25, life: 0.4, lifeVar: 0.3,
            gravity: 120, size: 1.5, sizeVar: 1.5 },
    /** Dust under a boot: harder at a run, the colour of the ground. */
    dust: { spread: 5, drift: 10, rise: 4, riseVar: 6, life: 0.3, lifeVar: 0.25,
            size: 2, sizeVar: 2.4, walk: 2, run: 4, runBoost: 1.5 },
    /** Leaves shaken loose when a crown comes down. */
    // Brushing through undergrowth: a couple of torn leaves per step, and
    // only when the hero is actually moving through a plant.
    rustle: { every: 0.22, leaves: 2, up: 7 },
    leaf: { spread: 26, rise: 10, riseVar: 18, life: 1.4, lifeVar: 1.1,
            gravity: 16, size: 2, sizeVar: 1.6, sway: 2.4 },
    /** Wading: droplets thrown up by a boot, and the ring it leaves behind. */
    /**
     * Air you can see. Underground the torch light has to catch something or
     * the gallery reads as an empty box; a few slow motes do that for almost
     * nothing. Spawned around the hero, so they cost the same anywhere.
     */
    motes: {
        rate: 2.6,          // spawns per second while underground
        spread: 150,        // px around the hero they appear in
        life: 3.2, lifeVar: 2.4,
        rise: 3.5,          // px/s, they drift upward and sideways
        drift: 5,
        size: 0.9, sizeVar: 0.7,
        alpha: 0.5,
        color: "#d9e2ea"
    },
    /**
     * Outdoors in a low sun: pollen, chaff and dust hanging in the light.
     * Same pool as the cave motes, warmer and only while the sun is low
     * enough to light them from the side.
     */
    pollen: {
        rate: 1.9,          // spawns per second around the hero
        spread: 190,
        life: 4.2, lifeVar: 2.6,
        rise: 2.2, drift: 7,
        size: 1.0, sizeVar: 0.9,
        alpha: 0.5,
        warm: "#ffe6ae",    // caught by a low sun
        cool: "#e8f0f2",    // overcast, or high noon
        sunBelow: 9,        // hours from noon at which they start to show
        maxWeather: 0.75    // nothing hangs in the air in a storm
    },
    /** A gust tearing leaves off a tree. */
    gustLeaf: {
        minStrength: 0.65,  // wind below this takes nothing with it
        every: 0.9,         // s between attempts
        reach: 260,         // px around the hero worth animating
        leaves: 2,
        crown: 30           // px above the trunk's foot the leaf lets go
    },
    /** Water finding its way through the roof of a mine. */
    ceilingDrip: {
        rate: 1.7,          // drops per second near the hero
        rateVary: 0.75,     // ± of the interval, so drips never tick like a metronome
        spread: 170,
        fall: 70,           // px/s at birth
        gravity: 320,
        life: 0.55,
        size: 1.2,
        color: "#9fd6e8",
        ringLife: 0.5,
        ringGrow: 16,
        ringA: 0.28
    },
    // Run-off from a soaked hero walking back onto dry land.
    drip: {
        spread: 7,          // across the body, world units
        from: 12,           // height it leaves the clothes at
        fall: 26,           // initial downward speed
        gravity: 200,
        life: 0.26, lifeVar: 0.12,
        size: 1.1,
        color: "#8fd0e4",
        every: 0.33         // seconds between drops while soaked and moving
    },
    splash: { drops: 7, spread: 26, rise: 22, riseVar: 18, gravity: 150,
              life: 0.3, lifeVar: 0.25, size: 1.2, sizeVar: 1.3,
              color: "rgba(226,246,255,0.9)",
              ringLife: 0.65, ringGrow: 26, ringA: 0.5 },
    /** A prop hitting the ground: a low ring of dust plus a thud of shake. */
    impact: { ring: 16, ringVar: 10, life: 0.5, lifeVar: 0.35, size: 3, sizeVar: 3 },

    /**
     * Camera shake, in one place so no caller invents its own. Power is in
     * world px, time in seconds.
     */
    shake: { hit: 0.9, hitTime: 0.1, fell: 3.2, fellTime: 0.32,
             thunder: 2.2, thunderTime: 0.55 }
};

/**
 * What a struck thing is made of. The old code read `kind.includes("rock")`
 * in the middle of the harvest routine; material belongs in a table.
 */
export const MATERIAL = {
    wood:  { chip: "#8a6a3c", chips: 6, leaf: null },
    stone: { chip: "#9a958c", chips: 7, leaf: null },
    plant: { chip: "#6d8a46", chips: 4, leaf: "#7fa24f" },
    ash:   { chip: "#4a4038", chips: 5, leaf: null },
    cloth: { chip: "#8c7a58", chips: 4, leaf: null }
};

/** Material of a prop kind — one lookup, no string sniffing at the call site. */
export function materialOf(kind = "") {
    if (kind.includes("rock") || kind.includes("ruin") || kind.includes("ore")) return MATERIAL.stone;
    if (kind.includes("burnt") || kind.includes("ash") || kind.includes("charcoal")) return MATERIAL.ash;
    if (kind === "tent" || kind === "chest_old") return MATERIAL.cloth;
    if (kind.includes("bush") || kind.includes("herb") || kind.includes("grass")
        || kind.includes("reed") || kind.includes("flower")) return MATERIAL.plant;
    return MATERIAL.wood;
}

const EMPTY = {
    x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
    size: 2, color: "#fff", gravity: 0, kind: "dot", alpha: 1, glyph: ""
};

function blankParticle() { return Object.assign({}, EMPTY); }
function blankText() {
    return { x: 0, y: 0, str: "", color: "#fff", life: 0, maxLife: 1, vy: 0, size: 11 };
}

export class Particles {
    constructor({ max = FX.maxParticles, maxTexts = FX.maxTexts } = {}) {
        this.max = max;
        this.maxTexts = maxTexts;
        /** @type {object[]} the pool; slots 0..n-1 are live */
        this.pool = new Array(max);
        for (let i = 0; i < max; i++) this.pool[i] = blankParticle();
        this.n = 0;
        this.textPool = new Array(maxTexts);
        for (let i = 0; i < maxTexts; i++) this.textPool[i] = blankText();
        this.tn = 0;
        // Pre-built font strings, one per bucket, per family.
        this._emojiFonts = FX.fontBuckets.map((s) => `${s}px serif`);
        this._uiFonts = FX.fontBuckets.map((s) => `bold ${s}px "Segoe UI", system-ui, sans-serif`);
        this.windX = 0; this.windY = 0;
    }

    /**
     * The day's wind, in world units. Set once per frame from the weather
     * system; `update()` applies it per kind through `FX.wind`.
     */
    setWind(angle = 0, strength = 0) {
        this.windX = Math.cos(angle) * strength;
        this.windY = Math.sin(angle) * strength * 0.35;   // top-down: less vertical
        return this;
    }

    /** Oldest-first recycling: a burst never silently drops its own sparks. */
    _claim() {
        if (this.n < this.max) return this.pool[this.n++];
        // Full: reuse the slot with the least life left.
        let worst = 0, least = Infinity;
        for (let i = 0; i < this.n; i++) {
            if (this.pool[i].life < least) { least = this.pool[i].life; worst = i; }
        }
        return this.pool[worst];
    }

    /**
     * Spawn one particle. `p` is read field by field — it is never stored,
     * so callers may pass a literal without it reaching the heap for long.
     */
    spawn(p) {
        const o = this._claim();
        o.x = p.x || 0; o.y = p.y || 0;
        o.vx = p.vx || 0; o.vy = p.vy || 0;
        o.life = p.life !== undefined ? p.life : 1;
        o.maxLife = p.maxLife !== undefined ? p.maxLife : o.life;
        o.size = p.size !== undefined ? p.size : 2;
        o.color = p.color || "#fff";
        o.gravity = p.gravity || 0;
        o.kind = p.kind || "dot";
        o.alpha = p.alpha !== undefined ? p.alpha : 1;
        o.glyph = p.glyph || "";
        return this;
    }

    /** Floating loot/feedback text, in world coordinates. */
    text(x, y, str, { color = "#fff", life = 1.2, vy = -22, size = 11 } = {}) {
        let t;
        if (this.tn < this.maxTexts) t = this.textPool[this.tn++];
        else { t = this.textPool[0]; for (let i = 1; i < this.tn; i++) if (this.textPool[i].life < t.life) t = this.textPool[i]; }
        t.x = x; t.y = y; t.str = str; t.color = color;
        t.life = life; t.maxLife = life; t.vy = vy; t.size = size;
        return this;
    }

    /* ---- presets ------------------------------------------------------- */

    sparks(x, y, n = 6) {
        const C = FX.spark;
        for (let i = 0; i < n; i++) {
            const o = this._claim();
            o.x = x; o.y = y;
            o.vx = (Math.random() - 0.5) * C.spread; o.vy = -C.rise - Math.random() * C.riseVar;
            o.life = C.life + Math.random() * C.lifeVar; o.maxLife = C.life + C.lifeVar;
            o.gravity = C.gravity;
            o.size = C.size + Math.random() * C.sizeVar; o.alpha = 1; o.glyph = "";
            o.color = Math.random() > 0.5 ? C.hot : C.cool; o.kind = "spark";
        }
        return this;
    }

    smoke(x, y, n = 1) {
        const C = FX.smoke;
        for (let i = 0; i < n; i++) {
            const o = this._claim();
            o.x = x + (Math.random() - 0.5) * C.spread; o.y = y;
            o.vx = (Math.random() - 0.5) * C.drift; o.vy = -C.rise - Math.random() * C.riseVar;
            o.life = C.life + Math.random() * C.lifeVar; o.maxLife = C.life + C.lifeVar;
            o.gravity = 0;
            o.size = C.size + Math.random() * C.sizeVar; o.alpha = 1; o.glyph = "";
            o.color = ""; o.kind = "smoke";       // colour is computed as it cools
        }
        return this;
    }

    chips(x, y, color = MATERIAL.wood.chip, n = 7) {
        const C = FX.chip;
        for (let i = 0; i < n; i++) {
            const o = this._claim();
            o.x = x; o.y = y;
            o.vx = (Math.random() - 0.5) * C.spread; o.vy = -C.rise - Math.random() * C.riseVar;
            o.life = C.life + Math.random() * C.lifeVar; o.maxLife = C.life + C.lifeVar;
            o.gravity = C.gravity;
            o.size = C.size + Math.random() * C.sizeVar; o.alpha = 1; o.glyph = "";
            o.color = color; o.kind = "chip";
        }
        return this;
    }

    /** Dust kicked up by a footfall — soft, low, short-lived. */
    dust(x, y, n = 2, color = "rgba(176,163,140,0.55)") {
        const C = FX.dust;
        for (let i = 0; i < n; i++) {
            const o = this._claim();
            o.x = x + (Math.random() - 0.5) * C.spread; o.y = y;
            o.vx = (Math.random() - 0.5) * C.drift; o.vy = -C.rise - Math.random() * C.riseVar;
            o.life = C.life + Math.random() * C.lifeVar; o.maxLife = C.life + C.lifeVar;
            o.gravity = -4;
            o.size = C.size + Math.random() * C.sizeVar; o.alpha = 0.8; o.glyph = "";
            o.color = color; o.kind = "dot";
        }
        return this;
    }

    /** Leaves torn loose: they hang in the air and slide sideways. */
    leaves(x, y, color = MATERIAL.plant.leaf, n = 8) {
        const C = FX.leaf;
        for (let i = 0; i < n; i++) {
            const o = this._claim();
            o.x = x + (Math.random() - 0.5) * C.spread;
            o.y = y - Math.random() * 10;
            o.vx = (Math.random() - 0.5) * C.sway * 6; o.vy = -C.rise + Math.random() * C.riseVar;
            o.life = C.life + Math.random() * C.lifeVar; o.maxLife = C.life + C.lifeVar;
            o.gravity = C.gravity;
            o.size = C.size + Math.random() * C.sizeVar; o.alpha = 0.9; o.glyph = "";
            o.color = color; o.kind = "leaf";
        }
        return this;
    }

    /**
     * A boot going into the shallows: a spray of droplets and an expanding
     * ring on the surface. The ring is its own kind — it is drawn as an
     * outline, so it reads as water and not as smoke.
     */
    splash(x, y, power = 1) {
        const C = FX.splash;
        const n = Math.max(2, Math.round(C.drops * power));
        for (let i = 0; i < n; i++) {
            const o = this._claim();
            o.x = x + (Math.random() - 0.5) * 4; o.y = y;
            o.vx = (Math.random() - 0.5) * C.spread * power;
            o.vy = -(C.rise + Math.random() * C.riseVar) * power;
            o.life = C.life + Math.random() * C.lifeVar; o.maxLife = C.life + C.lifeVar;
            o.gravity = C.gravity;
            o.size = C.size + Math.random() * C.sizeVar; o.alpha = 1; o.glyph = "";
            o.color = C.color; o.kind = "spark";
        }
        const r = this._claim();
        r.x = x; r.y = y; r.vx = 0; r.vy = 0; r.gravity = 0;
        r.life = C.ringLife; r.maxLife = C.ringLife;
        r.size = 2; r.alpha = C.ringA; r.glyph = "";
        r.color = "rgba(226,246,255,"; r.kind = "ripple";
        return this;
    }

    /**
     * Water running off soaked boots and clothes: a couple of heavy drops
     * that fall straight down and die on the ground. Costs two particles.
     */
    drip(x, y, n = 1) {
        const C = FX.drip;
        for (let i = 0; i < n; i++) {
            const o = this._claim();
            o.x = x + (Math.random() - 0.5) * C.spread;
            o.y = y - C.from;
            o.vx = (Math.random() - 0.5) * 3;
            o.vy = C.fall;
            o.life = C.life + Math.random() * C.lifeVar; o.maxLife = C.life + C.lifeVar;
            o.gravity = C.gravity;
            o.size = C.size; o.alpha = 1; o.glyph = "";
            o.color = C.color; o.kind = "spark";
        }
        return this;
    }

    /** One slow speck of dust hanging in the air. */
    /** A speck of pollen in the sunlight; `warm` picks the low-sun colour. */
    pollen(x, y, warm = true) {
        const C = FX.pollen;
        const o = this._claim();
        o.x = x; o.y = y;
        o.vx = (Math.random() - 0.5) * C.drift;
        o.vy = -(Math.random() * C.rise);
        o.life = C.life + Math.random() * C.lifeVar; o.maxLife = C.life + C.lifeVar;
        o.gravity = 0;
        o.size = C.size + Math.random() * C.sizeVar;
        o.alpha = C.alpha; o.glyph = "";
        o.color = warm ? C.warm : C.cool; o.kind = "dot";
        return this;
    }

    mote(x, y) {
        const C = FX.motes;
        const o = this._claim();
        o.x = x; o.y = y;
        o.vx = (Math.random() - 0.5) * C.drift;
        o.vy = -(Math.random() * C.rise);
        o.life = C.life + Math.random() * C.lifeVar; o.maxLife = C.life + C.lifeVar;
        o.gravity = 0;
        o.size = C.size + Math.random() * C.sizeVar;
        o.alpha = C.alpha; o.glyph = "";
        o.color = C.color; o.kind = "dot";
        return this;
    }

    /** A drop off the roof of a gallery, and the ring where it lands. */
    ceilingDrop(x, y) {
        const C = FX.ceilingDrip;
        const o = this._claim();
        o.x = x; o.y = y;
        o.vx = 0; o.vy = C.fall;
        o.life = C.life; o.maxLife = C.life;
        o.gravity = C.gravity;
        o.size = C.size; o.alpha = 1; o.glyph = "";
        o.color = C.color; o.kind = "spark";
        return this;
    }

    /** The ring that drop leaves when it hits the floor. */
    dropRing(x, y) {
        const C = FX.ceilingDrip;
        const r = this._claim();
        r.x = x; r.y = y; r.vx = 0; r.vy = 0; r.gravity = 0;
        r.life = C.ringLife; r.maxLife = C.ringLife;
        r.size = 1.5; r.alpha = C.ringA; r.glyph = "";
        r.color = "rgba(190,226,240,"; r.kind = "ripple";
        return this;
    }

    /**
     * Something heavy hit the ground: a low ring of dust pushed outward from
     * the point of impact. Paired with a camera shake by the caller.
     */
    impact(x, y, n = 10, color = "rgba(150,138,118,0.6)") {
        const C = FX.impact;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
            const sp = C.ring + Math.random() * C.ringVar;
            const o = this._claim();
            o.x = x; o.y = y;
            o.vx = Math.cos(a) * sp; o.vy = Math.sin(a) * sp * 0.45;
            o.life = C.life + Math.random() * C.lifeVar; o.maxLife = C.life + C.lifeVar;
            o.gravity = 0;
            o.size = C.size + Math.random() * C.sizeVar; o.alpha = 0.75; o.glyph = "";
            o.color = color; o.kind = "smoke";
        }
        return this;
    }

    hearts(x, y) {
        return this.spawn({ x, y, vy: -16, life: 1.1, size: 7, color: "#ff6b8a", kind: "emoji", glyph: "❤️" });
    }

    emote(x, y, glyph) {
        return this.spawn({ x, y, vy: -14, life: 1.4, size: 11, kind: "emoji", glyph });
    }

    /* ---- simulation ---------------------------------------------------- */

    update(dt) {
        for (let i = this.n - 1; i >= 0; i--) {
            const p = this.pool[i];
            p.life -= dt;
            if (p.life <= 0) {                       // swap-remove, no splice
                const last = this.pool[this.n - 1];
                this.pool[this.n - 1] = p;
                this.pool[i] = last;
                this.n--;
                continue;
            }
            const w = FX.wind[p.kind] || 0;
            if (w) { p.vx += this.windX * w * dt; p.vy += this.windY * w * dt; }
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.kind === "smoke") { p.size += dt * FX.smokeGrowth; p.vx *= FX.smokeDrag; }
            // A leaf does not fall straight: it slips side to side.
            if (p.kind === "leaf") p.x += Math.sin(p.life * 6) * FX.leaf.sway * dt * 6;
            if (p.kind === "ripple") p.size += dt * FX.splash.ringGrow;
        }
        for (let i = this.tn - 1; i >= 0; i--) {
            const t = this.textPool[i];
            t.life -= dt;
            if (t.life <= 0) {
                const last = this.textPool[this.tn - 1];
                this.textPool[this.tn - 1] = t;
                this.textPool[i] = last;
                this.tn--;
                continue;
            }
            t.y += t.vy * dt;
            t.vy *= FX.textDrag;
        }
        return this;
    }

    /** Nearest pre-built font string — never assembles one in the frame. */
    _font(list, px) {
        const b = FX.fontBuckets;
        let best = 0, diff = Infinity;
        for (let i = 0; i < b.length; i++) {
            const d = Math.abs(b[i] - px);
            if (d < diff) { diff = d; best = i; }
        }
        return list[best];
    }

    /** @param {CanvasRenderingContext2D} ctx @param {Camera} cam */
    draw(ctx, cam) {
        for (let i = 0; i < this.n; i++) {
            const p = this.pool[i];
            if (!cam.isVisible(p.x, p.y, 40)) continue;
            const sx = cam.toScreenX(p.x), sy = cam.toScreenY(p.y);
            const a = Math.max(0, Math.min(1, p.life / (p.maxLife || 1)));
            ctx.globalAlpha = a * p.alpha;
            if (p.kind === "emoji") {
                ctx.font = this._font(this._emojiFonts, p.size * cam.zoom * 0.6);
                ctx.textAlign = "center";
                ctx.fillText(p.glyph, sx, sy);
            } else {
                if (p.kind === "smoke" && !p.color) {
                    // Smoke cools as it climbs: warm near the embers, grey above.
                    const C = FX.smoke, t = 1 - a;
                    const r = Math.round(C.warm[0] + (C.cold[0] - C.warm[0]) * t);
                    const g = Math.round(C.warm[1] + (C.cold[1] - C.warm[1]) * t);
                    const b = Math.round(C.warm[2] + (C.cold[2] - C.warm[2]) * t);
                    ctx.fillStyle = `rgb(${r},${g},${b})`;
                    ctx.globalAlpha = a * p.alpha * 0.5;
                } else {
                    ctx.fillStyle = p.color;
                }
                const sz = p.size * cam.zoom * 0.5;
                if (p.kind === "ripple") {
                    // Flattened: we look at the water at an angle.
                    ctx.strokeStyle = `rgba(226,246,255,${(a * p.alpha).toFixed(3)})`;
                    ctx.lineWidth = Math.max(1, cam.zoom * 0.5);
                    ctx.beginPath();
                    ctx.ellipse(sx, sy, sz, sz * 0.42, 0, 0, Math.PI * 2);
                    ctx.stroke();
                } else if (p.kind === "smoke") {
                    ctx.beginPath(); ctx.arc(sx, sy, sz, 0, Math.PI * 2); ctx.fill();
                } else {
                    ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
                }
            }
        }
        ctx.globalAlpha = 1;

        for (let i = 0; i < this.tn; i++) {
            const t = this.textPool[i];
            if (!cam.isVisible(t.x, t.y, 60)) continue;
            const sx = cam.toScreenX(t.x), sy = cam.toScreenY(t.y);
            ctx.globalAlpha = Math.max(0, Math.min(1, t.life / t.maxLife));
            ctx.font = this._font(this._uiFonts, t.size * cam.zoom * 0.55);
            ctx.textAlign = "center";
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(0,0,0,0.7)";
            ctx.strokeText(t.str, sx, sy);
            ctx.fillStyle = t.color;
            ctx.fillText(t.str, sx, sy);
        }
        ctx.globalAlpha = 1;
        return this;
    }

    /** Live particles (the pool itself is always `max` long). */
    get items() { return this.pool.slice(0, this.n); }
    get texts() { return this.textPool.slice(0, this.tn); }
    get count() { return this.n + this.tn; }
    clear() { this.n = 0; this.tn = 0; return this; }
}
