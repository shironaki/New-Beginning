/**
 * survival — cooking rules.
 *
 * Design rule from the owner: **no recipe catalogue**. You do not pick "fish
 * soup" from a list — you put things on the fire and find out. Everything here
 * resolves by item *tags*, so new ingredients automatically work with existing
 * cooking methods, and the player's "Поварская тетрадь" fills up by discovery.
 */
import { ITEMS, itemDef, hasTag } from "../sandbox/items.js";

/** Direct-heat methods: what the fire does to a raw ingredient. */
export const SPIT_RULES = [
    { tag: "meat",     out: "meat_roast",     time: 600 },
    { tag: "fish",     out: "fish_grill",     time: 450 },
    { tag: "mushroom", out: "mushroom_roast", time: 300 },
    { tag: "egg",      out: "egg_baked",      time: 350 },
    { tag: "root",     out: "root_baked",     time: 500 },
    { tag: "grain",    out: "flatbread",      time: 400 }
];

/**
 * Pot dishes: combinations of 2–3 ingredients, matched by tags.
 * `need` is a list of tag requirements; the most specific match wins, so
 * meat+root beats the generic vegetable soup.
 */
export const POT_RECIPES = [
    { id: "stew_meat", need: ["meat", "root"],            water: true, time: 1500, name: "Сытное рагу" },
    { id: "fish_soup", need: ["fish", "root"],            water: true, time: 1400, name: "Уха" },
    { id: "fish_soup", need: ["fish", "herb"],            water: true, time: 1300, name: "Уха" },
    { id: "porridge",  need: ["grain", "grain"],          water: true, time: 1200, name: "Каша" },
    { id: "porridge",  need: ["grain", "berry"],          water: true, time: 1200, name: "Каша" },
    { id: "berry_jam", need: ["berry", "berry"],          water: false, time: 1100, name: "Ягодное варенье" },
    { id: "herb_tea",  need: ["herb"],                    water: true, time: 700,  name: "Травяной отвар" },
    { id: "veg_soup",  need: ["root", "mushroom"],        water: true, time: 1200, name: "Похлёбка" },
    { id: "veg_soup",  need: ["root", "root"],            water: true, time: 1100, name: "Похлёбка" },
    { id: "veg_soup",  need: ["mushroom", "mushroom"],    water: true, time: 1100, name: "Похлёбка" }
];

/** Can this item be cooked over direct heat? Returns { out, time } or null. */
export function resolveSpit(itemId) {
    const def = itemDef(itemId);
    if (!def) return null;
    if (def.tags.includes("cooked") || def.tags.includes("burnt")) return null;
    for (const rule of SPIT_RULES) {
        if (def.tags.includes(rule.tag)) return { out: rule.out, time: rule.time };
    }
    return null;
}

/** True if the fire would just destroy this (wood on a spit, a knife, …). */
export function isCookable(itemId) { return resolveSpit(itemId) !== null; }

/**
 * Match a set of pot ingredients against the recipe table.
 * Returns { id, time, name, recipe } or null when the combination makes nothing.
 */
export function resolvePot(itemIds, hasWater = true) {
    const ids = itemIds.filter(Boolean);
    if (!ids.length) return null;
    let best = null, bestScore = -1;
    for (const r of POT_RECIPES) {
        if (r.water && !hasWater) continue;
        const pool = ids.slice();
        let ok = true;
        for (const tag of r.need) {
            const idx = pool.findIndex((id) => hasTag(id, tag));
            if (idx === -1) { ok = false; break; }
            pool.splice(idx, 1);
        }
        if (!ok) continue;
        // Prefer recipes that use more of what is actually in the pot.
        const score = r.need.length * 10 - pool.length;
        if (score > bestScore) { bestScore = score; best = r; }
    }
    if (!best) return null;
    return { id: best.id, time: best.time, name: best.name || (ITEMS[best.id] && ITEMS[best.id].name), recipe: best };
}

/** Player's discovered-dish notebook: filled by doing, never pre-populated. */
export class CookingJournal {
    constructor({ bus = null } = {}) {
        this.discovered = new Set();
        this.bus = bus;
    }

    discover(dishId) {
        if (!dishId || this.discovered.has(dishId)) return false;
        this.discovered.add(dishId);
        if (this.bus) {
            const d = itemDef(dishId);
            this.bus.emit("cook:discovered", { id: dishId, name: d ? d.name : dishId, emoji: d ? d.emoji : "🍲" });
        }
        return true;
    }

    knows(dishId) { return this.discovered.has(dishId); }
    get count() { return this.discovered.size; }
    list() { return Array.from(this.discovered); }

    toJSON() { return Array.from(this.discovered); }
    load(arr) { this.discovered = new Set(arr || []); return this; }
}
