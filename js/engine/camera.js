/**
 * v3 engine — camera with dead-zone follow, world clamping, zoom and shake.
 *
 * The dead zone keeps the view still during small steps (less motion sickness
 * than a camera glued to the player) and catches up smoothly on longer moves.
 */
export class Camera {
    /** How far the view runs ahead of the hero. */
    static LEAD = {
        perSpeed: 0.22,     // world units of lead per unit of speed
        max: 26,            // never more than this, or the hero drifts off-centre
        vertical: 0.7,      // less lead up/down: the screen is shorter that way
        tau: 0.45           // s, how softly the lead builds and decays
    };

    constructor({ width = 960, height = 540, zoom = 2, deadzone = 36, lerp = 6 } = {}) {
        this.x = 0; this.y = 0;             // top-left of the view, in world units
        this.width = width; this.height = height;
        this.zoom = zoom;
        this.deadzone = deadzone;
        this.lerp = lerp;
        this.bounds = null;                 // { w, h } of the current zone, world units
        this.shakeTime = 0; this.shakePower = 0;
        this.motionScale = 1;       // 0 when the player asked for reduced motion
        this.offsetX = 0; this.offsetY = 0; // shake offset, applied at draw time
    }

    /** Visible area in world units (depends on zoom). */
    get viewW() { return this.width / this.zoom; }
    get viewH() { return this.height / this.zoom; }

    resize(width, height) { this.width = width; this.height = height; return this; }
    setBounds(w, h) { this.bounds = { w, h }; return this; }

    /** Jump straight to a target, no easing (teleports, zone changes). */
    snapTo(tx, ty) {
        this.x = tx - this.viewW / 2;
        this.y = ty - this.viewH / 2;
        this.clamp();
        return this;
    }

    /**
     * Dead-zone follow with a lead: the view drifts ahead of a moving hero so
     * he is not pinned to the centre staring at where he has been. `vx, vy`
     * are his velocity in world units per second.
     *
     * The lead itself eases in and out (`LEAD.tau`), otherwise the frame
     * jumps sideways the moment a key goes down.
     */
    follow(tx, ty, dt, vx = 0, vy = 0) {
        const L = Camera.LEAD;
        const speed = Math.hypot(vx, vy);
        const want = Math.min(L.max, speed * L.perSpeed) * this.motionScale;
        const wantX = speed > 1 ? (vx / speed) * want : 0;
        const wantY = speed > 1 ? (vy / speed) * want * L.vertical : 0;
        const k = 1 - Math.exp(-dt / L.tau);
        this.leadX = (this.leadX || 0) + (wantX - (this.leadX || 0)) * k;
        this.leadY = (this.leadY || 0) + (wantY - (this.leadY || 0)) * k;

        const cx = this.x + this.viewW / 2;
        const cy = this.y + this.viewH / 2;
        const dx = tx + this.leadX - cx, dy = ty + this.leadY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > this.deadzone) {
            const pull = (dist - this.deadzone) / dist;
            const k2 = Math.min(1, this.lerp * dt);
            this.x += dx * pull * k2;
            this.y += dy * pull * k2;
        }
        this.clamp();
        return this;
    }

    /** Keep the view inside the zone; centre it on axes smaller than the view. */
    clamp() {
        if (!this.bounds) return this;
        const { w, h } = this.bounds;
        if (w <= this.viewW) this.x = (w - this.viewW) / 2;
        else this.x = Math.max(0, Math.min(w - this.viewW, this.x));
        if (h <= this.viewH) this.y = (h - this.viewH) / 2;
        else this.y = Math.max(0, Math.min(h - this.viewH, this.y));
        return this;
    }

    /**
     * Screen shake, scaled by `motionScale`. A player who asked the system
     * for reduced motion gets none of it: `prefers-reduced-motion` is read
     * once at start-up and followed live if it changes.
     */
    shake(power = 4, time = 0.25) {
        const p = power * this.motionScale;
        if (p <= 0.01) return this;
        this.shakePower = Math.max(this.shakePower, p);
        this.shakeTime = Math.max(this.shakeTime, time);
        return this;
    }

    /** Hook the OS accessibility setting. Safe where matchMedia is absent. */
    followReducedMotion(win = globalThis) {
        const mq = win && win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)");
        if (!mq) return this;
        const apply = () => {
            this.motionScale = mq.matches ? 0 : 1;
            if (!this.motionScale) { this.shakeTime = 0; this.shakePower = 0; this.offsetX = this.offsetY = 0; }
        };
        apply();
        if (mq.addEventListener) mq.addEventListener("change", apply);
        else if (mq.addListener) mq.addListener(apply);
        return this;
    }

    update(dt) {
        if (this.shakeTime > 0) {
            this.shakeTime -= dt;
            const falloff = Math.max(0, this.shakeTime);
            const p = this.shakePower * falloff * 4;
            this.offsetX = (Math.random() * 2 - 1) * p;
            this.offsetY = (Math.random() * 2 - 1) * p;
            if (this.shakeTime <= 0) { this.offsetX = this.offsetY = 0; this.shakePower = 0; }
        }
        return this;
    }

    /**
     * Allocation-free projection. `worldToScreen` builds an object, which is
     * fine once per entity but not once per particle — hot loops use these.
     */
    toScreenX(wx) { return (wx - this.x + this.offsetX) * this.zoom; }
    toScreenY(wy) { return (wy - this.y + this.offsetY) * this.zoom; }

    worldToScreen(wx, wy) {
        return {
            x: (wx - this.x + this.offsetX) * this.zoom,
            y: (wy - this.y + this.offsetY) * this.zoom
        };
    }

    screenToWorld(sx, sy) {
        return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y };
    }

    /** Culling test with a margin, in world units. */
    isVisible(wx, wy, margin = 48) {
        return wx >= this.x - margin && wx <= this.x + this.viewW + margin &&
               wy >= this.y - margin && wy <= this.y + this.viewH + margin;
    }
}
