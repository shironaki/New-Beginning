/** Seasonal water state, independent of resource generation and raw tile IDs.
 * Marine water is flood-filled from the shore map boundary. Inland lakes
 * freeze more readily; sea ice remains thin/non-load-bearing over DEEP. */
import { TILE_SIZE, tileInfo, T } from "./tiles.js";
import { ambientTemperature } from "../survival/temperature.js";
import { biomeDef } from "./regions.js";
const clamp = (n) => Math.max(0, Math.min(1, n));
export function marineMask(map, shore = false) {
    const mask = new Uint8Array(map.w * map.h), queue = [];
    if (!shore) return mask;
    const visit = (x, y) => {
        if (!map.inBounds(x, y)) return;
        const i = y * map.w + x;
        if (mask[i] || !tileInfo(map.get(x, y)).liquid) return;
        mask[i] = 1; queue.push(i);
    };
    for (let x = 0; x < map.w; x++) { visit(x, 0); visit(x, map.h - 1); }
    for (let y = 0; y < map.h; y++) { visit(0, y); visit(map.w - 1, y); }
    for (let n = 0; n < queue.length; n++) {
        const i = queue[n], x = i % map.w, y = Math.floor(i / map.w);
        visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
    }
    return mask;
}
export function syncWaterState(zone, clock, weather) {
    const map = zone.map, revision = map.revision || 0;
    let state = map.waterState;
    if (!state || state.revision !== revision) {
        state = map.waterState = { revision, marine: marineMask(map, zone.def.biome === "shore"), key: null };
    }
    const season = clock?.season?.key || "spring";
    const temp = ambientTemperature({ season, daylight: clock?.daylight ?? 1,
        weather, biomeTemp: biomeDef(zone.def.biome).temp || 0, underground: !!zone.def.underground });
    // A bounded seasonal model, not simulated ice thickness/history. Quantise
    // appearance so minute ticks do not rebake every chunk unnecessarily.
    state.temperature = temp;
    const cold = season === "winter" && !zone.def.underground;
    const fresh = cold ? Math.round(clamp((3 - temp) / 7) * 8) / 8 : 0;
    const sea = cold ? Math.round(clamp((-1 - temp) / 14) * 8) / 8 : 0;
    const key = `${revision}:${fresh}:${sea}`;
    if (key !== state.key) { state.fresh = fresh; state.sea = sea; state.key = key; map.markAllDirty(); }
    return state;
}
export function waterIce(map, x, y, id = map.at(x, y)) {
    const state = map.waterState;
    if (!state || !tileInfo(id).liquid) return { cover: 0, walkable: false, marine: false, broken: false, blocked: id === T.DEEP };
    const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
    let marine = false;
    // Natural bank reconstruction can place water inside a raw land cell.
    // A marine neighbour takes precedence at this ambiguous shore fringe.
    for (let dy = -1; dy <= 1 && !marine; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && tileInfo(map.get(tx, ty)).liquid) continue;
        if (map.inBounds(tx + dx, ty + dy) && state.marine[(ty + dy) * map.w + tx + dx]) marine = true;
    }
    const amount = marine ? state.sea : state.fresh;
    const wave = 0.5 + 0.25 * Math.sin(x * 0.037 + Math.cos(y * 0.026)) + 0.25 * Math.sin(y * 0.049);
    const cover = marine ? clamp((amount - wave * 0.42) * 1.6) : amount;
    const walkable = !marine && amount >= .75;
    return { cover, marine, walkable, broken: id === T.DEEP && !walkable && cover > 0,
        blocked: id === T.DEEP && !walkable };
}
