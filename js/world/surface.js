/** Surface weather: cosmetic ground state, never changes the terrain/collisions. */
import { T, tileInfo } from "./tiles.js";

export const SURFACE = {
    soakMinutes: 45,
    dryMinutes: 240,
    puddleAt: 0.22,
    wetBootsAt: 0.4
};

export function clampWet(value) {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Integrated in game minutes (including sleep), not in render frames. */
export function advanceWet(wet, minutes, weather, season = "spring") {
    wet = clampWet(wet);
    if (!Number.isFinite(minutes) || minutes <= 0) return wet;
    const rain = weather === "storm" ? 1.6 : weather === "rain" ? 1 : 0;
    const dry = season === "winter" ? 0.3 : weather === "wind" ? 1.7
        : weather === "clear" ? 1.2 : 0.65;
    return clampWet(wet + minutes * (rain ? rain / SURFACE.soakMinutes : -dry / SURFACE.dryMinutes));
}

export function receivesSnow(id) {
    const info = tileInfo(id);
    return id !== T.VOID && !info.liquid && !info.solid;
}

export function receivesRain(id) {
    return receivesSnow(id) && id !== T.PLANK;
}

/** Footprint material agrees with the seasonal artwork, without editing the map. */
export function surfaceTile(id, season, wet = 0, underground = false) {
    if (underground || !receivesSnow(id)) return id;
    if (season === "winter") return wet > 0.55 ? T.MUD : T.SNOW;
    if (wet > SURFACE.wetBootsAt && [T.DIRT, T.PATH, T.ASH, T.SOOT, T.FARM, T.FARM_WET].includes(id)) return T.MUD;
    return id;
}

/** Stable world-space puddle placement. No random calls in the frame loop. */
function hash(x, y, salt) {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ salt;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function rainPuddle(tx, ty, id, wet) {
    if (!receivesRain(id) || wet <= SURFACE.puddleAt || hash(tx, ty, 913) > 0.20) return null;
    const amount = (clampWet(wet) - SURFACE.puddleAt) / (1 - SURFACE.puddleAt);
    const growth = Math.sqrt(amount);
    const x = 7 + hash(tx, ty, 127) * 18;
    const y = 7 + hash(tx, ty, 233) * 18;
    return {
        x: tx * 32 + x,
        y: ty * 32 + y,
        rx: Math.min(6 + hash(tx, ty, 317) * 8, x - 2, 30 - x) * growth,
        ry: Math.min(3 + hash(tx, ty, 419) * 3, y - 1, 31 - y) * growth,
        phase: hash(tx, ty, 521), amount
    };
}
