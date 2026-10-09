import { handCapacity, canStow, pickupSide } from "../sandbox/carry.js";
/** Two anatomical hands; carried items are real inventory entries, not shortcuts. */
import { itemDef, itemName, itemEmoji, foodValue } from "../sandbox/items.js";
import { canReceive } from "../survival/cooking-actions.js";
export const sideName = (s) => s === "left" ? "Левая рука" : "Правая рука";
export function ready(game) {
    return game.sessionReady !== false && !game.backgrounded && !game.paused && !game.player.fallTimer && !game.inventory.handAction && !game.hud.isStoryOpen;
}
export function startMeal(game, id, preferredSide = null) {
    const inv = game.inventory;
    if (!ready(game) || !foodValue(id) || !inv.has(id) || !inv.hands) return false;
    let side = preferredSide && inv.hands[preferredSide]?.id === id ? preferredSide
        : [inv.dominant, inv.dominant === "left" ? "right" : "left"].find((s) => inv.hands[s]?.id === id);
    let previous = id;
    if (!side) {
        const other = inv.dominant === "left" ? "right" : "left";
        side = [inv.dominant, other].find((s) => !inv.hands[s]);
        if (!side) side = [inv.dominant, other].find((s) => !itemDef(inv.hands[s].id)?.light && canStow(inv, s));
        if (!side) side = [inv.dominant, other].find((s) => canStow(inv, s));
        if (!side) { game.hud.toast("Обе руки заняты, в рюкзаке нет места для предмета.", "🎒"); return false; }
        previous = inv.hands[side]?.id || null;
        if (!inv.equipHand(side, inv.slots.findIndex((s) => s?.id === id))) return false;
    }
    inv.handAction = { type: "eat", side, id, previous, remaining: .9 };
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
    if (inv.hands[a.side]?.id !== a.id) return;
    if (--inv.hands[a.side].n === 0) inv.hands[a.side] = null;
    inv.bus?.emit("inv:remove", { owner: inv.owner, id: a.id, n: 1 });
    if (a.previous && !inv.hands[a.side]) {
        const i = inv.slots.findIndex((s) => s?.id === a.previous);
        if (i >= 0) inv.equipHand(a.side, i);
    }
    game.needs.consume(foodValue(a.id));
    game.bus.emit("player:ate", { id: a.id });
    game.hud.toast(`Съедено: ${itemName(a.id)}`, itemEmoji(a.id));
}
export function handTool(slot) {
    if (!slot) return null;
    const d = itemDef(slot.id);
    return { id: slot.id, n: slot.n, tool: d?.tool || (d?.light ? "torch" : foodValue(slot.id) ? "food" : ["log", "firewood"].includes(slot.id) ? "bundle" : "item") };
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
    const match = available.find(([id]) => id === category)[2];
    const rows = [{ html: `<b>Рюкзак</b> · ${inv.used}/${inv.size} · ${inv.weight} кг` }];
    for (const [id, label] of available) rows.push({ tab: true, selected: id === category, label, action: () => openBag(game, id) });
    for (const id of [...new Set(inv.list().map((s) => s.id))]) {
        if (!match(itemDef(id))) continue;
        rows.push({ item: true, icon: itemEmoji(id), label: `${itemName(id)} ×${inv.count(id)}`, action: () => {
            const d = itemDef(id), value = foodValue(id);
            const choices = [{ html: `<small>${value ? `Сытость +${value.food || 0}` : d.insulation
                ? `Пока одежда согревает при переноске: +${d.insulation}°C. Отдельные слои экипировки ещё не реализованы.`
                : d.burn ? "Топливо можно добавить через меню костра." : d.tags.includes("cookware")
                ? "Посуду можно установить у костра." : "Можно взять в любую руку или оставить в рюкзаке."}</small>` }];
            if (foodValue(id)) choices.push({ label: "Использовать", action: () => startMeal(game, id) });
            if (id === "diary_burnt") choices.push({ label: "Прочитать", action: () => game.readDiary() });
            for (const side of ["left", "right"]) choices.push({ label: sideName(side), action: () => {
                const i = inv.slots.findIndex((s) => s?.id === id);
                if (inv.hands[side]?.id === id) return openHand(game, side);
                if (ready(game) && i >= 0 && inv.equipHand(side, i)) game.hud.closePanel();
                else if (i < 0 && ready(game)) { inv.swapHands(); game.hud.closePanel(); }
                else game.hud.toast("Руки заняты действием или в рюкзаке нет места", "🎒");
            } });
            choices.push({ label: "Назад", action: () => openBag(game, category) });
            game.hud.openPanel(itemName(id), choices, "item");
        } });
    }
    game.hud.openPanel("Рюкзак", rows, "bag");
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
    if (!entry || game.zone.id !== a.zone || Math.hypot(game.player.x-obj.x,game.player.y-obj.y)>80
        || (held && held.id !== a.id) || (held?.n || 0) + a.n > handCapacity(a.id)) return;
    inv.hands[a.side] = { id: a.id, n: (held?.n || 0) + a.n }; entry.n -= a.n;
    obj.loot = obj.loot.filter(s => s.n > 0);
    if (!obj.loot.length && !["hearth_ruin", "chest"].includes(obj.kind)) { obj.removed = true; game.zone.removeSolid(obj); }
    if (a.id === "pot" && obj.kind === "hearth_ruin") game.story.setFlag("home_pot_taken");
    inv.bus?.emit("inv:add", { owner: inv.owner, id: a.id, n: a.n, left: 0 });
    if (a.id === "diary_burnt") { game.story.setFlag("own_diary"); game.readDiary(); }
    game.hud.toast(`${itemName(a.id)} ×${a.n} · ${sideName(a.side).toLowerCase()}`, itemEmoji(a.id));
}
