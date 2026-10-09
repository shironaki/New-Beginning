/**
 * survival — body needs: сытость, тепло, усталость, здоровье, дух.
 *
 * Difficulty is "средняя" (the owner's choice): hunger and cold really do
 * kill, but death is not a game over — `onCollapse` hands control back to the
 * story system, which wakes the hero at camp, poorer and injured.
 *
 * All rates are per in-game MINUTE, so they are independent of frame rate and
 * of how fast the clock runs.
 */
import { healthEffects, NEED_RATES } from "./condition.js";
import { feltWarmth, warmthBand } from "./temperature.js";

export const DIFFICULTY = {
    soft:   { drain: 0.7, damage: 0.4, label: "Мягкое" },
    normal: { drain: 1.0, damage: 1.0, label: "Среднее" },
    hard:   { drain: 1.35, damage: 1.8, label: "Хардкор" }
};

export class Needs {
    constructor({ bus = null, difficulty = "normal" } = {}) {
        this.bus = bus;
        this.difficulty = difficulty;
        this.food = 80;        // 100 = сыт
        this.warmth = 50;      // 50 = комфортно
        this.fatigue = 10;     // 100 = валится с ног
        this.health = 100;
        this.spirit = 60;      // дух: падает в одиночестве и голоде, растёт у огня и с людьми
        this.wet = 0;          // 0..1
        this.alive = true;
        this._warned = new Set();
        this._dmgAcc = 0;
    }

    get diff() { return DIFFICULTY[this.difficulty] || DIFFICULTY.normal; }

    /**
     * @param {number} minutes in-game minutes elapsed
     * @param {object} ctx { ambient, fireWarmth, insulation, sheltered, sleeping, activity }
     */
    update(minutes, ctx = {}) {
        if (minutes <= 0 || !this.alive) return this;
        const d = this.diff;
        const sleeping = !!ctx.sleeping;
        const activity = ctx.activity || (sleeping ? 0.35 : 1);

        // --- hunger -------------------------------------------------------
        const hungerRate = NEED_RATES.hunger * d.drain * activity;
        this.food = clamp(this.food - hungerRate * minutes, 0, 100);

        // --- fatigue ------------------------------------------------------
        if (sleeping) this.fatigue = clamp(this.fatigue - NEED_RATES.sleepRest * minutes, 0, 100);
        else this.fatigue = clamp(this.fatigue + NEED_RATES.fatigue * activity * d.drain * minutes, 0, 100);

        // --- warmth: drift toward what the body actually feels ------------
        const target = feltWarmth({
            ambient: ctx.ambient !== undefined ? ctx.ambient : 14,
            fireWarmth: ctx.fireWarmth || 0,
            insulation: ctx.insulation || 0,
            sheltered: !!ctx.sheltered,
            wet: this.wet > 0.3,
            moving: activity > 0.8 && !sleeping
        });
        const k = Math.min(1, 0.05 * minutes);    // the body changes temperature slowly
        this.warmth += (target - this.warmth) * k;
        this.warmth = clamp(this.warmth, 0, 100);

        // Drying off near a fire or under a roof.
        if (this.wet > 0) {
            const dry = (ctx.fireWarmth ? 0.02 : ctx.sheltered ? 0.01 : 0.004) * minutes;
            this.wet = clamp(this.wet - dry, 0, 1);
        }

        // --- health -------------------------------------------------------
        const healthRate = healthEffects(this, sleeping).reduce((sum, e) => sum + e.rate, 0);
        this.health = clamp(this.health + healthRate * minutes, 0, 100);

        // --- spirit -------------------------------------------------------
        let mood = 0;
        if (ctx.fireWarmth > 4) mood += 0.02;
        if (ctx.company) mood += 0.03;
        if (this.food < 20) mood -= 0.03;
        if (this.warmth < 25) mood -= 0.03;
        if (this.health < 40) mood -= 0.02;
        if (sleeping) mood += 0.02;
        this.spirit = clamp(this.spirit + mood * minutes, 0, 100);

        this._checkWarnings();
        if (this.health <= 0 && this.alive) {
            this.alive = false;
            if (this.bus) this.bus.emit("player:collapse", { cause: this.worstNeed() });
        }
        return this;
    }

    _checkWarnings() {
        const fire = (key, cond, payload) => {
            if (cond && !this._warned.has(key)) {
                this._warned.add(key);
                if (this.bus) this.bus.emit("needs:warn", Object.assign({ key }, payload));
            } else if (!cond) this._warned.delete(key);
        };
        fire("hungry", this.food < 30, { text: "Живот подводит от голода", icon: "🍖" });
        fire("starving", this.food < 8, { text: "Ты голодаешь", icon: "💀", severe: true });
        fire("cold", this.warmth < 28, { text: "Холод пробирает до костей", icon: "🥶" });
        fire("freezing", this.warmth < 12, { text: "Ты замерзаешь насмерть", icon: "❄️", severe: true });
        fire("tired", this.fatigue > 75, { text: "Глаза слипаются", icon: "😴" });
        fire("hurt", this.health < 30, { text: "Раны дают о себе знать", icon: "🩸", severe: true });
    }

    /** Which need is in the worst shape — used for death text and the HUD pulse. */
    worstNeed() {
        const list = [
            { key: "food", v: this.food },
            { key: "warmth", v: this.warmth },
            { key: "health", v: this.health },
            { key: "fatigue", v: 100 - this.fatigue }
        ];
        list.sort((a, b) => a.v - b.v);
        return list[0].key;
    }

    /** Movement multiplier: hunger, cold and exhaustion all slow you down. */
    speedFactor() {
        let f = 1;
        if (this.food < 25) f -= 0.18 * (1 - this.food / 25);
        if (this.fatigue > 70) f -= 0.22 * ((this.fatigue - 70) / 30);
        if (this.warmth < 25) f -= 0.15 * (1 - this.warmth / 25);
        if (this.health < 35) f -= 0.15 * (1 - this.health / 35);
        return Math.max(0.42, f);
    }

    /** Eat an item payload from items.foodValue(). */
    consume({ food = 0, warmth = 0, heal = 0, spirit = 0 } = {}) {
        this.food = clamp(this.food + food, 0, 100);
        this.warmth = clamp(this.warmth + warmth * 0.5, 0, 100);
        this.health = clamp(this.health + heal, 0, 100);
        this.spirit = clamp(this.spirit + spirit, 0, 100);
        if (this.bus) this.bus.emit("needs:consume", { food, warmth, heal, spirit });
        return this;
    }

    rest(minutes) { this.fatigue = clamp(this.fatigue - 0.25 * minutes, 0, 100); return this; }

    /** Revive after a collapse: alive again, but weakened. */
    revive() {
        this.alive = true;
        this.health = 35;
        this.food = Math.max(this.food, 30);
        this.warmth = 50;
        this.fatigue = Math.min(this.fatigue, 60);
        this.spirit = Math.max(0, this.spirit - 15);
        this._warned.clear();
        return this;
    }

    band() { return warmthBand(this.warmth); }

    toJSON() {
        return { food: this.food, warmth: this.warmth, fatigue: this.fatigue,
                 health: this.health, spirit: this.spirit, wet: this.wet,
                 alive: this.alive, difficulty: this.difficulty };
    }
    load(d) { if (d) Object.assign(this, d); this._warned = new Set(); return this; }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
