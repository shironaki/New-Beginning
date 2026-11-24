import { handCapacity, canStow, pickupSide } from "../sandbox/carry.js";
/** Two anatomical hands; carried items are real inventory entries, not shortcuts. */
import { itemDef, itemName, itemEmoji, foodValue } from "../sandbox/items.js";
import { recipeById, checkRecipe, craftCost, craftPlan, craftTime, needLabel, needHave, GROUP_ORDER, GROUP_NAMES } from "../sandbox/craft.js";
export const sideName = (s) => s === "left" ? "Левая рука" : "Правая рука";
export function ready(game) {
    return game.sessionReady !== false && !game.backgrounded && !game.paused && !game.player.fallTimer && !game.inventory.handAction && !game.hud.isStoryOpen;
}
export function startMeal(game, id, preferredSide = null) {
    const inv = game.inventory;
    if (!ready(game) || !foodValue(id) || !inv.has(id) || !inv.hands) return false;
    let side = preferredSide && inv.hands[preferredSide]?.id === id ? preferredSide
        : [inv.dominant, inv.dominant === "left" ? "right" : "left"].find((s) => inv.hands[s]?.id === id);
    let previous = id, previousN = 1;
    if (!side) {
        const other = inv.dominant === "left" ? "right" : "left";
        side = [inv.dominant, other].find((s) => !inv.hands[s]);
        if (!side) side = [inv.dominant, other].find((s) => !itemDef(inv.hands[s].id)?.light && canStow(inv, s));
        if (!side) side = [inv.dominant, other].find((s) => canStow(inv, s));
        if (!side) { game.hud.toast("Обе руки заняты, в рюкзаке нет места для предмета.", "🎒"); return false; }
        previous = inv.hands[side]?.id || null; previousN = inv.hands[side]?.n || 1;
        if (!inv.equipHand(side, inv.slots.findIndex((s) => s?.id === id))) return false;
    }
    inv.handAction = { type: "eat", side, id, previous, previousN, remaining: .9 };
    game.input.releaseAll(); game.touch?.reset(); game.hud.closePanel();
    return true;
}
export function tickHands(game, dt) {
    const inv = game.inventory, a = inv.handAction;
    if (!a || game.player.fallTimer) return;
    a.remaining -= Math.max(0, dt);
    if (a.remaining > 0) return;
    inv.handAction = null;
    if (a.type === "pickup") return finishPickup(game, a);
    if (a.type === "craft") return finishCraft(game, a);
    if (inv.hands[a.side]?.id !== a.id) return;
    if (--inv.hands[a.side].n === 0) inv.hands[a.side] = null;
    inv.bus?.emit("inv:remove", { owner: inv.owner, id: a.id, n: 1 });
    if (a.previous && !inv.hands[a.side]) {
        const i = inv.slots.findIndex((s) => s?.id === a.previous);
        const stored = inv.slots.reduce((n, s) => n + (s?.id === a.previous ? s.n : 0), 0);
        if (i >= 0) inv.equipHand(a.side, i, Math.min(a.previousN || 1, stored));
    }
    game.needs.consume(foodValue(a.id));
    game.bus.emit("player:ate", { id: a.id });
    if (game.hud.panelOpen === "bag") openBag(game, game.bagCategory);
    game.hud.toast(`Съедено: ${itemName(a.id)}`, itemEmoji(a.id));
}
export function handTool(slot) {
    if (!slot) return null;
    const d = itemDef(slot.id);
    return { id: slot.id, n: slot.n, tool: d?.tool || (d?.light ? "torch" : foodValue(slot.id) ? "food" : slot.id === "pot" ? "pot" : slot.id === "diary_burnt" ? "book" : ["log", "firewood"].includes(slot.id) ? "bundle" : "item") };
}
export function handRender(inv) {
    return { leftTool: handTool(inv.hands?.left), rightTool: handTool(inv.hands?.right),
        eatingHand: inv.handAction?.type === "eat" ? inv.handAction.side : null, pickupHand: inv.handAction?.type === "pickup" ? inv.handAction.side : null, dominant: inv.dominant || "right" };
}
export function openHand(game, side) {
    if (!ready(game)) return;
    game.input.releaseAll(); game.touch?.reset();
    const inv = game.inventory, held = inv.hands[side];
    const rows = [];
    if (held) {
        rows.push({ html: `<b>${itemName(held.id)}</b>` });
        if (foodValue(held.id)) rows.push({ label: "Использовать", action: () => startMeal(game, held.id, side) });
        rows.push({ label: "Убрать в рюкзак", action: () => {
            if (inv.equipHand(side)) game.hud.closePanel(); else game.hud.toast("В рюкзаке нет места", "🎒");
        } });
    }
    rows.push({ label: "Поменять руки местами", disabled: !inv.hands.left && !inv.hands.right,
        action: () => { inv.swapHands(); game.hud.closePanel(); } });
    for (let i = 0; i < inv.slots.length; i++) {
        const s = inv.slots[i]; if (!s) continue;
        rows.push({ icon: itemEmoji(s.id), label: itemName(s.id), hint: `×${s.n}`, action: () => {
            if (inv.equipHand(side, i)) game.hud.closePanel(); else game.hud.toast("Не удалось убрать прежний предмет: рюкзак полон", "🎒");
        } });
    }
    game.hud.openPanel(sideName(side), rows, "hand");
}
export function useHand(game, side) {
    if (!ready(game) || game.hud.isPanelOpen || game.paused) return;
    const h = game.inventory.hands[side];
    if (h && foodValue(h.id)) startMeal(game, h.id, side); else openHand(game, side);
}
const GROUPS = [
    ["all", "Все", () => true], ["food", "Еда и травы", (d) => d.tags.some((t) => ["food", "drink", "herb"].includes(t))],
    ["tools", "Инструменты", (d) => d.tool || d.light || d.tags.includes("firestarter")],
    ["ore", "Руда", (d) => d.tags.includes("ore")], ["gear", "Снаряжение", (d) => d.tags.some((t) => ["clothing", "sleep", "cookware", "container"].includes(t))],
    ["story", "Записи и находки", (d) => d.tags.some((t) => ["story", "key", "currency", "valuable"].includes(t))],
    ["materials", "Материалы", (d) => d.tags.some((t) => ["fuel", "build", "craft", "feed"].includes(t))]
];
export function openBag(game, category = "all") {
    game.input.releaseAll(); game.touch?.reset();
    const inv = game.inventory, available = GROUPS.filter(([id,,match]) => id === "all" || inv.list().some((s) => match(itemDef(s.id))));
    if (!available.some(([id]) => id === category)) category = "all";
    game.bagCategory = category;
    const match = available.find(([id]) => id === category)[2];
    const rows = [{ html: `<b>Рюкзак</b> · ${inv.used}/${inv.size} · ${inv.weight} кг` }];
    rows.push({ label: "Ремесло", icon: "🪓", hint: "из того, что в рюкзаке", action: () => openCraft(game) });
    for (const [id, label] of available) rows.push({ tab: true, selected: id === category, label, action: () => openBag(game, id) });
    for (const id of [...new Set(inv.list().map((s) => s.id))]) {
        if (!match(itemDef(id))) continue;
        const stored = inv.slots.reduce((n, s) => n + (s?.id === id ? s.n : 0), 0);
        const locations = [`В рюкзаке: ${stored}`];
        for (const side of ["right", "left"]) if (inv.hands[side]?.id === id)
            locations.push(`${sideName(side)}: ${inv.hands[side].n}`);
        rows.push({ item: true, icon: itemEmoji(id), label: `${itemName(id)} ×${inv.count(id)}`, hint: locations.join(" · "), action: () => {
            const d = itemDef(id), value = foodValue(id);
            const choices = [{ html: `<small>${value ? `Сытость +${value.food || 0}` : d.insulation
                ? `Пока одежда согревает при переноске: +${d.insulation}°C. Отдельные слои экипировки ещё не реализованы.`
                : d.burn ? "Топливо можно добавить через меню костра." : d.tags.includes("cookware")
                ? "Посуду можно установить у костра." : "Можно взять в любую руку или оставить в рюкзаке."}</small>` }];
            if (foodValue(id)) choices.push({ label: "Использовать", action: () => startMeal(game, id) });
            if (id === "diary_burnt") choices.push({ label: "Прочитать", action: () => game.readDiary() });
            for (const side of ["left", "right"]) choices.push({ label: sideName(side), action: () => {
                if (!ready(game)) { game.hud.toast("Руки заняты действием", "✋"); return; }
                // This panel is live: the last unit may have been eaten meanwhile.
                if (!inv.has(id)) {
                    openBag(game, category); game.hud.toast("Предмета уже нет при себе", "🎒"); return;
                }
                const i = inv.slots.findIndex((s) => s?.id === id);
                if (inv.hands[side]?.id === id) return openHand(game, side);
                if (i >= 0 && inv.equipHand(side, i)) game.hud.closePanel();
                else if (i < 0 && inv.hands[side === "left" ? "right" : "left"]?.id === id && inv.swapHands()) game.hud.closePanel();
                else game.hud.toast("В рюкзаке нет места для прежнего предмета", "🎒");
            } });
            choices.push({ label: "Назад", action: () => openBag(game, category) });
            game.hud.openPanel(itemName(id), choices, "item");
        } });
    }
    game.hud.openPanel("Рюкзак", rows, "bag");
}

