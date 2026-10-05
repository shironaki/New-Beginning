/**
 * v3 engine — camera with dead-zone follow, world clamping, zoom and shake.
 *
 * The dead zone keeps the view still during small steps (less motion sickness
 * than a camera glued to the player) and catches up smoothly on longer moves.
 */
export class Camera {
    constructor({ width = 960, height = 540, zoom = 2, deadzone = 36, lerp = 6 } = {}) {
        this.x = 0; this.y = 0;             // top-left of the view, in world units
        this.width = width; this.height = height;
        this.zoom = zoom;
        this.deadzone = deadzone;
        this.lerp = lerp;
        this.bounds = null;                 // { w, h } of the current zone, world units
        this.shakeTime = 0; this.shakePower = 0;
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

    follow(tx, ty, dt) {
        const cx = this.x + this.viewW / 2;
        const cy = this.y + this.viewH / 2;
        const dx = tx - cx, dy = ty - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > this.deadzone) {
            const pull = (dist - this.deadzone) / dist;
            const k = Math.min(1, this.lerp * dt);
            this.x += dx * pull * k;
            this.y += dy * pull * k;
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

    shake(power = 4, time = 0.25) {
        this.shakePower = Math.max(this.shakePower, power);
        this.shakeTime = Math.max(this.shakeTime, time);
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
