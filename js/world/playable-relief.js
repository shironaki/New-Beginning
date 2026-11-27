/** Broad, walkable home hills, not a terrace with a hidden collision fence.
 * No new tiles, props, resource identities or save state. All four approaches
 * use the same continuous height for ground, feet, shade, camera and tracks. */
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { const t = clamp(v); return t * t * (3 - 2 * t); };
export class PlayableRelief {
    constructor(zone) {
        this.step = 16; this.maxHeight = 96;
        this.cols = Math.ceil(zone.map.widthPx / this.step) + 1;
        this.rows = Math.ceil(zone.map.heightPx / this.step) + 1;
        this.heights = new Float32Array(this.cols * this.rows);
        const field = zone.terrain;
        const hearth = zone.objects.find((o) => o.kind === "hearth_ruin") || zone.spawn;
        this.landmark = { x: hearth.x, y: hearth.y };
        for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
            const wx = x * this.step, wy = y * this.step;
            const sample = field.sample(wx, wy);
            const coast = Math.max(0, -(sample.coast ?? -200));
            const edge = smooth(Math.min(wx, wy, zone.map.widthPx - wx, zone.map.heightPx - wy) / 144);
            const bendX = (field.noise(wx, wy, 180, 6341) - .5) * 46;
            const bendY = (field.noise(wx, wy, 170, 6347) - .5) * 38;
            const distance = Math.hypot((wx - hearth.x + bendX) / 440, (wy - hearth.y + 20 + bendY) / 380);
            const hill = smooth(1 - distance);
            const rolling = field.noise(wx, wy, 320, 6321) * 10;
            // Water stays level, with a bank broad enough not to fold projection.
            const height = sample.water >= .5 ? 0 : Math.min(rolling + hill * 84, coast * .24);
            this.heights[y * this.cols + x] = height * edge;
        }
        // Bound both derivatives, including coast/build-floor discontinuities.
        // Four directional sweeps are a conservative Lipschitz envelope.
        const limit = this.step * .38;
        for (let pass = 0; pass < 2; pass++) {
            for (let i = 0; i < this.heights.length; i++) {
                if (i % this.cols) this.heights[i] = Math.min(this.heights[i], this.heights[i - 1] + limit);
                if (i >= this.cols) this.heights[i] = Math.min(this.heights[i], this.heights[i - this.cols] + limit);
            }
            for (let i = this.heights.length - 1; i >= 0; i--) {
                if (i % this.cols < this.cols - 1 && i + 1 < this.heights.length) this.heights[i] = Math.min(this.heights[i], this.heights[i + 1] + limit);
                if (i + this.cols < this.heights.length) this.heights[i] = Math.min(this.heights[i], this.heights[i + this.cols] + limit);
            }
        }
    }
    baseHeightAt(x, y) {
        const gx = Math.max(0, Math.min(this.cols - 1.00001, x / this.step));
        const gy = Math.max(0, Math.min(this.rows - 1.00001, y / this.step));
        const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, i = iy * this.cols;
        const a = this.heights[i + ix] * (1 - fx) + this.heights[i + ix + 1] * fx;
        const b = this.heights[i + this.cols + ix] * (1 - fx) + this.heights[i + this.cols + ix + 1] * fx;
        return a * (1 - fy) + b * fy;
    }
    heightAt(x, y) { return this.baseHeightAt(x, y); }
    // Height is not a collision mask. Rocks, trees and water keep their own
    // ordinary collisions; the hill itself must never fence the player in.
    canStand(x, y) { return Number.isFinite(x) && Number.isFinite(y); }
    unprojectY(x,base) {
        // |dh/dy| <= .38: a single visible root, with no cliff ambiguity.
        let y = base;
        for (let i = 0; i < 32; i++) y = base + this.heightAt(x, y);
        return y;
    }
    canReach(a, b, radius = 80) { return Math.hypot(a.x - b.x, a.y - b.y) <= radius; }
}
export function installPlayableRelief(zone) {
    if (zone.id !== "ashfall") return;
    zone.playableRelief = new PlayableRelief(zone);
    zone.terrain.projected = true;
    zone.terrain.shadeElevation = (x,y) => zone.playableRelief.baseHeightAt(x,y);
    zone.terrain.elevation = (x, y) => zone.playableRelief.heightAt(x, y);
}
