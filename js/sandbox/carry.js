/** Bounded bundles are physical hand contents, never backpack shortcuts. */
import { itemDef } from './items.js';
export function handCapacity(id) {
    const d = itemDef(id);
    if (!d || d.tool || d.light || ['cookware','story','clothing'].some(t => d.tags.includes(t))) return 1;
    return Math.min(d.stack || 1, id === 'log' ? 1 : id === 'firewood' ? 5 : 10);
}
export function canStow(inv, side) {
    const h = inv.hands?.[side];
    if (!h) return true;
    const space = inv.slots.reduce((n,s) => n + (!s ? inv.stackSize(h.id) : s.id === h.id ? inv.stackSize(h.id) - s.n : 0), 0);
    return space >= h.n;
}
export function pickupSide(inv, id) {
    const sides = [inv.dominant, inv.dominant === 'left' ? 'right' : 'left'];
    return sides.find(s => inv.hands[s]?.id === id && inv.hands[s].n < handCapacity(id))
        || sides.find(s => !inv.hands[s])
        || sides.find(s => !itemDef(inv.hands[s].id)?.light && canStow(inv,s))
        || sides.find(s => canStow(inv,s));
}