/* ------------------------------------------------------------------ ремесло */

const TOOL_NAMES = { axe: "🪓 топор", pick: "⛏️ кирка", knife: "🔪 нож", hoe: "🌾 мотыга", rod: "🎣 удочка" };

/**
 * Начать работу. Материалы списываются СРАЗУ, а не по окончании: сейв в середине
 * крафта иначе превращается в станок по печати топоров. Обратно материалы
 * возвращаются только если не нашлось места под результат — остальное игрок
 * честно потерял, потому что начал работу, которую невозможно закончить.
 */
export function startCraft(game, id) {
    const inv = game.inventory;
    if (!ready(game)) { game.hud.toast("Руки заняты или игра на паузе", "✋"); return false; }
    const r = recipeById(id);
    if (!r) return false;
    const ctx = craftCtx(game);
    const status = checkRecipe(inv, r, ctx);
    if (!status.ok) {
        if (status.needTool) game.hud.toast(`Нужен ${TOOL_NAMES[status.needTool] || status.needTool}`, "✋");
        else if (status.needFire) game.hud.toast("Нужен горящий костёр рядом", "🔥");
        else game.hud.toast(`Мало: ${status.missing.map(m => `${m.label} ${m.have}/${m.need}`).join(", ")}`, "🎒");
        return false;
    }
    const cost = craftCost(inv, r);
    if (!cost) return false;
    const taken = [];
    for (const [iid, n] of cost) {
        const got = inv.remove(iid, n);
        if (got < n) { for (const [bid, bn] of taken) inv.add(bid, bn); return false; }
        taken.push([iid, got]);
    }
    const refund = () => { for (const [iid, n] of taken) inv.add(iid, n); };
    // Место под результат ищется до списания: «сделал — и некуда положить» —
    // самый обидный способ потерять камень.
    for (const [oid, on] of r.out || []) if (!canReceive(inv, oid, on)) { refund(); game.hud.toast("Рюкзак полон", "🎒"); return false; }
    const tool = r.tool ? inv.findTool(r.tool) : null;
    if (tool && !tool.hand && !inv.equipHand(inv.dominant, tool.index)) { refund(); game.hud.toast("Нужно освободить руку для инструмента", "✋"); return false; }
    const time = craftTime(r, tool ? tool.tier : 1);
    inv.handAction = { type: "craft", id: r.id, group: game.craftGroup || "all", remaining: time, cost: taken };
    game.player.actionHand = tool ? (tool.hand || game.inventory.dominant) : game.inventory.dominant;
    game.player.swing(r.work || "gather", time);
    game.input.releaseAll(); game.touch?.reset(); game.hud.closePanel();
    game.bus.emit("craft:start", { id: r.id });
    return true;
}

