/** Isolated elevation prototype. Not installed in generated/saved game zones.
 * The same height function drives projection, slope and body contact. */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (v) => v * v * (3 - 2 * v);
export const RELIEF = {
    width: 640, height: 440, platform: 44, radius: 8, maxStep: 10,
    ramp: { left: 368, right: 448, top: 280, bottom: 392 },
    terrace: { left: 224, right: 560, top: 88, bottom: 280 },
    step: 1 / 120, scaleY: 0.82
};
export const RELIEF_PROPS = [
    { kind: "pine", x: 280, y: 158, tx: 8, ty: 5, size: 0.92, block: 4.8 },
    { kind: "rock", x: 515, y: 226, tx: 16, ty: 7, block: 6.5 },
    { kind: "firewood", x: 464, y: 250, tx: 14, ty: 8, pickup: true, block: 0 },
    { kind: "bush", x: 108, y: 210, tx: 3, ty: 6, size: 1, block: 0 }
];
export class ReliefPatch {
    heightAt(x, y) {
        const p = RELIEF.terrace, r = RELIEF.ramp;
        if (x >= p.left && x <= p.right && y >= p.top && y <= p.bottom) return RELIEF.platform;
        if (x >= r.left && x <= r.right && y > r.top && y < r.bottom)
            return RELIEF.platform * smooth((r.bottom - y) / (r.bottom - r.top));
        // A smooth, walkable hill distinct from the terrace's sheer escarpment.
        const d = ((x - 123) / 87) ** 2 + ((y - 230) / 100) ** 2;
        return d < 1 ? 25 * (1 - d) ** 2 : 0;
    }
    project(x, y) { return { x, y: y * RELIEF.scaleY - this.heightAt(x, y) }; }
    canStand(x, y, fromX = x, fromY = y) {
        const r = RELIEF.radius;
        if (x < r || y < r || x > RELIEF.width - r || y > RELIEF.height - r) return false;
        const z = this.heightAt(x, y);
        for (const o of RELIEF_PROPS) {
            if (o.block && Math.abs(z - this.heightAt(o.x, o.y)) < RELIEF.maxStep
                && Math.hypot(x - o.x, y - o.y) < r + o.block) return false;
        }
        if (Math.abs(z - this.heightAt(fromX, fromY)) > RELIEF.maxStep) return false;
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4;
            if (Math.abs(this.heightAt(x + Math.cos(a) * r, y + Math.sin(a) * r) - z) > RELIEF.maxStep) return false;
        }
        return true;
    }
    canReach(a, b, radius = 30) {
        return Math.hypot(a.x - b.x, a.y - b.y) <= radius
            && Math.abs(this.heightAt(a.x, a.y) - this.heightAt(b.x, b.y)) <= RELIEF.maxStep;
    }
}
export class ReliefWalker {
    constructor(patch = new ReliefPatch()) {
        this.patch = patch; this.x = 408; this.y = 410; this.dir = "up";
        this.phase = 0; this.gait = 0; this.time = 0; this.accumulator = 0; this.blocked = false;
    }
    reset(top = false) { this.x = top ? 480 : 408; this.y = top ? 180 : 410; this.accumulator = 0; this.gait = 0; return this; }
    update(dt, input) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        this.accumulator += Math.min(0.2, dt);
        while (this.accumulator >= RELIEF.step - 1e-10) {
            this.accumulator = Math.max(0, this.accumulator - RELIEF.step);
            const mag = Math.hypot(input.x, input.y), dx = mag ? input.x / mag : 0, dy = mag ? input.y / mag : 0;
            this.time += RELIEF.step; this.blocked = false;
            if (mag) this.dir = Math.abs(dx) > Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up";
            const rise = (this.patch.heightAt(this.x + dx * 4, this.y + dy * 4) - this.patch.heightAt(this.x, this.y)) / 4;
            const speed = 68 * clamp(1 - Math.max(0, rise) * 0.6, 0.55, 1);
            const x = this.x, y = this.y, mx = dx * speed * RELIEF.step, my = dy * speed * RELIEF.step;
            if (this.patch.canStand(x + mx, y + my, x, y)) { this.x += mx; this.y += my; }
            else {
                this.blocked = !!mag;
                if (this.patch.canStand(x + mx, y, x, y)) this.x += mx;
                if (this.patch.canStand(this.x, y + my, this.x, y)) this.y += my;
            }
            const distance = Math.hypot(this.x - x, this.y - y);
            this.phase = (this.phase + distance * Math.PI * 2 / 30) % (Math.PI * 2);
            this.gait += ((distance > 0.01 ? 1 : 0) - this.gait) * 0.1;
        }
    }
}
