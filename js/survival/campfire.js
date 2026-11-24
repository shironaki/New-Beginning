/**
 * survival — the campfire as a physical object, not a menu.
 *
 * You walk up, put a thing on the spit, and watch it cook. Fuel burns down in
 * real time, food goes raw → cooking → done → burnt → charcoal if you forget
 * it, and the fire itself is light, warmth, safety and the place where (later)
 * the settlers gather in the evening.
 */
import { fireExposure } from "./fire-weather.js";
import { burnValue, itemDef } from "../sandbox/items.js";
import { resolveSpit, resolvePot } from "./cooking.js";

export const COOK_STATE = { RAW: "raw", COOKING: "cooking", DONE: "done", BURNT: "burnt" };

/** One thing sitting over the heat. */
export class CookSlot {
    constructor(itemId) {
        const rule = resolveSpit(itemId);
        this.itemId = itemId;
        this.out = rule ? rule.out : "food_burnt";
        this.cookTime = rule ? rule.time : 20;
        this.progress = 0;        // 0..1 towards `done`
        this.overcook = 0;        // 0..1 towards `burnt` once done
        this.state = COOK_STATE.RAW;
    }

    /** @param {number} dt in-game seconds of heat */
    update(dt, heat = 1) {
        if (this.state === COOK_STATE.BURNT) return this;
        if (heat <= 0) return this;                     // no fire, no progress
        if (this.state === COOK_STATE.DONE) {
            this.overcook += (dt * heat) / (this.cookTime * 1.6);
            if (this.overcook >= 1) { this.state = COOK_STATE.BURNT; this.out = "food_burnt"; }
            return this;
        }
        this.state = COOK_STATE.COOKING;
        this.progress += (dt * heat) / this.cookTime;
        if (this.progress >= 1) { this.progress = 1; this.state = COOK_STATE.DONE; }
        return this;
    }

    get ready() { return this.state === COOK_STATE.DONE || this.state === COOK_STATE.BURNT; }
    get result() { return this.state === COOK_STATE.BURNT ? "food_burnt" : this.out; }

    toJSON() {
        return { itemId: this.itemId, out: this.out, cookTime: this.cookTime,
                 progress: this.progress, overcook: this.overcook, state: this.state };
    }
    static fromJSON(d) {
        const s = new CookSlot(d.itemId);
        Object.assign(s, d);
        return s;
    }
}

export class Campfire {
    constructor({ bus = null, spitSlots = 2, emberSlots = 2 } = {}) {
        this.bus = bus;
        this.lit = false;
        this.fuel = 0;              // in-game seconds of burn left (sum of pieces)
        this.maxFuel = 25200;       // seven in-game hours of fuel fits in the pit
        // What is physically lying in the pit, oldest first. The renderer draws
        // these, so a fire full of brushwood looks different from one with a
        // log on it, and you can see your fuel char and shrink as it burns.
        this.pieces = [];
        this.spit = new Array(spitSlots).fill(null);
        this.embers = new Array(emberSlots).fill(null);
        this.pot = null;            // { ingredients: [], water: bool, progress, result, time }
        this.hasPot = false;
        this.flicker = 0;           // render-only animation phase
        this.damp = 0;
        this.ignitionProgress = 0;
        this.exposure = fireExposure();
        this.lastFailure = "";
        this.ashes = 0;             // charcoal/ash accumulating under the fire
    }

    /* ---- fuel --------------------------------------------------------- */

    /** Add one unit of a fuel item. Returns true if it was accepted. */
    addFuel(itemId) {
        const burn = burnValue(itemId);
        if (burn <= 0) return false;
        if (this.fuel >= this.maxFuel) {
            if (this.bus) this.bus.emit("fire:fail", { reason: "full" });
            return false;
        }
        const left = Math.min(burn, this.maxFuel - this.fuel);
        // Fuel carried in the pack is drier than the exposed pile.
        this.damp *= this.fuel / (this.fuel + left);
        this.pieces.push({ id: itemId, left, total: burn, seed: Math.floor(Math.random() * 1000) });
        this.fuel = Math.min(this.maxFuel, this.fuel + burn);
        if (this.bus) this.bus.emit("fire:fuel", { itemId, fuel: this.fuel, burn });
        return true;
    }

    /**
     * What the pit looks like right now: every piece with how much of it is
     * left (1 = fresh, 0 = ash). Purely descriptive — the renderer owns the
     * drawing, this owns the truth.
     */
    get stack() {
        return this.pieces.map((p) => ({
            id: p.id,
            burn: p.total > 0 ? Math.max(0, Math.min(1, p.left / p.total)) : 0,
            seed: p.seed || 0
        }));
    }

