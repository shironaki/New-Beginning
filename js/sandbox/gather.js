/**
 * sandbox — world props and how you harvest them.
 *
 * One table describes every interactable object in the valley: what tool it
 * needs, how long it takes, what it drops and whether it grows back. The
 * strict tool rule from v2 stays — you cannot fell a pine with your fists —
 * but bare-hand foraging (berries, herbs, firewood) always works, so the
 * prologue is playable with nothing in your pockets.
 */

/**
 * `block` is the radius of the prop's footprint IN PIXELS, measured at the
 * base — the trunk, not the canopy. TILE_SIZE is 32 and the player's radius is
 * 9, so two blockers in neighbouring tiles leave a walkable gap only while
 * `block * 2 + 9 < 32`, i.e. roughly block <= 7 for ordinary scenery. Anything
 * larger is a wall by design (ruin_wall, tent, hearth_ruin).
 * Raising these numbers brings back invisible walls — measure before you do.
 */
export const PROPS = {
    /* ---- trees -------------------------------------------------------- */
    pine:        { name: "Сосна",        tool: "axe", hits: 4, drops: [["log", 2], ["resin", 1, 0.4]], solid: true, regrow: 0, xp: 4, shade: true, block: 4.8 },
    spruce:      { name: "Ель",          tool: "axe", hits: 4, drops: [["log", 2], ["resin", 1, 0.3]], solid: true, xp: 4, shade: true, block: 4.8 },
    oak:         { name: "Дуб",          tool: "axe", hits: 5, drops: [["log", 3], ["firewood", 2]], solid: true, xp: 5, shade: true, block: 5.4 },
    ancient_oak: { name: "Древний дуб",  tool: "axe", hits: 9, drops: [["log", 6], ["resin", 2]], solid: true, xp: 14, shade: true, sacred: true, block: 7.5 },
    birch:       { name: "Берёза",       tool: "axe", hits: 3, drops: [["log", 2], ["fiber", 1, 0.5]], solid: true, xp: 3, shade: true, block: 4.2 },
    willow:      { name: "Ива",          tool: "axe", hits: 3, drops: [["log", 1], ["fiber", 2]], solid: true, xp: 3, shade: true, block: 4.8 },
    palm:        { name: "Пальма",       tool: "axe", hits: 3, drops: [["log", 1], ["fiber", 2]], solid: true, xp: 3, shade: true, block: 4.2 },
    dead_tree:   { name: "Сухое дерево", tool: "axe", hits: 2, drops: [["firewood", 3], ["log", 1, 0.5]], solid: true, xp: 2, block: 4.2 },
    burnt_tree:  { name: "Обгоревшее дерево", tool: "axe", hits: 2, drops: [["charcoal", 2], ["firewood", 2]], solid: true, xp: 2, block: 4.6 },
    burnt_stump: { name: "Обугленный пень", tool: null, hits: 2, drops: [["charcoal", 1], ["ash_dust", 1]], solid: false, xp: 1, block: 3.6 },
    driftwood:   { name: "Плавник",      tool: null, hits: 1, drops: [["firewood", 2]], solid: false, xp: 1, block: 0 },

    /* ---- stone & ore --------------------------------------------------- */
    rock:        { name: "Камень",       tool: "pick", hits: 3, drops: [["stone", 2], ["flint", 1, 0.3]], solid: true, xp: 3, block: 6.5 },
    ore_rock:    { name: "Рудная жила",  tool: "pick", hits: 5, drops: [["stone", 1]], solid: true, xp: 7, oreDrop: true, block: 6.5 },
    ruin_wall:   { name: "Обломок стены",tool: "pick", hits: 4, drops: [["stone", 3]], solid: true, xp: 3, block: 9 },

    /* ---- forage (no tool needed) --------------------------------------- */
    bush:        { name: "Куст",         tool: null, hits: 1, drops: [["fiber", 1]], berriesDrop: [["berry", 2]], solid: false, regrow: 2, xp: 1, block: 0 },
    herb:        { name: "Травы",        tool: null, hits: 1, drops: [], herbDrop: true, solid: false, regrow: 3, xp: 2, block: 0 },
    firewood:    { name: "Хворост",      tool: null, hits: 1, drops: [["firewood", 2]], solid: false, xp: 1, instant: true, block: 0 },
    reed:        { name: "Камыш",        tool: null, hits: 1, drops: [["fiber", 2]], solid: false, regrow: 2, xp: 1, block: 0 },
    grass_tuft:  { name: "Пучок травы",  tool: null, hits: 1, drops: [["hay", 1], ["fiber", 1, 0.4]], solid: false, regrow: 2, xp: 1, block: 0 },
    flower:      { name: "Цветок",       tool: null, hits: 1, drops: [["fiber", 1]], solid: false, regrow: 3, xp: 1, block: 0 },
    mushroom_patch: { name: "Грибница",  tool: null, hits: 1, drops: [["mushroom", 2]], solid: false, regrow: 3, xp: 2, block: 0 },

    /* ---- story / camp objects (interact, never harvest) ---------------- */
    tent:        { name: "Палатка",      interact: "sleep", solid: true, block: 11 },
    campfire:    { name: "Костёр",       interact: "fire",  solid: false, block: 6.5 },
    hearth_ruin: { name: "Обгоревшая печь", interact: "story", solid: true, block: 9.5 },
    burnt_beam:  { name: "Обгоревшая балка", tool: "axe", hits: 2, drops: [["charcoal", 1], ["firewood", 1]], solid: true, xp: 1, block: 6.5 },
    diary:       { name: "Обгоревший дневник", interact: "read", solid: false, story: true, block: 0 },
    chest_old:   { name: "Старый сундук", interact: "loot", solid: true, block: 6 }
};

