/** Signed distance to the FINAL coastline, including the sealed map edge.
 * Chamfer distance (8 neighbours) is linear-time, deterministic and cheap to
 * rebuild after edits. Positive is water, negative is land; units are pixels.
 */
import { tileInfo } from "./tiles.js";
const DIAGONAL = Math.SQRT2;
function distance(map, toWater) {
    const { w, h, data } = map, a = new Float32Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = !!tileInfo(data[i]).liquid === toWater ? 0 : w + h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x) a[i] = Math.min(a[i], a[i - 1] + 1);
        if (y) {
            a[i] = Math.min(a[i], a[i - w] + 1);
            if (x) a[i] = Math.min(a[i], a[i - w - 1] + DIAGONAL);
            if (x + 1 < w) a[i] = Math.min(a[i], a[i - w + 1] + DIAGONAL);
        }
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (x + 1 < w) a[i] = Math.min(a[i], a[i + 1] + 1);
        if (y + 1 < h) {
            a[i] = Math.min(a[i], a[i + w] + 1);
            if (x) a[i] = Math.min(a[i], a[i + w - 1] + DIAGONAL);
            if (x + 1 < w) a[i] = Math.min(a[i], a[i + w + 1] + DIAGONAL);
        }
    }
    return a;
}
export function coastDistances(map) {
    const land = distance(map, false), water = distance(map, true);
    return Float32Array.from(land, (d, i) => (tileInfo(map.data[i]).liquid ? d - 0.5 : 0.5 - water[i]) * 32);
}
