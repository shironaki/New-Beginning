/** Inventory transfers shared by the real fire menu and regression tests. */
export function canReceive(inventory, id) {
    return inventory.free > 0 || inventory.slots.some((s) => s?.id === id && s.n < inventory.stackSize(id));
}
export function startPotFromInventory(fire, inventory, ids, options = {}) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 3) return null;
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    for (const [id, count] of counts) if (!inventory.has(id, count)) return null;
    const result = fire.startPot(ids, options);
    if (!result) return null;
    for (const [id, count] of counts) inventory.remove(id, count);
    return result;
}
