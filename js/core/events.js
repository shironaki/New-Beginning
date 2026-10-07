/**
 * core — event bus.
 *
 * Systems never reach into each other. The campfire does not know the quest
 * log exists; it just emits "cook:done" and whoever cares listens. This is what
 * keeps a colony sim from turning into the 1000-line main.js of v2.
 */
export class EventBus {
    constructor() {
        this.handlers = new Map();
        this.log = [];          // recent events, handy for tests and the journal
        this.logLimit = 200;
    }

    /** Subscribe. Returns an unsubscribe function. */
    on(type, fn) {
        if (!this.handlers.has(type)) this.handlers.set(type, new Set());
        this.handlers.get(type).add(fn);
        return () => this.off(type, fn);
    }

    /** Subscribe for a single delivery. */
    once(type, fn) {
        const off = this.on(type, (payload) => { off(); fn(payload); });
        return off;
    }

    off(type, fn) {
        const set = this.handlers.get(type);
        if (set) set.delete(fn);
    }

    /** Fire an event. Handler errors are contained: one bad listener never kills the frame. */
    emit(type, payload = {}) {
        this.log.push({ type, payload });
        if (this.log.length > this.logLimit) this.log.shift();
        const set = this.handlers.get(type);
        if (set) {
            for (const fn of Array.from(set)) {
                try { fn(payload, type); } catch (err) {
                    if (typeof console !== "undefined") console.error(`[events] ${type}`, err);
                }
            }
        }
        const wild = this.handlers.get("*");
        if (wild) {
            for (const fn of Array.from(wild)) {
                try { fn(payload, type); } catch (err) { /* ignore */ }
            }
        }
        return this;
    }

    /** Events of a type seen so far (tests, journal, achievements). */
    history(type) {
        return type ? this.log.filter((e) => e.type === type) : this.log.slice();
    }

    clear() { this.handlers.clear(); this.log.length = 0; }
}
