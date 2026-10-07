/**
 * core — save system.
 *
 * Subsystems register a provider: a name plus `save()` / `load(data)`. The
 * manager stitches those into one versioned blob. Storage is injectable, so
 * tests use a plain in-memory object and the browser uses localStorage.
 */

export const SAVE_VERSION = 3;
export const SAVE_KEY = "minirpg_v3_save";

/** Memory storage with the localStorage interface — used by tests and node. */
export class MemoryStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
}

export class SaveManager {
    constructor({ storage = null, key = SAVE_KEY, bus = null } = {}) {
        this.storage = storage || (typeof localStorage !== "undefined" ? localStorage : new MemoryStorage());
        this.key = key;
        this.bus = bus;
        this.providers = new Map();
    }

    /** Register a chunk of the save file. */
    register(name, save, load) {
        this.providers.set(name, { save, load });
        return this;
    }

    /** Build the full save object (without writing it). */
    snapshot(meta = {}) {
        const data = { version: SAVE_VERSION, savedAt: Date.now(), meta, parts: {} };
        for (const [name, p] of this.providers) {
            try { data.parts[name] = p.save(); } catch (err) {
                if (typeof console !== "undefined") console.error(`[save] ${name}`, err);
            }
        }
        return data;
    }

    write(meta = {}) {
        const data = this.snapshot(meta);
        try {
            this.storage.setItem(this.key, JSON.stringify(data));
            if (this.bus) this.bus.emit("save:written", { data });
            return true;
        } catch (err) {
            if (this.bus) this.bus.emit("save:error", { err });
            return false;
        }
    }

    read() {
        try {
            const raw = this.storage.getItem(this.key);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || typeof data !== "object") return null;
            return this.migrate(data);
        } catch (err) { return null; }
    }

    /** Future-proofing: old saves get upgraded rather than discarded. */
    migrate(data) {
        if (!data.version) data.version = 1;
        if (!data.parts) data.parts = {};
        data.version = SAVE_VERSION;
        return data;
    }

    /** Apply a save blob to every registered subsystem. Returns true on success. */
    restore(data) {
        if (!data || !data.parts) return false;
        for (const [name, p] of this.providers) {
            if (data.parts[name] === undefined) continue;
            try { p.load(data.parts[name]); } catch (err) {
                if (typeof console !== "undefined") console.error(`[load] ${name}`, err);
            }
        }
        if (this.bus) this.bus.emit("save:restored", { data });
        return true;
    }

    /** Convenience: read from storage and apply. */
    loadFromStorage() {
        const data = this.read();
        return data ? this.restore(data) : false;
    }

    has() { return !!this.storage.getItem(this.key); }
    erase() { this.storage.removeItem(this.key); return this; }

    /** Export / import as text, for sharing a world or backing it up. */
    exportString(meta = {}) { return JSON.stringify(this.snapshot(meta)); }
    importString(str) {
        try { return this.restore(this.migrate(JSON.parse(str))); } catch (e) { return false; }
    }
}
