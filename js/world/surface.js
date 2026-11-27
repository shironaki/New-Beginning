/** Shared weather surfaces: moisture, pool contours and winter traction. */
import { ATTACH } from "../render/charspec.js";
import { T, tileInfo } from "./tiles.js";

export const SURFACE = {
    soakMinutes: 45,
    dryMinutes: 240,
    puddleAt: 0.22,
    wetBootsAt: 0.4
};

export const ICE = {
    speed: 0.9, tauMove: 0.28, tauTurn: 0.42, tauStop: 0.85, tauFallen: 0.72, tauFallenDry: 0.24, edgeMemory: 0.32,
    checkDistance: 8, chanceRun: 0.25, chanceTurn: 0.45,
    fallTime: ATTACH.fallTime, cooldown: 5, staminaCost: 8
};

export function clampWet(value) {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Integrated in game minutes (including sleep), not in render frames. */
export function advanceWet(wet, minutes, weather, season = "spring") {
    wet = clampWet(wet);
    if (!Number.isFinite(minutes) || minutes <= 0) return wet;
    const rain = weather === "storm" ? 1.6 : weather === "rain" ? 1 : 0;
    const dry = season === "winter" ? 0 : weather === "wind" ? 1.7
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
    const broad = hash(tx, ty, 887) < 0.3;
    return {
        x: tx * 32 + x,
        y: ty * 32 + y,
        rx: (broad ? 20 + hash(tx, ty, 317) * 10 : Math.min(6 + hash(tx, ty, 317) * 8, x - 2, 30 - x)) * growth,
        ry: (broad ? 11 + hash(tx, ty, 419) * 7 : Math.min(3 + hash(tx, ty, 419) * 3, y - 1, 31 - y)) * growth,
        phase: hash(tx, ty, 521), amount
    };
}

/** The same irregular contour used by the painter and foot contact. */
export function puddleRadius(angle, phase) {
    return 0.85 + Math.sin(angle * 3 + phase * 9) * 0.1 + Math.cos(angle * 5 + phase * 4) * 0.05;
}

export function puddleContains(p, x, y) {
    if (!p || p.rx <= 0 || p.ry <= 0) return false;
    const dx = (x - p.x) / p.rx, dy = (y - p.y) / p.ry;
    return Math.hypot(dx, dy) <= puddleRadius(Math.atan2(dy, dx), p.phase);
}

/** Only small rain pools freeze here. The sea is NOT made walkable. */
export function frozenPuddleAt(zone, x, y, season, wet, temperature = -1) {
    if (season !== "winter" || temperature > 0 || zone.def?.underground) return false;
    return !!rainPoolAt(zone, x, y, wet);
}

export function rainPoolAt(zone, x, y, wet) {
    const tx = Math.floor(x / 32), ty = Math.floor(y / 32);
    if (!receivesRain(zone.map.at(x, y))) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const p = surfacePuddle(zone, tx + dx, ty + dy, wet);
        if (puddleContains(p, x, y)) return p;
    }
    return false;
}

/** Pool placement and roof exclusion shared by drawing and physics. */
export function surfacePuddle(zone, tx, ty, wet) {
    const p = rainPuddle(tx, ty, zone.map.get(tx, ty), wet);
    if (!p || !receivesRain(zone.map.at(p.x, p.y))) return null;
    // Keep the entire pool inside the natural bank, not only its centre.
    for (const dx of [-p.rx, 0, p.rx]) for (const dy of [-p.ry, 0, p.ry]) {
        if (!receivesRain(zone.map.at(p.x + dx, p.y + dy))) return null;
        if (zone.relief && Math.abs(zone.relief.heightAt(p.x + dx, p.y + dy) - zone.relief.heightAt(p.x, p.y)) > 10) return null;
    }
    if (zone.objects?.some((o) => !o.removed && o.kind === "tent" && Math.abs(o.x - p.x) < 28 + p.rx && Math.abs(o.y - p.y) < 18 + p.ry)) return null;
    return p;
}