    /** Light it. Needs fuel and something to spark with. */
    light({ hasFlint = true } = {}) {
        this.lastFailure = "";
        if (this.lit) return false;
        if (this.fuel <= 0) {
            if (this.bus) this.bus.emit("fire:fail", { reason: "no_fuel" });
            return false;
        }
        if (!hasFlint) {
            if (this.bus) this.bus.emit("fire:fail", { reason: "no_flint" });
            return false;
        }
        const attempts = this.exposure.ignition + Math.floor(this.damp * 2);
        this.ignitionProgress++;
        if (this.ignitionProgress < attempts) {
            this.lastFailure = `Сырой розжиг: попытка ${this.ignitionProgress}/${attempts}. Прикрой трут и попробуй ещё`;
            if (this.bus) this.bus.emit("fire:fail", { reason: "weather", text: this.lastFailure });
            return false;
        }
        this.ignitionProgress = 0;
        this.lastFailure = "";
        this.lit = true;
        if (this.bus) this.bus.emit("fire:lit", {});
        return true;
    }

    extinguish(reason = "out") {
        if (!this.lit) return false;
        this.lit = false;
        if (this.bus) this.bus.emit("fire:out", { reason });
        return true;
    }

    /**
     * 0..1 — how strongly it is burning. Full blaze while there is real fuel
     * left, then it sinks to embers over the last ten in-game minutes instead
     * of snapping out.
     */
    get intensity() {
        if (!this.lit) return 0;
        const FADE = 600;                       // in-game seconds of dying down
        const strength = this.exposure.heat * (1 - this.damp * 0.45);
        if (this.fuel > FADE) return strength;
        return Math.max(0.12, this.fuel / FADE * strength);
    }

    get warmth() { return this.intensity * 26; }      // °C added at the fire
    get lightRadius() { return this.lit ? 90 + this.intensity * 70 : 0; }

    /* ---- cooking ------------------------------------------------------- */

    /** Put an item on the spit / in the embers. Returns the slot index or -1. */
    putOnSpit(itemId) {
        const idx = this.spit.indexOf(null);
        if (idx === -1) return -1;
        this.spit[idx] = new CookSlot(itemId);
        if (this.bus) this.bus.emit("cook:start", { itemId, where: "spit", slot: idx });
        return idx;
    }

    putInEmbers(itemId) {
        const idx = this.embers.indexOf(null);
        if (idx === -1) return -1;
        const slot = new CookSlot(itemId);
        slot.cookTime *= 1.4;      // slower, but far more forgiving
        this.embers[idx] = slot;
        if (this.bus) this.bus.emit("cook:start", { itemId, where: "embers", slot: idx });
        return idx;
    }

    /** Take whatever is in a slot; returns { id, state } or null. */
    takeFromSpit(idx) { return this._take(this.spit, idx, "spit"); }
    takeFromEmbers(idx) { return this._take(this.embers, idx, "embers"); }

    _take(arr, idx, where) {
        const slot = arr[idx];
        if (!slot) return null;
        arr[idx] = null;
        const id = slot.ready ? slot.result : slot.itemId;
        if (slot.state === COOK_STATE.BURNT) this.ashes += 1;
        if (this.bus) this.bus.emit("cook:take", { id, state: slot.state, where });
        return { id, state: slot.state };
    }

    /** Everything that is finished, collected in one go. */
    collectReady() {
        const out = [];
        [["spit", this.spit], ["embers", this.embers]].forEach(([where, arr]) => {
            arr.forEach((slot, i) => {
                if (slot && slot.ready) {
                    const got = this._take(arr, i, where);
                    if (got) out.push(got);
                }
            });
        });
        return out;
    }

    /* ---- the pot (unlocked by crafting one) ---------------------------- */

    installPot() { this.hasPot = true; return this; }

    /** Start a pot: 1–3 ingredients plus optional water. Returns the match or null. */
    startPot(itemIds, { water = true } = {}) {
        if (!this.hasPot) return null;
        if (this.pot) return null; // an uncollected dish must not be overwritten
        if (!Array.isArray(itemIds) || itemIds.length < 1 || itemIds.length > 3) return null;
        const match = resolvePot(itemIds, water);
        if (!match) {
            if (this.bus) this.bus.emit("cook:fail", { itemIds, reason: "no_match" });
            return null;
        }
        this.pot = { ingredients: itemIds.slice(), water, progress: 0, time: match.time,
                     result: match.id, name: match.name, done: false };
        if (this.bus) this.bus.emit("cook:pot_start", { result: match.id, name: match.name });
        return this.pot;
    }

