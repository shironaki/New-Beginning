/** Intent-based quick access. Storage slots remain compatible with v4 saves. */
import { itemDef, itemName, itemEmoji, foodValue } from "../sandbox/items.js";
export const holdable = (id) => !!(itemDef(id)?.tool || itemDef(id)?.tags.includes("light"));
export function quickFood(inv, preferred) {
    if (preferred && inv.has(preferred) && foodValue(preferred)) return preferred;
    return inv.slots.find((s) => s && foodValue(s.id))?.id || null;
}
export function equip(game, index) {
    const slot = game.inventory.slots[index];
    if (!slot || !holdable(slot.id) || game.sessionReady === false) return false;
    game.inventory.setActive(index); game.hud.toast(`В руке: ${itemName(slot.id)}`, itemEmoji(slot.id));
    return true;
}
export function openEquipment(game) {
    if (game.sessionReady === false) return;
    game.input.releaseAll(); game.touch?.reset();
    const rows = game.inventory.slots.flatMap((s, i) => s && holdable(s.id) ? [{
        icon: itemEmoji(s.id), label: itemName(s.id), hint: i === game.inventory.activeSlot ? "В руке" : "Взять",
        action: () => { if (equip(game, i)) game.hud.closePanel(); }
    }] : []);
    if (!rows.length) rows.push({ html: "В рюкзаке пока нет ручных инструментов или факела." });
    game.hud.openPanel("Предмет в руке", rows, "equipment");
}
export function openProvisions(game) {
    if (game.sessionReady === false) return;
    game.input.releaseAll(); game.touch?.reset();
    const ids = [...new Set(game.inventory.slots.filter((s) => s && foodValue(s.id)).map((s) => s.id))];
    const rows = ids.map((id) => ({ icon: itemEmoji(id), label: `${itemName(id)} ×${game.inventory.count(id)}`,
        hint: `+${foodValue(id).food} сытости`, action: () => { game.quickFoodId = id; game.hud.closePanel(); }
    }));
    if (!rows.length) rows.push({ html: "Еды нет. Найденные продукты автоматически появятся здесь." });
    game.hud.openPanel("Еда под рукой · выбрать", rows, "provisions");
}
export function eatQuick(game) {
    if (game.sessionReady === false || game.paused || game.backgrounded || game.player.fallTimer > 0 || game.hud.isPanelOpen || game.hud.isStoryOpen) return false;
    const id = quickFood(game.inventory, game.quickFoodId);
    if (!id) return false;
    game.quickFoodId = id;
    return game.eat(id);
}
