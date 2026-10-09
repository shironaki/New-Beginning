/**
 * sandbox — slot-based inventory with stacking, weight and a hotbar.
 *
 * Slot-based (not a dictionary) because survival needs scarcity: a backpack
 * has a limited number of pockets, and deciding what to leave behind is part
 * of the game.
 */
import { itemDef } from "./items.js";

export class Inventory {
    constructor({ slots = 24, hotbar = 6, bus = null, owner = "player" } = {}) {
        this.size = slots;
        this.hotbarSize = hotbar;
        this.slots = new Array(slots).fill(null); // { id, n } | null
        this.bus = bus;
        this.owner = owner;
        this.activeSlot = 0;
    }

    /** How many of an item fit in one slot. */
    stackSize(id) { const d = itemDef(id); return d && d.stack ? d.stack : 1; }

    count(id) {
        let n = 0;
        for (const s of this.slots) if (s && s.id === id) n += s.n;
        return n;
    }

    has(id, n = 1) { return this.count(id) >= n; }

    get used() { return this.slots.filter(Boolean).length; }
    get free() { return this.size - this.used; }

    get weight() {
        let w = 0;
        for (const s of this.slots) {
            if (!s) continue;
            const d = itemDef(s.id);
            w += (d && d.weight ? d.weight : 0.2) * s.n;
        }
        return Math.round(w * 10) / 10;
    }

    /** Add items; returns how many did NOT fit. */
    add(id, n = 1) {
        if (!itemDef(id) || n <= 0) return n;
        let left = n;
        const max = this.stackSize(id);
        for (let i = 0; i < this.size && left > 0; i++) {      // top up existing stacks
            const s = this.slots[i];
            if (s && s.id === id && s.n < max) {
                const put = Math.min(max - s.n, left);
                s.n += put; left -= put;
            }
        }
        for (let i = 0; i < this.size && left > 0; i++) {      // then empty slots
            if (!this.slots[i]) {
                const put = Math.min(max, left);
                this.slots[i] = { id, n: put };
                left -= put;
            }
        }
        const added = n - left;
        if (added > 0 && this.bus) this.bus.emit("inv:add", { owner: this.owner, id, n: added, left });
        return left;
    }

    /** Remove items; returns how many were actually removed. */
    remove(id, n = 1) {
        let left = n;
        for (let i = this.size - 1; i >= 0 && left > 0; i--) {
            const s = this.slots[i];
            if (!s || s.id !== id) continue;
            const take = Math.min(s.n, left);
            s.n -= take; left -= take;
            if (s.n <= 0) this.slots[i] = null;
        }
        const removed = n - left;
        if (removed > 0 && this.bus) this.bus.emit("inv:remove", { owner: this.owner, id, n: removed });
        return removed;
    }

    /** Take one item out of a specific slot (used by the fire and crafting UI). */
    takeFromSlot(index, n = 1) {
        const s = this.slots[index];
        if (!s) return null;
        const take = Math.min(s.n, n);
        s.n -= take;
        const out = { id: s.id, n: take };
        if (s.n <= 0) this.slots[index] = null;
        if (this.bus) this.bus.emit("inv:remove", { owner: this.owner, id: out.id, n: take });
        return out;
    }

    swap(a, b) {
        const t = this.slots[a]; this.slots[a] = this.slots[b]; this.slots[b] = t;
        return this;
    }

    get hotbar() { return this.slots.slice(0, this.hotbarSize); }
    get active() { return this.slots[this.activeSlot] || null; }

    setActive(i) {
        this.activeSlot = Math.max(0, Math.min(this.size - 1, Number.isInteger(i) ? i : 0));
        if (this.bus) this.bus.emit("inv:active", { index: this.activeSlot, item: this.active });
        return this;
    }

    /** Currently held tool kind ("axe", "pick"…) or null. */
    activeTool() {
        const s = this.active;
        if (!s) return null;
        const d = itemDef(s.id);
        return d && d.tool ? d.tool : null;
    }

    /** Does the player hold (anywhere) a tool of this kind? Used for "you need an axe". */
    findTool(kind) {
        for (let i = 0; i < this.size; i++) {
            const s = this.slots[i];
            if (!s) continue;
            const d = itemDef(s.id);
            if (d && d.tool === kind) return { index: i, id: s.id, tier: d.tier || 1 };
        }
        return null;
    }

    /** Flat list for UI and tests: [{ id, n }]. */
    list() { return this.slots.filter(Boolean).map((s) => ({ id: s.id, n: s.n })); }

    clear() { this.slots.fill(null); return this; }

    toJSON() { return { slots: this.slots, activeSlot: this.activeSlot, size: this.size }; }
    load(data) {
        if (!data) return this;
        this.size = data.size || this.size;
        this.slots = new Array(this.size).fill(null);
        (data.slots || []).forEach((s, i) => { if (s && i < this.size) this.slots[i] = { id: s.id, n: s.n }; });
        this.activeSlot = data.activeSlot || 0;
        return this;
    }
}