    takePot() {
        if (!this.pot || !this.pot.done) return null;
        const res = this.pot.result;
        this.pot = null;
        if (this.bus) this.bus.emit("cook:pot_take", { id: res });
        return res;
    }

    /* ---- per-tick ------------------------------------------------------ */

    /**
     * @param {number} dt in-game seconds.
     * Integrated in sub-steps so that a single large dt (sleeping, loading a
     * save) burns fuel and cooks food exactly like many small frames would.
     */
    setExposure(environment) { this.exposure = fireExposure(environment); return this; }

    update(dt, environment = null) {
        if (environment) this.setExposure(environment);
        if (!Number.isFinite(dt) || dt <= 0) return this;
        const MAX = 5;
        while (dt > MAX) { this._step(MAX); dt -= MAX; }
        return this._step(dt);
    }

    _step(dt) {
        this.flicker += dt;
        // A well-fed blaze dries itself; a dying fire can be drowned by rain.
        const drying = this.lit && this.fuel > 900 ? 0.00065 : 0.00006;
        this.damp = Math.max(0, Math.min(1, this.damp + dt * (this.exposure.rain * 0.0008 - drying)));
        if (this.lit && this.exposure.rain > 0.4 && this.fuel < 600 && this.damp > 0.3) this.extinguish("rain");
        if (this.lit) {
            // Burn through the pile piece by piece, oldest first.
            const burn = dt * this.exposure.burn;
            let rest = burn;
            while (rest > 0 && this.pieces.length) {
                const piece = this.pieces[0];
                const used = Math.min(rest, piece.left);
                piece.left -= used;
                rest -= used;
                if (piece.left <= 0.0001) {
                    this.pieces.shift();
                    this.ashes += 1;
                }
            }
            this.fuel = Math.max(0, this.fuel - burn);
            if (this.fuel <= 0 || !this.pieces.length) {
                this.fuel = 0;
                this.pieces.length = 0;
                this.ashes += 1;
                this.extinguish("burned_out");
            }
        }
        const heat = this.intensity;
        for (const s of this.spit) if (s) s.update(dt, heat);
        for (const s of this.embers) if (s) s.update(dt, heat * 0.85);
        if (this.pot && !this.pot.done && heat > 0) {
            this.pot.progress += dt * heat;
            if (this.pot.progress >= this.pot.time) {
                this.pot.done = true;
                if (this.bus) this.bus.emit("cook:pot_done", { id: this.pot.result, name: this.pot.name });
            }
        }
        return this;
    }

    /** Short status line for the interaction prompt. */
    status() {
        if (!this.lit) return this.fuel > 0 ? "Костёр готов к розжигу" : "Холодное кострище";
        const mins = Math.ceil(this.fuel / (60 * this.exposure.burn));
        if (mins >= 60) {
            const h = Math.floor(mins / 60);
            return `Горит · топлива на ~${h} ч ${mins % 60} мин`;
        }
        return `Горит · топлива на ~${mins} мин`;
    }

    toJSON() {
        return {
            damp: this.damp, ignitionProgress: this.ignitionProgress,
            lit: this.lit, fuel: this.fuel, hasPot: this.hasPot, ashes: this.ashes,
            pieces: this.pieces.map((p) => ({ id: p.id, left: p.left, total: p.total, seed: p.seed })),
            spit: this.spit.map((s) => (s ? s.toJSON() : null)),
            embers: this.embers.map((s) => (s ? s.toJSON() : null)),
            pot: this.pot
        };
    }

    load(d) {
        if (!d) return this;
        this.damp = Number.isFinite(d.damp) ? Math.max(0, Math.min(1, d.damp)) : 0;
        this.ignitionProgress = Number.isFinite(d.ignitionProgress) ? Math.floor(Math.max(0, Math.min(5, d.ignitionProgress))) : 0;
        this.lit = !!d.lit; this.fuel = d.fuel || 0; this.hasPot = !!d.hasPot; this.ashes = d.ashes || 0;
        this.pieces = (d.pieces || []).map((p) => ({ id: p.id, left: p.left, total: p.total, seed: p.seed || 0 }));
        // Saves from before the pile existed: rebuild one anonymous piece.
        if (!this.pieces.length && this.fuel > 0) {
            this.pieces.push({ id: "firewood", left: this.fuel, total: this.fuel, seed: 0 });
        }
        this.spit = (d.spit || []).map((s) => (s ? CookSlot.fromJSON(s) : null));
        this.embers = (d.embers || []).map((s) => (s ? CookSlot.fromJSON(s) : null));
        this.pot = d.pot || null;
        return this;
    }
}
