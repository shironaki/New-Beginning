/**
 * sandbox — ремесло: из чего и что делается.
 *
 * Файл принципиально не знает ни про UI, ни про игрока: это таблица рецептов и
 * чистые функции «хватает ли материалов». Поэтому крафт можно тестировать на
 * голом Inventory, а игровой оверлей лишь вызывает craftPlan()/applyCraft().
 *
 * Два правила, которые держат систему целиком:
 *
 * 1. Инструмент — не лут с неба. Первобытные топор и кирка *крафтятся* из того,
 *    что поднимается голыми руками: галька на пляже, хворост, волокно из куста.
 *    Без этого правила весь каменный век упирается в стену: деревья просят
 *    топор, а топор не взять нигде.
 *
 * 2. Рецепт требует *материал*, а не конкретный id. need.any — список
 *    взаимозаменяемых предметов (камень или кремень), и выбирается из них самый
 *    доступный: берём то, чего в обрезке больше, а редкость бережём. Иначе
 *    крафт съедал бы именно тот камень, который игрок нёс на обмен.
 */

import { ITEMS, itemDef } from "./items.js";

/**
 * work — жест, которым герой работает: chop / mine / gather. Это не косметика,
 * а часть контракта: спрайтовый герой берёт кадр из той же связки, поэтому
 * выточенный из бревна топор выглядит как удар топором, а не как стойка.
 *
 * tool — чем работает, если инструмент нужен (null = голые руки).
 * at   — "fire": у костра, только там where the fire does the work (смолу
 *        разогреть, медь прокалить). Проверка живёт в UI, здесь только данные.
 * time — секунды на один цикл; хороший инструмент его сокращает.
 */
export const RECIPES = [
    { id: "rope", name: "Верёвка", emoji: "🪢", group: "material",
      out: [["rope", 1]], needs: [{ id: "fiber", n: 3 }],
      work: "gather", time: 2.5 },

    { id: "kindling", name: "Щепа на растопку", emoji: "🪵", group: "material",
      out: [["firewood", 4]], needs: [{ id: "log", n: 1 }],
      tool: "axe", work: "chop", time: 2 },

    { id: "plank", name: "Доски", emoji: "🪚", group: "material",
      out: [["plank", 3]], needs: [{ id: "log", n: 1 }],
      tool: "axe", work: "chop", time: 3.5 },

    { id: "charcoal", name: "Уголь", emoji: "◼️", group: "material",
      out: [["charcoal", 2]], needs: [{ id: "log", n: 1 }],
      at: "fire", work: "gather", time: 4 },

    /* ---- первые инструменты: всё, что поднимается руками ---- */
    { id: "knife", name: "Кремень в руке", emoji: "🔪", group: "tool",
      out: [["knife", 1]], needs: [{ any: ["flint", "stone"], n: 1 }, { id: "fiber", n: 1 }],
      work: "gather", time: 2.5,
      note: "Нож у тебя уже есть — этот рецепт на случай, если его потеряешь." },

    // Топорище — из хвороста, а не из бревна. Это не экономия на спичках:
    // бревно даёт только топор, топор требует бревно, и в пепелище такой цикл
    // не стартует вовсе. Палка в руках — самый дешёвый сук в игре.
    { id: "axe_stone", name: "Каменный топор", emoji: "🪓", group: "tool",
      out: [["axe_stone", 1]],
      needs: [{ any: ["stone", "flint"], n: 2 }, { id: "firewood", n: 2 }, { id: "fiber", n: 2 }],
      work: "gather", time: 4,
      note: "Дерево без топора не срубить — отсюда начинается весь прогресс." },

    { id: "pick_stone", name: "Каменная кирка", emoji: "⛏️", group: "tool",
      out: [["pick_stone", 1]],
      needs: [{ any: ["stone", "flint"], n: 3 }, { id: "log", n: 1 }, { id: "rope", n: 1 }],
      tool: "axe", work: "chop", time: 5,
      note: "Топор нужен, чтобы стесать топорище — рукоять из цельного бревна руками не выстрогать." },

    { id: "spear", name: "Копьё", emoji: "🔱", group: "tool",
      out: [["spear", 1]], needs: [{ id: "log", n: 2 }, { any: ["flint", "stone"], n: 1 }, { id: "rope", n: 1 }],
      tool: "knife", work: "chop", time: 4.5 },

    { id: "hoe", name: "Мотыга", emoji: "🧑‍🌾", group: "tool",
      out: [["hoe", 1]], needs: [{ id: "log", n: 1 }, { any: ["stone", "flint"], n: 2 }, { id: "rope", n: 1 }],
      tool: "axe", work: "chop", time: 4 },

    { id: "rod", name: "Удочка", emoji: "🎣", group: "tool",
      out: [["rod", 1]], needs: [{ id: "log", n: 1 }, { id: "fiber", n: 3 }],
      tool: "knife", work: "gather", time: 3.5 },

    /* ---- лагерь ---- */
    { id: "torch", name: "Факел", emoji: "🔦", group: "camp",
      out: [["torch", 2]], needs: [{ id: "firewood", n: 1 }, { id: "resin", n: 1 }],
      at: "fire", work: "gather", time: 2 },

    { id: "bedroll", name: "Спальник", emoji: "🛏️", group: "camp",
      out: [["bedroll", 1]], needs: [{ id: "hay", n: 3 }, { id: "fiber", n: 4 }],
      work: "gather", time: 4 },

    { id: "cloak", name: "Плащ", emoji: "🧥", group: "camp",
      out: [["cloak", 1]], needs: [{ id: "fiber", n: 6 }, { id: "resin", n: 1 }],
      work: "gather", time: 5 },

    { id: "pot", name: "Котелок", emoji: "🫕", group: "camp",
      out: [["pot", 1]], needs: [{ id: "copper", n: 2 }, { any: ["stone", "flint"], n: 1 }],
      at: "fire", work: "gather", time: 6,
      note: "Медь не гнётся: её сначала калдят на углях, потом бьют камнем." },

    /* ---- постройки: результат не предмет, а объект мира ---- */
    { id: "campfire", name: "Кострище", emoji: "🔥", group: "build",
      place: "campfire", needs: [{ any: ["stone", "flint"], n: 4 }, { id: "firewood", n: 3 }],
      work: "gather", time: 3,
      note: "Кострище можно разжечь и без огня в руках — хватит кресала." },

    { id: "shelter", name: "Шалаш", emoji: "⛺", group: "build",
      place: "tent", needs: [{ id: "log", n: 3 }, { id: "plank", n: 3 }, { id: "rope", n: 2 }],
      tool: "axe", work: "chop", time: 8,
      note: "Стены держат тепло: под крышей ночь переносится заметно легче." }
];

