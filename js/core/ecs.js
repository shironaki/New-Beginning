/**
 * core — ECS-lite.
 *
 * Entities are plain objects with an id and a `tags` set; components are plain
 * data fields on that object. Systems are functions over queries. Deliberately
 * tiny: no archetypes, no bitsets — a valley has hundreds of entities, not
 * hundreds of thousands, and readable data beats clever packing here.
 */
export class World {
    constructor() {
        this.entities = new Map();   // id -> entity
        this.nextId = 1;
        this.systems = [];
        this._queryCache = new Map();
        this._dirty = true;
    }

    /** Create an entity from a plain data object. */
    spawn(data = {}) {
        const id = data.id != null ? data.id : this.nextId++;
        if (id >= this.nextId) this.nextId = id + 1;
        const ent = Object.assign({ id, dead: false }, data);
        ent.tags = new Set(data.tags || []);
        this.entities.set(id, ent);
        this._dirty = true;
        return ent;
    }

    get(id) { return this.entities.get(id) || null; }

    /** Mark for removal; actual removal happens in `flush()` after the tick. */
    kill(entOrId) {
        const ent = typeof entOrId === "object" ? entOrId : this.entities.get(entOrId);
        if (ent) ent.dead = true;
        return this;
    }

    /** Drop dead entities. Called once per frame, never mid-iteration. */
    flush() {
        let removed = 0;
        for (const [id, ent] of this.entities) {
            if (ent.dead) { this.entities.delete(id); removed++; }
        }
        if (removed) this._dirty = true;
        return removed;
    }

    /** All live entities having every listed component/field. */
    query(...keys) {
        const out = [];
        for (const ent of this.entities.values()) {
            if (ent.dead) continue;
            let ok = true;
            for (const k of keys) {
                if (ent[k] === undefined || ent[k] === null) { ok = false; break; }
            }
            if (ok) out.push(ent);
        }
        return out;
    }

    /** All live entities carrying a tag ("tree", "npc", "campfire"…). */
    byTag(tag) {
        const out = [];
        for (const ent of this.entities.values()) {
            if (!ent.dead && ent.tags && ent.tags.has(tag)) out.push(ent);
        }
        return out;
    }

    /** First live entity with a tag, or null. */
    firstByTag(tag) {
        for (const ent of this.entities.values()) {
            if (!ent.dead && ent.tags && ent.tags.has(tag)) return ent;
        }
        return null;
    }

    /**
     * Nearest live entity with `tag` within `radius` world units of (x, y).
     * The backbone of the "press E on the thing in front of you" interaction.
     */
    nearest(x, y, tag, radius = Infinity) {
        let best = null, bestD = radius * radius;
        for (const ent of this.entities.values()) {
            if (ent.dead || !ent.tags || !ent.tags.has(tag)) continue;
            if (ent.x === undefined || ent.y === undefined) continue;
            const dx = ent.x - x, dy = ent.y - y;
            const d = dx * dx + dy * dy;
            if (d <= bestD) { bestD = d; best = ent; }
        }
        return best;
    }

    /** Register a system: a function (world, dt, ctx) run every tick. */
    addSystem(name, fn, { order = 0 } = {}) {
        this.systems.push({ name, fn, order, enabled: true });
        this.systems.sort((a, b) => a.order - b.order);
        return this;
    }

    setSystemEnabled(name, enabled) {
        for (const s of this.systems) if (s.name === name) s.enabled = enabled;
        return this;
    }

    /** Run every enabled system once, then sweep the dead. */
    tick(dt, ctx = {}) {
        for (const s of this.systems) {
            if (!s.enabled) continue;
            s.fn(this, dt, ctx);
        }
        this.flush();
        return this;
    }

    get size() { return this.entities.size; }

    /** Serialisable snapshot: skips runtime-only fields (functions, Sets become arrays). */
    toJSON(filter = () => true) {
        const out = [];
        for (const ent of this.entities.values()) {
            if (ent.dead || !filter(ent)) continue;
            const copy = {};
            for (const [k, v] of Object.entries(ent)) {
                if (typeof v === "function") continue;
                if (k === "tags") { copy.tags = Array.from(v); continue; }
                if (v instanceof Set) { copy[k] = Array.from(v); continue; }
                if (v instanceof Map) { copy[k] = Array.from(v.entries()); continue; }
                copy[k] = v;
            }
            out.push(copy);
        }
        return out;
    }

    /** Restore from a snapshot produced by toJSON(). */
    load(list = []) {
        this.entities.clear();
        this.nextId = 1;
        for (const data of list) this.spawn(data);
        this._dirty = true;
        return this;
    }
}
