/**
 * survival — thermal model.
 *
 * Cold is the prologue's real antagonist. Ambient temperature comes from the
 * season, the hour, the weather and the biome; what the body actually feels
 * also depends on the fire, clothing, a roof overhead and whether you are wet.
 */
import { SEASONS } from "../core/time.js";

export const WEATHER_TEMP = {
    clear: 2, cloudy: 0, rain: -4, storm: -6, fog: -2, snow: -8, wind: -3
};

/**
 * Outdoor temperature in °C.
 * @param {object} p
 * @param {string} p.season   season key
 * @param {number} p.daylight 0..1 from the clock
 * @param {string} p.weather  weather key
 * @param {number} p.biomeTemp biome offset (the pass is brutal, the shore mild)
 * @param {boolean} p.underground caves sit at a steady ~8 °C
 */
export function ambientTemperature({ season = "spring", daylight = 1, weather = "clear", biomeTemp = 0, underground = false } = {}) {
    if (underground) return 8 + biomeTemp * 0.2;
    const s = SEASONS.find((x) => x.key === season) || SEASONS[0];
    const solar = -7 + daylight * 14;                  // night is ~7° colder than the daily mean
    const w = WEATHER_TEMP[weather] !== undefined ? WEATHER_TEMP[weather] : 0;
    return Math.round((s.baseTemp + solar + w + biomeTemp) * 10) / 10;
}

/**
 * Perceived warmth target on the 0..100 body scale.
 * 50 = comfortable, <20 = dangerous cold, >85 = overheating.
 */
export function feltWarmth({ ambient = 10, fireWarmth = 0, insulation = 0, sheltered = false, wet = false, moving = false } = {}) {
    let t = ambient + fireWarmth + insulation;
    if (sheltered) t += 5;              // a roof cuts wind chill
    if (wet) t -= 6;
    if (moving) t += 2;                 // working keeps you warmer
    // Map °C to the 0..100 comfort scale: 18 °C ≈ 50.
    const comfort = 50 + (t - 18) * 2.6;
    return Math.max(0, Math.min(100, comfort));
}

/** Human-readable band, for the HUD tooltip and warnings. */
export function warmthBand(value) {
    if (value < 12) return { key: "freezing", label: "Обморожение", color: "#7fb8ff" };
    if (value < 28) return { key: "cold", label: "Очень холодно", color: "#9fd0ff" };
    if (value < 42) return { key: "chilly", label: "Зябко", color: "#cfe6ff" };
    if (value < 68) return { key: "ok", label: "Тепло", color: "#ffd9a0" };
    if (value < 85) return { key: "warm", label: "Жарко", color: "#ffb06a" };
    return { key: "hot", label: "Перегрев", color: "#ff8a4a" };
}
