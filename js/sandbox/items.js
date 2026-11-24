/**
 * sandbox — item catalogue (data, not logic).
 *
 * Items are described by **tags**, not by hard-coded recipe ids. A campfire
 * does not know what "rabbit leg" is; it knows the item is tagged `meat` and
 * `raw`, so it can be roasted. That is what lets cooking be combinatorial
 * instead of a list of 40 hand-written recipes.
 */

// `hold` и `tint` — как предмет выглядит в РУКЕ. Рендер не знает сорока id: он
// знает девять форм (камень, кристалл, связка, моток, доска, скатка, кусок,
// бурдюк, безделушка) и цвет. Без этих полей всё в ладони превращалось в
// «палку с шишкой», и добычу нельзя было опознать — а рука это единственное
// место, где игрок видит, что именно он несёт.
export const ITEMS = {
    /* ---- raw resources ------------------------------------------------ */
    firewood:  { name: "Хворост",      emoji: "🪵", stack: 50, tags: ["fuel"], burn: 2100, weight: 0.4 },
    log:       { name: "Бревно",       emoji: "🪵", stack: 20, tags: ["fuel", "build"], burn: 8100, weight: 3 },
    plank:     { name: "Доска",        emoji: "🪚", stack: 50, tags: ["build"], burn: 3600, weight: 1, hold: "board", tint: "#9a7448"},
    stone:     { name: "Камень",       emoji: "🪨", stack: 50, tags: ["build"], weight: 2, hold: "rock", tint: "#8f8b82"},
    flint:     { name: "Кремень",      emoji: "🔥", stack: 20, tags: ["tool_part", "firestarter"], weight: 0.2, hold: "rock", tint: "#6a6874"},
    fiber:     { name: "Волокно",      emoji: "🌾", stack: 50, tags: ["craft"], weight: 0.1, hold: "sheaf", tint: "#b7a06a"},
    // Верёвка — связующее почти всех каменных орудий: без неё топор просто
    // палка с камнем. Держим её предметом, а не флагом рецепта, чтобы можно
    // было положить в котелок, повесить на стену и потерять в реке.
    rope:      { name: "Верёвка",      emoji: "🪢", stack: 30, tags: ["craft", "bind"], weight: 0.4, hold: "coil", tint: "#a8895a"},
    hay:       { name: "Сено",         emoji: "🌾", stack: 50, tags: ["fuel", "feed"], burn: 420, weight: 0.3, hold: "sheaf", tint: "#c9ab5f"},
    resin:     { name: "Смола",        emoji: "🟤", stack: 20, tags: ["craft", "fuel"], burn: 2600, weight: 0.3, hold: "lump", tint: "#b4762c"},
    copper:    { name: "Медная руда",  emoji: "🟠", stack: 30, tags: ["ore"], weight: 2.5, hold: "rock", tint: "#a9713f"},
    iron:      { name: "Железная руда",emoji: "⚙️", stack: 30, tags: ["ore"], weight: 3, hold: "rock", tint: "#8a8f96"},
    coal:      { name: "Уголь",        emoji: "⬛", stack: 40, tags: ["fuel", "ore"], burn: 16200, weight: 1.5, hold: "rock", tint: "#4c4947"},
    gem:       { name: "Самоцвет",     emoji: "💎", stack: 10, tags: ["valuable"], weight: 0.3, hold: "crystal", tint: "#6fd0c4"},
    charcoal:  { name: "Древесный уголь", emoji: "◼️", stack: 40, tags: ["fuel"], burn: 9600, weight: 0.8, hold: "rock", tint: "#57504a"},
    ash_dust:  { name: "Зола",         emoji: "🌫️", stack: 40, tags: ["craft", "fertiliser"], weight: 0.2, hold: "lump", tint: "#c9c6bd"},

    /* ---- raw food ------------------------------------------------------ */
    meat_raw:  { name: "Сырое мясо",   emoji: "🥩", stack: 20, tags: ["food", "raw", "meat", "perishable"], food: 16, weight: 1, hold: "haunch", tint: "#a8514f"},
    fish_raw:  { name: "Сырая рыба",   emoji: "🐟", stack: 20, tags: ["food", "raw", "fish", "perishable"], food: 12, weight: 0.8, hold: "fillet", tint: "#93b6c6"},
    egg:       { name: "Яйцо",         emoji: "🥚", stack: 20, tags: ["food", "raw", "egg"], food: 7, weight: 0.2, hold: "lump", tint: "#e8e2d0"},
    mushroom:  { name: "Гриб",         emoji: "🍄", stack: 30, tags: ["food", "raw", "mushroom", "forage"], food: 5, weight: 0.2, hold: "fungal", tint: "#b2603f"},
    berry:     { name: "Ягоды",        emoji: "🫐", stack: 40, tags: ["food", "berry", "forage", "sweet"], food: 5, weight: 0.1, hold: "lump", tint: "#5b5f8c"},
    root:      { name: "Корнеплод",    emoji: "🥕", stack: 30, tags: ["food", "raw", "root", "forage"], food: 8, weight: 0.3, hold: "root", tint: "#c98a3f"},
    grain:     { name: "Зерно",        emoji: "🌾", stack: 50, tags: ["food", "raw", "grain"], food: 4, weight: 0.3, hold: "sheaf", tint: "#d3bb74"},
    herb_mint: { name: "Мята",         emoji: "🌿", stack: 30, tags: ["herb", "forage", "aromatic"], weight: 0.1, hold: "sheaf", tint: "#6ea25c"},
    herb_sage: { name: "Шалфей",       emoji: "🍃", stack: 30, tags: ["herb", "forage", "medicinal"], weight: 0.1, hold: "sheaf", tint: "#8fae84"},
    herb_yarrow: { name: "Тысячелистник", emoji: "🌼", stack: 30, tags: ["herb", "forage", "medicinal"], weight: 0.1, hold: "sheaf", tint: "#b9c39a"},
    water_skin: { name: "Бурдюк с водой", emoji: "🧴", stack: 1, tags: ["water", "container"], weight: 1, hold: "vessel", tint: "#8a6a4a"},

    /* ---- cooked food (produced by the fire, not bought from a menu) ---- */
    meat_roast: { name: "Жареное мясо", emoji: "🍖", stack: 20, tags: ["food", "cooked", "meat"], food: 34, warmth: 8, weight: 0.9, hold: "haunch", tint: "#8f4f2c"},
    fish_grill: { name: "Печёная рыба", emoji: "🐠", stack: 20, tags: ["food", "cooked", "fish"], food: 26, warmth: 7, weight: 0.7, hold: "fillet", tint: "#b0895c"},
    egg_baked:  { name: "Печёное яйцо", emoji: "🍳", stack: 20, tags: ["food", "cooked", "egg"], food: 15, warmth: 4, weight: 0.2, hold: "lump", tint: "#ded2b6"},
    mushroom_roast: { name: "Жареные грибы", emoji: "🍄", stack: 30, tags: ["food", "cooked", "mushroom"], food: 13, warmth: 4, weight: 0.2, hold: "fungal", tint: "#8f6a4a"},
    root_baked: { name: "Печёный корнеплод", emoji: "🍠", stack: 30, tags: ["food", "cooked", "root"], food: 19, warmth: 6, weight: 0.3, hold: "root", tint: "#a8763f"},
    flatbread:  { name: "Лепёшка",      emoji: "🫓", stack: 20, tags: ["food", "cooked", "grain"], food: 18, warmth: 5, weight: 0.3, hold: "dish", tint: "#c8aa62"},
    food_burnt: { name: "Головёшка",    emoji: "🪨", stack: 20, tags: ["food", "burnt"], food: 2, weight: 0.3, hold: "lump", tint: "#3a332c"},

    /* ---- pot dishes (discovered by combining, see cooking.js) --------- */
    stew_meat:  { name: "Сытное рагу",  emoji: "🍲", stack: 10, tags: ["food", "cooked", "dish"], food: 48, warmth: 18, spirit: 6, weight: 1, hold: "dish", tint: "#a4643a"},
    fish_soup:  { name: "Уха",          emoji: "🥣", stack: 10, tags: ["food", "cooked", "dish"], food: 40, warmth: 20, spirit: 5, weight: 1, hold: "dish", tint: "#c3b083"},
    veg_soup:   { name: "Похлёбка",     emoji: "🍜", stack: 10, tags: ["food", "cooked", "dish"], food: 30, warmth: 16, spirit: 3, weight: 1, hold: "dish", tint: "#9fa86a"},
    herb_tea:   { name: "Травяной отвар", emoji: "🍵", stack: 10, tags: ["drink", "cooked", "medicine"], food: 6, warmth: 22, heal: 12, spirit: 8, weight: 0.5, hold: "jar", tint: "#7f9a63"},
    berry_jam:  { name: "Ягодное варенье", emoji: "🍯", stack: 10, tags: ["food", "cooked", "sweet"], food: 22, spirit: 10, weight: 0.6, hold: "jar", tint: "#a34a3c"},
    porridge:   { name: "Каша",         emoji: "🥣", stack: 10, tags: ["food", "cooked", "dish"], food: 34, warmth: 14, weight: 0.8, hold: "dish", tint: "#cbb98c"},

    /* ---- tools & gear -------------------------------------------------- */
    knife:      { name: "Нож",          emoji: "🔪", stack: 1, tags: ["tool", "knife", "weapon"], tool: "knife", tier: 1, dmg: 5, weight: 0.5 },
    axe_stone:  { name: "Каменный топор", emoji: "🪓", stack: 1, tags: ["tool", "axe", "weapon"], tool: "axe", tier: 1, dmg: 7, weight: 2 },
    pick_stone: { name: "Каменная кирка", emoji: "⛏️", stack: 1, tags: ["tool", "pick"], tool: "pick", tier: 1, weight: 2.5 },
    spear:      { name: "Копьё",        emoji: "🔱", stack: 1, tags: ["weapon", "reach"], tool: "spear", tier: 1, dmg: 11, weight: 1.8 },
    rod:        { name: "Удочка",       emoji: "🎣", stack: 1, tags: ["tool", "rod"], tool: "rod", tier: 1, weight: 1 },
    hoe:        { name: "Мотыга",       emoji: "🧑‍🌾", stack: 1, tags: ["tool", "hoe"], tool: "hoe", tier: 1, weight: 1.6 },
    torch:      { name: "Факел",        emoji: "🔦", stack: 5, tags: ["light", "fuel"], light: 110, burn: 3200, weight: 0.4 },
    bedroll:    { name: "Спальник",     emoji: "🛏️", stack: 1, tags: ["sleep"], weight: 2, hold: "roll", tint: "#7b6a4f"},
    cloak:      { name: "Плащ",         emoji: "🧥", stack: 1, tags: ["clothing"], insulation: 6, weight: 1.5, hold: "roll", tint: "#6b5f6e"},
    pot:        { name: "Котелок",      emoji: "🫕", stack: 1, tags: ["cookware"], weight: 2 },

    /* ---- story items --------------------------------------------------- */
    diary_burnt: { name: "Обгоревший дневник", emoji: "📔", stack: 1, tags: ["story", "readable"], weight: 0.3 },
    old_key:     { name: "Старый ключ", emoji: "🗝️", stack: 1, tags: ["story", "key"], weight: 0.1, hold: "trinket", tint: "#b99a52"},
    coin:        { name: "Монета",      emoji: "🪙", stack: 999, tags: ["currency"], weight: 0.01, hold: "trinket", tint: "#d8bd6b"}
};

export function itemDef(id) { return ITEMS[id] || null; }
export function itemName(id) { const d = ITEMS[id]; return d ? d.name : id; }
export function itemEmoji(id) { const d = ITEMS[id]; return d ? d.emoji : "❔"; }
export function hasTag(id, tag) { const d = ITEMS[id]; return !!d && d.tags.includes(tag); }
export function itemsWithTag(tag) { return Object.keys(ITEMS).filter((id) => hasTag(id, tag)); }

/** Burn time in in-game seconds a fuel item contributes to a fire. */
export function burnValue(id) { const d = ITEMS[id]; return d && d.burn ? d.burn : 0; }

/** Nutrition payload applied when eaten. */
export function foodValue(id) {
    const d = ITEMS[id];
    if (!d) return null;
    if (!d.tags.includes("food") && !d.tags.includes("drink")) return null;
    return { food: d.food || 0, warmth: d.warmth || 0, heal: d.heal || 0, spirit: d.spirit || 0 };
}
