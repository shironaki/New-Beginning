/**
 * core — game clock, day phases and seasons.
 *
 * One in-game minute = `realSecondsPerMinute` real seconds (default: a 24h day
 * takes ~16 real minutes). The clock is the heartbeat of survival: temperature,
 * hunger, NPC schedules, crop growth and the story all read from it.
 */

export const MINUTES_PER_DAY = 24 * 60;
export const DAYS_PER_SEASON = 28;

export const SEASONS = [
    { key: "spring", name: "Весна",  emoji: "🌱", baseTemp: 11, dayLength: 1.0 },
    { key: "summer", name: "Лето",   emoji: "☀️", baseTemp: 21, dayLength: 1.15 },
    { key: "autumn", name: "Осень",  emoji: "🍂", baseTemp: 9,  dayLength: 0.95 },
    { key: "winter", name: "Зима",   emoji: "❄️", baseTemp: -6, dayLength: 0.8 }
];

/** Named stretches of the day, used by lighting, NPC AI and spawn rules. */
export const DAY_PHASES = [
    { key: "night",     name: "Глубокая ночь", from: 0,     to: 4 * 60 },
    { key: "dawn",      name: "Рассвет",       from: 4 * 60,  to: 7 * 60 },
    { key: "morning",   name: "Утро",          from: 7 * 60,  to: 11 * 60 },
    { key: "midday",    name: "Полдень",       from: 11 * 60, to: 16 * 60 },
    { key: "afternoon", name: "Вечереет",      from: 16 * 60, to: 19 * 60 },
    { key: "dusk",      name: "Сумерки",       from: 19 * 60, to: 22 * 60 },
    { key: "night2",    name: "Ночь",          from: 22 * 60, to: MINUTES_PER_DAY }
];

export class GameClock {
    /**
     * @param {object} opts
     * @param {EventBus} opts.bus              event bus for hour/day/season signals
     * @param {number}   opts.minute           starting minute of day
     * @param {number}   opts.day              starting day (1-based, counts from world start)
     * @param {number}   opts.realSecondsPerMinute  real seconds per in-game minute
     */
    constructor({ bus = null, minute = 6 * 60, day = 1, realSecondsPerMinute = 0.7 } = {}) {
        this.bus = bus;
        this.minute = minute;
        this.day = day;
        this.realSecondsPerMinute = realSecondsPerMinute;
        this.paused = false;
        this.scale = 1;              // 0 = frozen, 3 = fast-forward (sleeping)
        this._acc = 0;
        this._lastHour = Math.floor(minute / 60);
    }

    /** Advance by real seconds. Returns the number of in-game minutes elapsed. */
    update(dtSeconds) {
        if (this.paused || this.scale <= 0) return 0;
        this._acc += dtSeconds * this.scale;
        const per = this.realSecondsPerMinute;
        let passed = 0;
        while (this._acc >= per) {
            this._acc -= per;
            this.advanceMinutes(1);
            passed++;
        }
        return passed;
    }

    /** Push the clock forward by whole in-game minutes (sleep, cutscenes, tests). */
    advanceMinutes(n = 1) {
        for (let i = 0; i < n; i++) {
            this.minute++;
            if (this.minute >= MINUTES_PER_DAY) {
                this.minute = 0;
                this.day++;
                this._lastHour = -1;
                if (this.bus) {
                    this.bus.emit("time:newday", { day: this.day, season: this.season.key });
                    if ((this.day - 1) % DAYS_PER_SEASON === 0) {
                        this.bus.emit("time:season", { season: this.season.key, name: this.season.name });
                    }
                }
            }
            const h = Math.floor(this.minute / 60);
            if (h !== this._lastHour) {
                this._lastHour = h;
                if (this.bus) this.bus.emit("time:hour", { hour: h, day: this.day });
            }
        }
        return this;
    }

    get hour() { return Math.floor(this.minute / 60); }
    get minuteOfHour() { return this.minute % 60; }
    /** 0 at midnight, 0.5 at noon, wraps at 1. */
    get dayProgress() { return this.minute / MINUTES_PER_DAY; }

    get season() { return SEASONS[Math.floor((this.day - 1) / DAYS_PER_SEASON) % SEASONS.length]; }
    get dayOfSeason() { return ((this.day - 1) % DAYS_PER_SEASON) + 1; }
    get year() { return Math.floor((this.day - 1) / (DAYS_PER_SEASON * SEASONS.length)) + 1; }

    get phase() {
        for (const p of DAY_PHASES) if (this.minute >= p.from && this.minute < p.to) return p;
        return DAY_PHASES[0];
    }

    /** True between dusk and dawn — wolves, cold and darkness. */
    get isNight() { return this.minute < 4 * 60 + 30 || this.minute >= 20 * 60 + 30; }

    /**
     * Daylight strength 0..1 — drives both the light map and solar warmth.
     * Smooth ramps at dawn/dusk instead of a hard switch.
     */
    get daylight() {
        const m = this.minute;
        const dawnStart = 4 * 60, dawnEnd = 7 * 60;
        const duskStart = 19 * 60, duskEnd = 22 * 60;
        if (m < dawnStart || m >= duskEnd) return 0;
        if (m < dawnEnd) return (m - dawnStart) / (dawnEnd - dawnStart);
        if (m < duskStart) return 1;
        return 1 - (m - duskStart) / (duskEnd - duskStart);
    }

    /** "День 3, Весна · 06:30" */
    format() {
        const hh = String(this.hour).padStart(2, "0");
        const mm = String(this.minuteOfHour).padStart(2, "0");
        return `День ${this.day}, ${this.season.name} · ${hh}:${mm}`;
    }

    clockString() {
        return `${String(this.hour).padStart(2, "0")}:${String(this.minuteOfHour).padStart(2, "0")}`;
    }

    toJSON() { return { minute: this.minute, day: this.day, scale: this.scale }; }
    load(data = {}) {
        if (typeof data.minute === "number") this.minute = data.minute;
        if (typeof data.day === "number") this.day = data.day;
        if (typeof data.scale === "number") this.scale = data.scale;
        this._lastHour = this.hour;
        return this;
    }
}
