/** First production rollout: the home ruin stands on a low, walkable shelf.
 * No RNG, tile/prop edits or new save identities. Other zones remain unchanged.
 * Height is a cached continuous field, shared by feet, ground, picking and slope.
 * This pass deliberately has no overhangs or sheer/folded faces. */
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { const t = clamp(v); return t * t * (3 - 2 * t); };
export class PlayableRelief {
    constructor(zone) {
        this.step = 16; this.maxHeight = 56;
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
            const distance = Math.hypot((wx - hearth.x + bendX) / 330, (wy - hearth.y + 20 + bendY) / 250);
            const shelf = smooth((1 - distance) / .52);
            const rolling = field.noise(wx, wy, 320, 6321) * 10;
            // Water stays level, with a bank broad enough not to fold projection.
            const height = sample.water >= .5 ? 0 : Math.min(rolling + shelf * 44, coast * .24);
            this.heights[y * this.cols + x] = height * edge;
        }
        // Bound both derivatives, including coast/build-floor discontinuities.
        // Four directional sweeps are a conservative Lipschitz envelope.
        const limit = this.step * .48;
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
    heightAt(x, y) {
        const gx = Math.max(0, Math.min(this.cols - 1.00001, x / this.step));
        const gy = Math.max(0, Math.min(this.rows - 1.00001, y / this.step));
        const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, i = iy * this.cols;
        const a = this.heights[i + ix] * (1 - fx) + this.heights[i + ix + 1] * fx;
        const b = this.heights[i + this.cols + ix] * (1 - fx) + this.heights[i + this.cols + ix + 1] * fx;
        return a * (1 - fy) + b * fy;
    }
    canReach(a, b) { return Math.abs(this.heightAt(a.x, a.y) - this.heightAt(b.x, b.y)) <= 12; }
}
export function installPlayableRelief(zone) {
    if (zone.id !== "ashfall") return;
    zone.playableRelief = new PlayableRelief(zone);
    zone.terrain.projected = true;
    zone.terrain.elevation = (x, y) => zone.playableRelief.heightAt(x, y);
}
