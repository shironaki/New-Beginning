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
    textDrag: 0.94
};

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
        for (let i = 0; i < n; i++) {
            const o = this._claim();
            o.x = x; o.y = y;
            o.vx = (Math.random() - 0.5) * 16; o.vy = -18 - Math.random() * 22;
            o.life = 0.5 + Math.random() * 0.6; o.maxLife = 1.1; o.gravity = 10;
            o.size = 1 + Math.random() * 1.4; o.alpha = 1; o.glyph = "";
            o.color = Math.random() > 0.5 ? "#ffcf6a" : "#ff8a3a"; o.kind = "spark";
        }
        return this;
    }

    smoke(x, y, n = 1) {
        for (let i = 0; i < n; i++) {
            const o = this._claim();
            o.x = x + (Math.random() - 0.5) * 4; o.y = y;
            o.vx = (Math.random() - 0.5) * 5; o.vy = -9 - Math.random() * 6;
            o.life = 1.6 + Math.random(); o.maxLife = 2.6; o.gravity = 0;
            o.size = 3 + Math.random() * 3; o.alpha = 1; o.glyph = "";
            o.color = "rgba(180,175,170,0.5)"; o.kind = "smoke";
        }
        return this;
    }

    chips(x, y, color = "#8a6a3c", n = 7) {
        for (let i = 0; i < n; i++) {
            const o = this._claim();
            o.x = x; o.y = y;
            o.vx = (Math.random() - 0.5) * 40; o.vy = -20 - Math.random() * 25;
            o.life = 0.4 + Math.random() * 0.3; o.maxLife = 0.7; o.gravity = 120;
            o.size = 1.5 + Math.random() * 1.5; o.alpha = 1; o.glyph = "";
            o.color = color; o.kind = "chip";
        }
        return this;
    }

    /** Dust kicked up by a footfall — soft, low, short-lived. */
    dust(x, y, n = 2, color = "rgba(176,163,140,0.55)") {
        for (let i = 0; i < n; i++) {
            const o = this._claim();
            o.x = x + (Math.random() - 0.5) * 5; o.y = y;
            o.vx = (Math.random() - 0.5) * 10; o.vy = -4 - Math.random() * 6;
            o.life = 0.3 + Math.random() * 0.25; o.maxLife = 0.55; o.gravity = -4;
            o.size = 2 + Math.random() * 2.4; o.alpha = 0.8; o.glyph = "";
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
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.kind === "smoke") { p.size += dt * FX.smokeGrowth; p.vx *= FX.smokeDrag; }
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
                ctx.fillStyle = p.color;
                const sz = p.size * cam.zoom * 0.5;
                if (p.kind === "smoke") {
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