export function propDef(kind) { return PROPS[kind] || null; }

/** Does this prop yield resources at all? */
export function isHarvestable(kind) {
    const d = propDef(kind);
    return !!d && Array.isArray(d.drops);
}

/** Tool required ("axe" | "pick" | null for bare hands). */
export function requiredTool(kind) {
    const d = propDef(kind);
    return d ? (d.tool || null) : null;
}

/**
 * Roll the loot for one harvested prop.
 * @param {object} obj world object (may carry `ore`, `berries`, `herbType`, `amount`)
 * @param {RNG} rng
 * @returns {Array<{id:string,n:number}>}
 */
export function rollDrops(obj, rng) {
    const d = propDef(obj.kind);
    if (!d) return [];
    const out = [];
    const push = (id, n) => { if (n > 0) out.push({ id, n }); };

    for (const entry of d.drops || []) {
        const [id, n, chance] = entry;
        if (chance !== undefined && !rng.chance(chance)) continue;
        const bonus = obj.amount ? Math.max(0, obj.amount - 1) : 0;
        push(id, n + (id === "firewood" ? bonus : 0));
    }
    if (d.oreDrop && obj.ore) push(obj.ore, rng.int(1, 3));
    if (d.berriesDrop && obj.berries) for (const [id, n] of d.berriesDrop) push(id, n);
    if (d.herbDrop) {
        const map = { mint: "herb_mint", sage: "herb_sage", yarrow: "herb_yarrow" };
        push(map[obj.herbType] || "herb_mint", rng.int(1, 2));
        if (rng.chance(0.25)) push("mushroom", 1);
    }
    return out;
}

/** Human-readable reason when the player lacks the tool. */
export function toolHint(kind) {
    const tool = requiredTool(kind);
    if (!tool) return null;
    const names = { axe: "🪓 топор", pick: "⛏️ кирка", knife: "🔪 нож", hoe: "🌾 мотыга", rod: "🎣 удочка" };
    return `Нужен ${names[tool] || tool}`;
}
