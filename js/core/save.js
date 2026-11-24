/**
 * core — save system.
 *
 * Subsystems register a provider: a name plus `save()` / `load(data)`. The
 * manager stitches those into one versioned blob. Storage is injectable, so
 * tests use a plain in-memory object and the browser uses localStorage.
 */

export const SAVE_VERSION = 4;
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
        this.storageError = false;
        try { this.storage = storage || (typeof localStorage !== "undefined" ? localStorage : new MemoryStorage()); }
        catch { this.storage = new MemoryStorage(); this.storageError = true; }
        this.lastError = null;
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
            data.parts[name] = p.save();
        }
        return data;
    }

    write(meta = {}) {
        try {
            if (this.storageError) throw new Error("Хранилище браузера недоступно");
            const data = this.snapshot(meta);
            this.storage.setItem(this.key, JSON.stringify(data));
            if (this.bus) this.bus.emit("save:written", { data });
            return true;
        } catch (err) {
            this.lastError = err;
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
        if (!data || typeof data !== "object" || Array.isArray(data) || !data.parts
            || typeof data.parts !== "object" || Array.isArray(data.parts)) throw new Error("Некорректное сохранение");
        if (data.version != null && (!Number.isInteger(data.version) || data.version < 1 || data.version > SAVE_VERSION))
            throw new Error("Сохранение из неподдерживаемой версии");
        return { ...data, version: SAVE_VERSION };
    }

    /** Transactional restore: failed providers roll back, storage is untouched. */
    restore(data) {
        let backup;
        try {
            data = this.migrate(data);
            if (this.validate) this.validate(data);
            backup = JSON.parse(JSON.stringify(this.snapshot()));
            for (const [name, p] of this.providers) if (data.parts[name] !== undefined) p.load(data.parts[name]);
            if (this.bus) this.bus.emit("save:restored", { data });
            this.lastError = null;
            return true;
        } catch (err) {
            this.lastError = err;
            if (backup) for (const [name, p] of this.providers) {
                try { if (backup.parts[name] !== undefined) p.load(backup.parts[name]); } catch { /* retain original error */ }
            }
            if (this.bus) this.bus.emit("save:error", { err });
            return false;
        }
    }

    /** Convenience: read from storage and apply. */
    loadFromStorage() {
        const data = this.read();
        return data ? this.restore(data) : false;
    }

    has() { try { return !!this.storage.getItem(this.key); } catch { return false; } }
    erase() { this.storage.removeItem(this.key); return this; }

    /** Export / import as text, for sharing a world or backing it up. */
    exportString(meta = {}) { return JSON.stringify(this.snapshot(meta)); }
    importString(str) {
        try { return this.restore(this.migrate(JSON.parse(str))); } catch (e) { return false; }
    }
}
