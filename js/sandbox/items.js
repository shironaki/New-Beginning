/**
 * sandbox — item catalogue (data, not logic).
 *
 * Items are described by **tags**, not by hard-coded recipe ids. A campfire
 * does not know what "rabbit leg" is; it knows the item is tagged `meat` and
 * `raw`, so it can be roasted. That is what lets cooking be combinatorial
 * instead of a list of 40 hand-written recipes.
 */

export const ITEMS = {
    /* ---- raw resources ------------------------------------------------ */
    firewood:  { name: "Хворост",      emoji: "🪵", stack: 50, tags: ["fuel"], burn: 2100, weight: 0.4 },
    log:       { name: "Бревно",       emoji: "🪵", stack: 20, tags: ["fuel", "build"], burn: 8100, weight: 3 },
    plank:     { name: "Доска",        emoji: "🪚", stack: 50, tags: ["build"], burn: 3600, weight: 1 },
    stone:     { name: "Камень",       emoji: "🪨", stack: 50, tags: ["build"], weight: 2 },
    flint:     { name: "Кремень",      emoji: "🔥", stack: 20, tags: ["tool_part", "firestarter"], weight: 0.2 },
    fiber:     { name: "Волокно",      emoji: "🌾", stack: 50, tags: ["craft"], weight: 0.1 },
    hay:       { name: "Сено",         emoji: "🌾", stack: 50, tags: ["fuel", "feed"], burn: 420, weight: 0.3 },
    resin:     { name: "Смола",        emoji: "🟤", stack: 20, tags: ["craft", "fuel"], burn: 2600, weight: 0.3 },
    copper:    { name: "Медная руда",  emoji: "🟠", stack: 30, tags: ["ore"], weight: 2.5 },
    iron:      { name: "Железная руда",emoji: "⚙️", stack: 30, tags: ["ore"], weight: 3 },
    coal:      { name: "Уголь",        emoji: "⬛", stack: 40, tags: ["fuel", "ore"], burn: 16200, weight: 1.5 },
    gem:       { name: "Самоцвет",     emoji: "💎", stack: 10, tags: ["valuable"], weight: 0.3 },
    charcoal:  { name: "Древесный уголь", emoji: "◼️", stack: 40, tags: ["fuel"], burn: 9600, weight: 0.8 },
    ash_dust:  { name: "Зола",         emoji: "🌫️", stack: 40, tags: ["craft", "fertiliser"], weight: 0.2 },

    /* ---- raw food ------------------------------------------------------ */
    meat_raw:  { name: "Сырое мясо",   emoji: "🥩", stack: 20, tags: ["food", "raw", "meat", "perishable"], food: 16, weight: 1 },
    fish_raw:  { name: "Сырая рыба",   emoji: "🐟", stack: 20, tags: ["food", "raw", "fish", "perishable"], food: 12, weight: 0.8 },
    egg:       { name: "Яйцо",         emoji: "🥚", stack: 20, tags: ["food", "raw", "egg"], food: 7, weight: 0.2 },
    mushroom:  { name: "Гриб",         emoji: "🍄", stack: 30, tags: ["food", "raw", "mushroom", "forage"], food: 5, weight: 0.2 },
    berry:     { name: "Ягоды",        emoji: "🫐", stack: 40, tags: ["food", "berry", "forage", "sweet"], food: 5, weight: 0.1 },
    root:      { name: "Корнеплод",    emoji: "🥕", stack: 30, tags: ["food", "raw", "root", "forage"], food: 8, weight: 0.3 },
    grain:     { name: "Зерно",        emoji: "🌾", stack: 50, tags: ["food", "raw", "grain"], food: 4, weight: 0.3 },
    herb_mint: { name: "Мята",         emoji: "🌿", stack: 30, tags: ["herb", "forage", "aromatic"], weight: 0.1 },
    herb_sage: { name: "Шалфей",       emoji: "🍃", stack: 30, tags: ["herb", "forage", "medicinal"], weight: 0.1 },
    herb_yarrow: { name: "Тысячелистник", emoji: "🌼", stack: 30, tags: ["herb", "forage", "medicinal"], weight: 0.1 },
    water_skin: { name: "Бурдюк с водой", emoji: "🧴", stack: 1, tags: ["water", "container"], weight: 1 },

    /* ---- cooked food (produced by the fire, not bought from a menu) ---- */
    meat_roast: { name: "Жареное мясо", emoji: "🍖", stack: 20, tags: ["food", "cooked", "meat"], food: 34, warmth: 8, weight: 0.9 },
    fish_grill: { name: "Печёная рыба", emoji: "🐠", stack: 20, tags: ["food", "cooked", "fish"], food: 26, warmth: 7, weight: 0.7 },
    egg_baked:  { name: "Печёное яйцо", emoji: "🍳", stack: 20, tags: ["food", "cooked", "egg"], food: 15, warmth: 4, weight: 0.2 },
    mushroom_roast: { name: "Жареные грибы", emoji: "🍄", stack: 30, tags: ["food", "cooked", "mushroom"], food: 13, warmth: 4, weight: 0.2 },
    root_baked: { name: "Печёный корнеплод", emoji: "🍠", stack: 30, tags: ["food", "cooked", "root"], food: 19, warmth: 6, weight: 0.3 },
    flatbread:  { name: "Лепёшка",      emoji: "🫓", stack: 20, tags: ["food", "cooked", "grain"], food: 18, warmth: 5, weight: 0.3 },
    food_burnt: { name: "Головёшка",    emoji: "🪨", stack: 20, tags: ["food", "burnt"], food: 2, weight: 0.3 },

    /* ---- pot dishes (discovered by combining, see cooking.js) --------- */
    stew_meat:  { name: "Сытное рагу",  emoji: "🍲", stack: 10, tags: ["food", "cooked", "dish"], food: 48, warmth: 18, spirit: 6, weight: 1 },
    fish_soup:  { name: "Уха",          emoji: "🥣", stack: 10, tags: ["food", "cooked", "dish"], food: 40, warmth: 20, spirit: 5, weight: 1 },
    veg_soup:   { name: "Похлёбка",     emoji: "🍜", stack: 10, tags: ["food", "cooked", "dish"], food: 30, warmth: 16, spirit: 3, weight: 1 },
    herb_tea:   { name: "Травяной отвар", emoji: "🍵", stack: 10, tags: ["drink", "cooked", "medicine"], food: 6, warmth: 22, heal: 12, spirit: 8, weight: 0.5 },
    berry_jam:  { name: "Ягодное варенье", emoji: "🍯", stack: 10, tags: ["food", "cooked", "sweet"], food: 22, spirit: 10, weight: 0.6 },
    porridge:   { name: "Каша",         emoji: "🥣", stack: 10, tags: ["food", "cooked", "dish"], food: 34, warmth: 14, weight: 0.8 },

    /* ---- tools & gear -------------------------------------------------- */
    knife:      { name: "Нож",          emoji: "🔪", stack: 1, tags: ["tool", "knife", "weapon"], tool: "knife", tier: 1, dmg: 5, weight: 0.5 },
    axe_stone:  { name: "Каменный топор", emoji: "🪓", stack: 1, tags: ["tool", "axe", "weapon"], tool: "axe", tier: 1, dmg: 7, weight: 2 },
    pick_stone: { name: "Каменная кирка", emoji: "⛏️", stack: 1, tags: ["tool", "pick"], tool: "pick", tier: 1, weight: 2.5 },
    spear:      { name: "Копьё",        emoji: "🔱", stack: 1, tags: ["weapon", "reach"], tool: "spear", tier: 1, dmg: 11, weight: 1.8 },
    rod:        { name: "Удочка",       emoji: "🎣", stack: 1, tags: ["tool", "rod"], tool: "rod", tier: 1, weight: 1 },
    hoe:        { name: "Мотыга",       emoji: "🧑‍🌾", stack: 1, tags: ["tool", "hoe"], tool: "hoe", tier: 1, weight: 1.6 },
    torch:      { name: "Факел",        emoji: "🔦", stack: 5, tags: ["light", "fuel"], light: 110, burn: 3200, weight: 0.4 },
    bedroll:    { name: "Спальник",     emoji: "🛏️", stack: 1, tags: ["sleep"], weight: 2 },
    cloak:      { name: "Плащ",         emoji: "🧥", stack: 1, tags: ["clothing"], insulation: 6, weight: 1.5 },
    pot:        { name: "Котелок",      emoji: "🫕", stack: 1, tags: ["cookware"], weight: 2 },

    /* ---- story items --------------------------------------------------- */
    diary_burnt: { name: "Обгоревший дневник", emoji: "📔", stack: 1, tags: ["story", "readable"], weight: 0.3 },
    old_key:     { name: "Старый ключ", emoji: "🗝️", stack: 1, tags: ["story", "key"], weight: 0.1 },
    coin:        { name: "Монета",      emoji: "🪙", stack: 999, tags: ["currency"], weight: 0.01 }
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
