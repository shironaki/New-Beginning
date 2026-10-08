/** Seeded terrain is regenerated; only gameplay mutations of props are saved.
 * Matching identity protects saves from silently applying to a different map. */
import { WorldMap } from "./worldgen.js";
import { zoneDef } from "./regions.js";
const KEYS = ["removed", "looted", "hits"];
export function snapshotWorld(world) {
    return [...world.zones.values()].map((z) => ({ id: z.id, props: z.objects.flatMap((o, i) => {
        const state = {};
        for (const k of KEYS) if (k === "hits" ? o[k] !== undefined : o[k] === true) state[k] = o[k];
        return Object.keys(state).length ? [{ i, kind: o.kind, x: o.x, y: o.y, state }] : [];
    }) }));
}
export function restoreWorld(seed, data) {
    if (!Array.isArray(data) || data.length > 12) throw new Error("Некорректный список локаций");
    const world = new WorldMap(seed), seen = new Set();
    for (const entry of data) {
        if (!zoneDef(entry.id) || seen.has(entry.id) || !Array.isArray(entry.props)) throw new Error("Неизвестная локация");
        seen.add(entry.id);
        const zone = world.get(entry.id);
        if (entry.props.length > zone.objects.length) throw new Error("Некорректные предметы мира");
        const indices = new Set();
        for (const p of entry.props) {
            const o = zone.objects[p.i];
            if (!Number.isInteger(p.i) || !o || indices.has(p.i) || o.kind !== p.kind || o.x !== p.x || o.y !== p.y)
                throw new Error("Сохранение не совпадает с генерацией локации");
            indices.add(p.i);
            for (const [k, value] of Object.entries(p.state || {})) {
                if (!KEYS.includes(k) || (k === "hits" ? !Number.isFinite(value) : typeof value !== "boolean"))
                    throw new Error("Некорректное состояние предмета");
                o[k] = value;
            }
            if (o.removed) zone.removeSolid(o);
        }
    }
    return world;
}
