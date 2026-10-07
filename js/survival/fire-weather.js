/** Outdoor fire exposure. Rates are per GAME second, independent of frame rate. */
export function fireExposure({ weather = "clear", season = "spring", sheltered = false } = {}) {
    if (sheltered) return { rain: 0, burn: 1, heat: 1, ignition: 1, label: "Под укрытием" };
    const rain = weather === "storm" ? 1 : weather === "rain" ? 0.65 : weather === "snow" ? 0.15 : 0;
    const cold = season === "winter" ? 0.12 : 0;
    return {
        rain,
        burn: 1 + rain * 0.8 + (weather === "wind" ? 0.25 : 0) + cold,
        heat: Math.max(0.28, 1 - rain * 0.5 - cold),
        ignition: weather === "storm" ? 4 : weather === "rain" ? 3 : season === "winter" || weather === "wind" ? 2 : 1,
        label: rain > 0.4 ? "Осадки гасят пламя · сырой розжиг" : cold ? "Мороз · нужно больше топлива" : weather === "wind" ? "Ветер раздувает угли" : "Сухая погода"
    };
}