/** Все материалы, которыми можно закрыть одну строку потребности. */
export function needIds(need) {
    return need.id ? [need.id] : (need.any || []).filter((id) => itemDef(id));
}

/** Сколько из нужного есть в инвентаре (по всем подходящим предметам сразу). */
export function needHave(inv, need) {
    return needIds(need).reduce((n, id) => n + inv.count(id), 0);
}

/**
 * Что взять из рюкзака. Берём в порядке убывания количества: редкий материал
 * (кремень для огнива) останется на месте, если в обрезке есть обычный камень.
 */
export function needPick(inv, need) {
    const left = { need: need.n };
    const picks = [];
    const cands = needIds(need)
        .map((id) => ({ id, have: inv.count(id), weight: itemDef(id)?.weight || 0 }))
        .filter((c) => c.have > 0)
        .sort((a, b) => b.have - a.have || a.weight - b.weight);
    for (const c of cands) {
        if (left.need <= 0) break;
        const take = Math.min(c.have, left.need);
        left.need -= take;
        picks.push([c.id, take]);
    }
    return left.need > 0 ? null : picks;
}

/** Итог проверки рецепта: годится ли и чего не хватает. */
export function checkRecipe(inv, recipe, { atFire = false, hasTool = () => false } = {}) {
    const missing = [];
    for (const need of recipe.needs) {
        const have = needHave(inv, need);
        if (have < need.n) missing.push({ label: needLabel(need), need: need.n, have });
    }
    if (recipe.tool && !hasTool(recipe.tool)) {
        return { ok: false, missing, needTool: recipe.tool };
    }
    if (recipe.at === "fire" && !atFire) return { ok: false, missing, needFire: true };
    return { ok: missing.length === 0, missing };
}

/** Человекочитаемое имя потребности: «камень» или список из взаимозаменяемых. */
export function needLabel(need) {
    const ids = needIds(need);
    if (ids.length === 1) return itemDef(ids[0])?.name || ids[0];
    return ids.map((id) => itemDef(id)?.name || id).join("/");
}

export function recipeById(id) { return RECIPES.find((r) => r.id === id) || null; }

/** Порядок вывода в меню: сначала всё, что можно сделать прямо сейчас. */
export function craftPlan(inv, opts = {}) {
    return RECIPES.map((recipe) => {
        const status = checkRecipe(inv, recipe, opts);
        return { recipe, ...status };
    }).sort((a, b) => (b.ok - a.ok) || GROUP_ORDER.indexOf(a.recipe.group) - GROUP_ORDER.indexOf(b.recipe.group));
}

export const GROUP_ORDER = ["tool", "build", "camp", "material"];
export const GROUP_NAMES = { tool: "Инструменты", build: "Постройки", camp: "Лагерь", material: "Материалы" };

/**
 * Себестоимость до списания: что именно уйдёт из рюкзака. Отдельная функция
 * потому, что списывать надо *в начале* работы, а не в конце: игрок, вышедший
 *из мира в середине крафта, не должен получать топор дважды.
 */
export function craftCost(inv, recipe) {
    const cost = [];
    for (const need of recipe.needs) {
        const picks = needPick(inv, need);
        if (!picks) return null;
        for (const [id, n] of picks) cost.push([id, n]);
    }
    return cost;
}

/** Чем качественнее инструмент, тем быстрее идёт работа (полтакта за уровень). */
export function craftTime(recipe, tier = 1) {
    return Math.max(0.6, (recipe.time || 3) * (1 - Math.min(0.5, (Math.max(1, tier) - 1) * 0.2)));
}

/**
 * Рецепт, который даёт орудие нужного вида. Нужен он для одного: подсказка в
 * мире («нужен топор») не должна вести в никуда. Пока крафта не было, игрок
 * читал это как «иди поищи ещё», и шёл искать. Теперь он видит, из чего топор
 * делается, и идёт собирать.
 */
export function toolRecipe(kind) {
    return RECIPES.find((r) => (r.out || []).some(([id]) => itemDef(id)?.tool === kind)) || null;
}

/** Короткая строка «из чего и где»: её печатает тост, когда действие не вышло. */
export function craftSourceHint(kind) {
    const r = toolRecipe(kind);
    if (!r) return null;
    const need = r.needs.map((n) => `${n.n}× ${needLabel(n)}`).join(", ");
    const gate = r.at === "fire" ? " у костра" : r.tool ? ` нужен ${TOOL_GATES[r.tool] || r.tool}` : "";
    return `собери ${need}${gate} — крафт: B или рюкзак → Ремесло`;
}

const TOOL_GATES = { axe: "топор", pick: "кирка", knife: "нож" };