/** Хватает ли места под n штук предмета (копия проверки из котелка). */
function canReceive(inv, id, n = 1) {
    const max = inv.stackSize(id);
    let free = inv.free * max;
    for (const s of inv.slots) if (s?.id === id) free += max - s.n;
    return free >= n;
}

/** Контекст проверки рецептов: у костра ли герой и что у него в руках. */
export function craftCtx(game) {
    const inv = game.inventory;
    return { atFire: !!game.nearLitFire?.(), hasTool: (t) => !!inv.findTool(t) };
}

function finishCraft(game, a) {
    const r = recipeById(a.id);
    if (!r) return;
    const inv = game.inventory;
    if (r.place) {
        const obj = game.buildProp(r.place);
        if (!obj) {
            // Место могло закрыться, пока герой строил (вода подвинула, кто-то
            // встал вплотную) — возврат строго по списанной на старте смете.
            for (const [id, n] of a.cost || []) inv.add(id, n);
            game.hud.toast("Здесь нечего ставить: занято или вода", "🚫");
        } else {
            game.hud.toast(`Готово: ${r.name}`, r.emoji);
        }
    } else {
        let left = 0;
        for (const [id, n] of r.out) left += inv.add(id, n);
        if (left > 0) game.hud.toast(`Готово: ${r.name}. Часть не влезла и упала у ног`, r.emoji);
        else game.hud.toast(`Готово: ${r.name}`, r.emoji);
    }
    game.bus.emit("craft:done", { id: r.id, place: r.place || null });
    if (game.hud.panelOpen === "craft") openCraft(game, a.group);
}

