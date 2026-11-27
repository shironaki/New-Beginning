/** Non-harvestable backdrop lives on already impassable terrain, never in
 * the resource list. Its own RNG must not reroll loot or block a doorway. */
import { RNG } from "../core/rng.js";
import { T } from "./tiles.js";
export function woodedEdge(biome) {
    return ["ashfall", "forest", "meadow", "road", "ruins", "sacred", "swamp"].includes(biome);
}
export function edgeScenery(zone, seed) {
    if (zone.def.underground || zone.def.biome === "shore") return [];
    const rng = new RNG(seed ^ 0x45d9f3b), objects = [];
    const forest = woodedEdge(zone.def.biome), burnt = ["ashfall", "ruins"].includes(zone.def.biome);
    const { map } = zone;
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
        if (Math.min(tx, ty, map.w - 1 - tx, map.h - 1 - ty) > 8) continue;
        if (map.get(tx, ty) !== T.CLIFF || rng.next() > (forest ? 0.67 : 0.22)) continue;
        const x = tx * 32 + rng.range(8, 24), y = ty * 32 + rng.range(8, 24);
        if (zone.terrain.sample(x, y).cliff < 0.94) continue;
        // Canopies must not conceal the link corridor or its approach.
        if (zone.portals.some((p) => x > p.x - 40 && x < p.x + p.w + 40 && y > p.y - 24 && y < p.y + p.h + 100)) continue;
        const kind = !forest ? "rock" : burnt && rng.next() < 0.56 ? "burnt_tree"
            : zone.def.biome === "swamp" ? "willow" : rng.next() < 0.65 ? "pine" : "oak";
        objects.push({ kind, x, y, tx, ty, size: !forest ? rng.range(1.5, 2.8) : rng.range(0.8, 1.45),
            variant: rng.int(0, 2), scenery: true, solid: false });
    }
    return objects;
}
