/**
 * world — weather.
 *
 * Weather is rolled once per day (plus an afternoon re-roll) from the season's
 * table, deterministically from the world seed, so the forecast on a notice
 * board can promise tomorrow honestly. It feeds temperature, visibility,
 * fire behaviour and mood.
 */
import { RNG, mixSeeds } from "../core/rng.js";
import { advanceWet, clampWet } from "./surface.js";

export const WEATHER = {
    clear:  { name: "Ясно",     emoji: "☀️", vis: 1,    wet: 0 },
    cloudy: { name: "Облачно",  emoji: "⛅",  vis: 0.95, wet: 0 },
    rain:   { name: "Дождь",    emoji: "🌧️", vis: 0.8,  wet: 0.6 },
    storm:  { name: "Гроза",    emoji: "⛈️", vis: 0.65, wet: 0.9 },
    fog:    { name: "Туман",    emoji: "🌫️", vis: 0.55, wet: 0.2 },
    snow:   { name: "Снег",     emoji: "❄️", vis: 0.7,  wet: 0.3 },
    wind:   { name: "Ветрено",  emoji: "🌬️", vis: 0.95, wet: 0 }
};

const TABLES = {
    spring: [["clear", 32], ["cloudy", 26], ["rain", 24], ["fog", 10], ["storm", 5], ["wind", 3]],
    summer: [["clear", 46], ["cloudy", 22], ["rain", 14], ["storm", 10], ["wind", 6], ["fog", 2]],
    autumn: [["cloudy", 30], ["rain", 26], ["clear", 20], ["fog", 14], ["wind", 7], ["storm", 3]],
    winter: [["snow", 38], ["cloudy", 26], ["clear", 20], ["fog", 9], ["wind", 7]]
};

export class WeatherSystem {
    constructor({ bus = null, seed = 1, clock = null } = {}) {
        this.bus = bus;
        this.seed = seed;
        this.clock = clock;
        this.current = "clear";
        this.tomorrow = "clear";
        this.windAngle = 0;
        this.groundWet = 0;
        if (clock) this.rollForDay(clock.day, clock.season.key);
        if (bus) {
            bus.on("time:newday", ({ day, season }) => this.rollForDay(day, season));
        }
    }

    /** Deterministic roll: same seed + day → same sky. */
    pick(day, season) {
        const rng = new RNG(mixSeeds(this.seed, day, 4242));
        const table = TABLES[season] || TABLES.spring;
        return rng.weighted(table) || "clear";
    }

    rollForDay(day, season) {
        this.current = this.pick(day, season);
        this.tomorrow = this.pick(day + 1, season);
        this.windAngle = new RNG(mixSeeds(this.seed, day, 99)).range(0, Math.PI * 2);
        if (this.bus) this.bus.emit("weather:change", { weather: this.current, info: this.info });
        return this.current;
    }

    get info() { return WEATHER[this.current] || WEATHER.clear; }
    get wetness() { return this.info.wet; }
    get visibility() { return this.info.vis; }
    get isWet() { return this.info.wet > 0.4; }
    /** A fire outdoors in heavy rain burns down faster. */
    get fuelPenalty() { return this.current === "storm" ? 2.2 : this.current === "rain" ? 1.5 : 1; }

    forecastText() {
        const t = WEATHER[this.tomorrow] || WEATHER.clear;
        return `Завтра: ${t.emoji} ${t.name}`;
    }

    updateSurface(minutes) {
        this.groundWet = advanceWet(this.groundWet, minutes, this.current, this.clock?.season.key);
        return this;
    }

    toJSON() { return { current: this.current, tomorrow: this.tomorrow, groundWet: this.groundWet }; }
    load(d) {
        if (d) {
            this.current = d.current || "clear";
            this.tomorrow = d.tomorrow || "clear";
            // Old saves predate ground moisture and start dry.
            this.groundWet = clampWet(d.groundWet);
        }
        return this;
    }
}