/** Панель ремесла: годное наверху, недоступное подсвечено причиной отказа. */
export function openCraft(game, group = "all") {
    game.input.releaseAll(); game.touch?.reset();
    game.craftGroup = group;
    const inv = game.inventory;
    const ctx = craftCtx(game);
    const plan = craftPlan(inv, ctx);
    const groups = GROUP_ORDER.filter((g) => plan.some((p) => p.recipe.group === g));
    const rows = [{ html: `<b>Ремесло</b>${ctx.atFire ? " · у костра" : ""}<br><small>${inv.used}/${inv.size} · ${inv.weight} кг</small>` }];
    rows.push({ tab: true, selected: group === "all", label: "Все", action: () => openCraft(game, "all") });
    for (const g of groups) rows.push({ tab: true, selected: group === g, label: GROUP_NAMES[g], action: () => openCraft(game, g) });
    for (const p of plan) {
        if (group !== "all" && p.recipe.group !== group) continue;
        const have = p.recipe.needs.map((need) => `${needLabel(need)} ${needHave(inv, need)}/${need.n}`).join(" · ");
        const why = p.needTool ? `нужен ${TOOL_NAMES[p.needTool] || p.needTool}`
            : p.needFire ? "нужен костёр"
            : p.missing.length ? `мало: ${p.missing.map(m => `${m.label} ${m.have}/${m.need}`).join(", ")}` : "";
        rows.push({ icon: p.recipe.emoji, label: p.recipe.name, hint: p.ok ? have : (why || have), action: () => startCraft(game, p.recipe.id) });
    }
    game.hud.openPanel("Ремесло", rows, "craft");
}


/** Sources keep their loot until the hand actually reaches them; save-safe. */
export function startPickup(game, obj) {
    const inv = game.inventory, item = obj.loot?.find(s => s.n > 0);
    if (!item || !ready(game)) return false;
    const side = pickupSide(inv, item.id);
    if (!side) { game.hud.toast("Руки заняты. Убери предмет в рюкзак; добыча останется здесь.", "✋"); return false; }
    if ((inv.hands[side]?.id !== item.id || inv.hands[side]?.n >= handCapacity(item.id)) && !inv.equipHand(side)) return false;
    inv.handAction = { type: "pickup", side, id: item.id, remaining: .6,
        n: Math.min(item.n, handCapacity(item.id) - (inv.hands[side]?.n || 0)),
        zone: game.zone.id, index: game.zone.objects.indexOf(obj) };
    game.input.releaseAll(); game.touch?.reset(); return true;
}
function finishPickup(game, a) {
    const inv = game.inventory, obj = game.world.get(a.zone)?.objects[a.index];
    const entry = obj?.loot?.find(s => s.id === a.id && s.n >= a.n);
    const held = inv.hands[a.side];
    const surface = game.zone.playableRelief || game.zone.relief;
    if (!entry || obj.removed || game.zone.id !== a.zone || (surface && !surface.canReach(game.player, obj, 80)) || Math.hypot(game.player.x-obj.x,game.player.y-obj.y)>80
        || (held && held.id !== a.id) || (held?.n || 0) + a.n > handCapacity(a.id)) return;
    inv.hands[a.side] = { id: a.id, n: (held?.n || 0) + a.n }; entry.n -= a.n;
    obj.loot = obj.loot.filter(s => s.n > 0);
    if (!obj.loot.length && !["hearth_ruin", "chest"].includes(obj.kind)) { obj.removed = true; game.zone.removeSolid(obj); }
    if (a.id === "pot" && obj.kind === "hearth_ruin") game.story.setFlag("home_pot_taken");
    inv.bus?.emit("inv:add", { owner: inv.owner, id: a.id, n: a.n, left: 0 });
    if (a.id === "diary_burnt") { game.story.setFlag("own_diary"); game.readDiary(); }
    if (game.hud.panelOpen === "bag") openBag(game, game.bagCategory);
    game.hud.toast(`${itemName(a.id)} ×${a.n} · ${sideName(a.side).toLowerCase()}`, itemEmoji(a.id));
}
