/**
 * render — light map.
 *
 * Darkness is a BUFFER, never a flat veil over the frame:
 *
 *   1. the buffer is filled with the hour's ambient colour, pre-mixed towards
 *      white by its strength, so compositing it with `multiply` darkens the
 *      scene without washing its hue away (a veil turns grass grey; multiply
 *      keeps it green, only dimmer);
 *   2. light sources are punched out of the buffer with `destination-out`,
 *      which leaves those pixels fully transparent — and a transparent pixel
 *      in a multiply pass changes nothing, so lit ground keeps its day colour;
 *   3. a third additive pass lays a warm halo over fires so they feel hot
 *      instead of merely "less dark".
 *
 * Every number lives in `LIGHT` below. Nothing in this file is "about right":
 * the hour curve is a 24-entry lookup table interpolated with a sine ease, so
 * dusk fades instead of clicking from one hard-coded colour to another.
 *
 * Zero allocations per frame: the radial falloffs are baked once into small
 * offscreen sprites and only ever blitted with `drawImage`.
 */

/* ========================= the contract ========================= */

export const LIGHT = {
    /**
     * One entry per hour, 00:00 → 23:00. `hex` is the colour the world is
     * tinted towards, `a` is how strongly (0 = untouched daylight).
     * Neighbouring hours never differ by more than 0.16 alpha, so no step in
     * the ramp is visible at the clock's speed.
     */
    lut: [
        { hex: "#070a1c", a: 0.86 },   // 00
        { hex: "#070a1c", a: 0.86 },   // 01
        { hex: "#070a1c", a: 0.85 },   // 02
        { hex: "#080b1e", a: 0.83 },   // 03
        { hex: "#0b0f26", a: 0.80 },   // 04
        { hex: "#1b1630", a: 0.62 },   // 05  first grey light
        { hex: "#2a1430", a: 0.38 },   // 06  dawn, warm
        { hex: "#3a2033", a: 0.18 },   // 07
        { hex: "#3a2a2e", a: 0.06 },   // 08
        { hex: "#000000", a: 0.00 },   // 09  full day
        { hex: "#000000", a: 0.00 },   // 10
        { hex: "#000000", a: 0.00 },   // 11
        { hex: "#000000", a: 0.00 },   // 12
        { hex: "#000000", a: 0.00 },   // 13
        { hex: "#000000", a: 0.00 },   // 14
        { hex: "#000000", a: 0.00 },   // 15
        { hex: "#000000", a: 0.00 },   // 16
        { hex: "#201a24", a: 0.04 },   // 17
        { hex: "#2a1430", a: 0.14 },   // 18  sun on the horizon
        { hex: "#2a1430", a: 0.30 },   // 19  dusk, warm
        { hex: "#1b1630", a: 0.55 },   // 20
        { hex: "#0d1126", a: 0.74 },   // 21
        { hex: "#080b1e", a: 0.82 },   // 22
        { hex: "#070a1c", a: 0.85 }    // 23
    ],
    /** Extra darkness per weather, added on top of the hour. */
    weather: { rain: 0.10, storm: 0.18, fog: 0.08, snow: 0.04 },
    /** Fog also lays a pale veil, otherwise it reads as "night at noon". */
    fogVeil: 0.06,
    fogHex: "#b9c2c8",
    /**
     * Moonlight. Night must READ as night, not as a switched-off monitor:
     * a cool additive lift keeps silhouettes visible while staying clearly
     * colder and dimmer than any flame. Clouds eat it, the phase paces it.
     */
    moon: {
        hex: [150, 176, 226],
        peak: 0.21,        // α of the lift at a clear full moon, deep night
        rise: 0.42,        // ambient alpha where moonlight starts to count
        phaseDays: 29,     // synodic month, for the waxing/waning cycle
        phaseFloor: 0.5,  // even a new moon leaves this much skyglow
        cloud: { clear: 1, wind: 0.95, cloudy: 0.45, fog: 0.3, snow: 0.35, rain: 0.2, storm: 0.08 }
    },
    /** Caves: a torch is still far brighter, but the eye adjusts. */
    /** Caves: dark, but the gallery must still be legible without a torch —
     *  a black screen is not atmosphere, it is a bug report. */
    underground: { hex: "#0c1018", a: 0.54, aTorch: 0.68 },
    /** Never crush the frame to black: the darkest pixel keeps this much. */
    floor: 0.14,
    /** Below this the buffer is not even built. */
    skip: 0.015,
    /** Baked falloff sprites. */
    sprite: 128,
    /** Named sources, so callers stop inventing radii. */
    presets: {
        campfire: { r: 118, i: 1.0, warmth: 0.85, flicker: 1 },
        torch: { r: 84, i: 0.9, warmth: 0.8, flicker: 1 },
        window: { r: 60, i: 0.7, warmth: 0.5, flicker: 0 },
        caveEye: { r: 130, i: 0.8, warmth: 0.3, flicker: 0, torchDim: 0.4 }
    },
    /** Warm halo pass. */
    halo: { alpha: 0.44, scale: 0.62, warm: [255, 142, 56], cool: [196, 216, 255] },
    /** The hot core right over the embers: small, bright, always warm. */
    core: { alpha: 0.34, scale: 0.22 },
    /** A hole in the darkness is never a hole in the night: keep this much
     *  of the ambient inside the lit pool so it reads as firelight on dark
     *  ground, not as a patch of daylight. */
    cutoutMax: 0.86,
    /** Flicker: two detuned sines, never a random jitter (that reads as noise). */
    flicker: { depth: 0.06, depth2: 0.05, speed: 9, speed2: 15.7, intensity: 0.07 }
};

/* ========================= helpers ========================= */

function parseHex(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a, b, t) { return a + (b - a) * t; }

/** The same ease the character uses — one curve for the whole project. */
function ease(t) { return 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2; }

/**
 * Ambient for a moment of the day.
 * @param {number} hour 0..24, fractional
 * @returns {{rgb:number[], alpha:number}}
 */
export function ambientAt(hour, weather = "clear", underground = false, torch = false) {
    if (underground) {
        // Carrying a flame, the gallery around it goes darker: that is what
        // makes the torch feel like the thing holding the dark back.
        const u = LIGHT.underground;
        return { rgb: parseHex(u.hex), alpha: torch ? u.aTorch : u.a };
    }
    const h = ((hour % 24) + 24) % 24;
    const i = Math.floor(h), j = (i + 1) % 24;
    const t = ease(h - i);
    const A = LIGHT.lut[i], B = LIGHT.lut[j];
    const ca = parseHex(A.hex), cb = parseHex(B.hex);
    let alpha = lerp(A.a, B.a, t);
    // A colour with alpha 0 carries no hue — do not drag the other end of the
    // ramp towards black just because midday is stored as #000000.
    const wa = A.a <= 0.001 ? 0 : 1, wb = B.a <= 0.001 ? 0 : 1;
    const mix = (wa === 0 && wb === 0) ? 0 : (wa === 0 ? 1 : (wb === 0 ? 0 : t));
    const rgb = [lerp(ca[0], cb[0], mix), lerp(ca[1], cb[1], mix), lerp(ca[2], cb[2], mix)];
    alpha = Math.min(0.9, alpha + (LIGHT.weather[weather] || 0));
    return { rgb, alpha };
}

/**
 * Backwards-compatible entry point for callers that only know `daylight`
 * (0 = midnight, 1 = noon). Maps onto the same table through the dusk side,
 * which is the half players actually watch.
 */
export function ambientFor(daylight, weather = "clear", underground = false) {
    const hour = underground ? 0 : 22 - Math.min(1, Math.max(0, daylight)) * 9.5;
    const a = ambientAt(hour, weather, underground);
    const hex = "#" + a.rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
    return { color: hex, alpha: a.alpha };
}

/** Bake a radial falloff once; afterwards lights cost one drawImage each. */
function bakeSprite(stops) {
    if (typeof document === "undefined") return null;
    const S = LIGHT.sprite;
    let cv, c;
    try {
        cv = document.createElement("canvas");
        cv.width = cv.height = S;
        c = cv.getContext("2d");
    } catch { return null; }
    if (!c || typeof c.createRadialGradient !== "function") return null;
    const g = c.createRadialGradient(S / 2, S / 2, S * 0.04, S / 2, S / 2, S / 2);
    for (const [at, color] of stops) g.addColorStop(at, color);
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    return cv;
}

let CUTOUT = null, HALO_WARM = null, HALO_COOL = null, BAKED = false;

function bakeAll() {
    if (BAKED) return;
    BAKED = true;
    CUTOUT = bakeSprite([
        // Steep: a fire lights a circle, it does not fog half the valley.
        [0, "rgba(0,0,0,1)"], [0.22, "rgba(0,0,0,0.86)"],
        [0.46, "rgba(0,0,0,0.5)"], [0.7, "rgba(0,0,0,0.18)"],
        [0.88, "rgba(0,0,0,0.05)"], [1, "rgba(0,0,0,0)"]
    ]);
    const warm = LIGHT.halo.warm, cool = LIGHT.halo.cool;
    HALO_WARM = bakeSprite([
        [0, `rgba(${warm[0]},${warm[1]},${warm[2]},1)`],
        [0.5, `rgba(${warm[0]},${warm[1] - 12},${warm[2] - 12},0.45)`],
        [1, `rgba(${warm[0]},${warm[1]},${warm[2]},0)`]
    ]);
    HALO_COOL = bakeSprite([
        [0, `rgba(${cool[0]},${cool[1]},${cool[2]},1)`],
        [0.5, `rgba(${cool[0]},${cool[1]},${cool[2]},0.4)`],
        [1, `rgba(${cool[0]},${cool[1]},${cool[2]},0)`]
    ]);
}

/**
 * How much moonlight a given night gets: 0 at a new moon, 1 at a full one,
 * never below `phaseFloor` because the sky itself glows a little.
 * Purely visual — the simulation never reads this.
 */
export function moonFactor(day = 0) {
    const m = LIGHT.moon;
    const ph = (((day % m.phaseDays) + m.phaseDays) % m.phaseDays) / m.phaseDays;
    const lit = 0.5 - Math.cos(ph * Math.PI * 2) / 2;      // 0 → 1 → 0
    return m.phaseFloor + (1 - m.phaseFloor) * lit;
}

/* ========================= the light map ========================= */

export class LightMap {
    constructor(width, height) {
        this.canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
        this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
        this.resize(width, height);
        this.lights = [];
        this._pool = [];
        bakeAll();
    }

    resize(w, h) {
        this.width = w; this.height = h;
        if (this.canvas) { this.canvas.width = w; this.canvas.height = h; }
        return this;
    }

    begin() { this.lights.length = 0; return this; }

    /**
     * Queue a light. Screen coordinates, radius in screen pixels.
     * `warmth` 0..1 shifts the glow from pale to firelight-orange.
     * Entries come from a pool: queueing a light allocates nothing.
     */
    add(x, y, radius, { intensity = 1, warmth = 0.7, flicker = 0, phase = 0, glow = 1 } = {}) {
        const n = this.lights.length;
        let L = this._pool[n];
        if (!L) { L = { x: 0, y: 0, radius: 0, intensity: 1, warmth: 0.7, flicker: 0, phase: 0 }; this._pool[n] = L; }
        L.x = x; L.y = y; L.radius = radius;
        L.intensity = intensity; L.warmth = warmth; L.flicker = flicker;
        L.glow = Math.max(0, Math.min(1, glow));
        // The phase must come from the WORLD, not from the screen: keyed off
        // L.x the flicker changed speed whenever the camera moved.
        L.phase = phase;
        this.lights.push(L);
        return this;
    }

    /** Same, by name: `addPreset(x, y, "campfire", zoom)`. */
    addPreset(x, y, name, zoom = 1, intensity = null, phase = 0) {
        const p = LIGHT.presets[name];
        if (!p) return this;
        return this.add(x, y, p.r * zoom, {
            intensity: intensity === null ? p.i : intensity,
            warmth: p.warmth, flicker: p.flicker, phase
        });
    }

    _flick(L, time, salt = 0) {
        if (!L.flicker) return 1;
        const f = LIGHT.flicker;
        const p = L.phase + salt;
        return 1 - f.depth + Math.sin(time * f.speed + p) * f.depth
                 + Math.sin(time * f.speed2 + p * 1.7) * f.depth2;
    }

    /**
     * Composite darkness + lights onto the main context.
     * @param {CanvasRenderingContext2D} target
     */
    render(target, { daylight = 1, hour = null, weather = "clear", underground = false, torch = false, time = 0, day = 0 } = {}) {
        const amb = hour === null
            ? (() => { const a = ambientFor(daylight, weather, underground); const rgb = parseHex(a.color); return { rgb, alpha: a.alpha }; })()
            : ambientAt(hour, weather, underground, torch);
        if (amb.alpha <= LIGHT.skip || !this.ctx) return this;

        const c = this.ctx;
        const S = LIGHT.sprite;
        // Pre-mix towards white: that is what makes this a `multiply` pass and
        // not a grey sheet. `floor` stops the darkest hour from going to pitch.
        const k = Math.min(1 - LIGHT.floor, amb.alpha);
        const r = Math.round(lerp(255, amb.rgb[0], k));
        const g = Math.round(lerp(255, amb.rgb[1], k));
        const b = Math.round(lerp(255, amb.rgb[2], k));

        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
        c.clearRect(0, 0, this.width, this.height);
        c.fillStyle = `rgb(${r},${g},${b})`;
        c.fillRect(0, 0, this.width, this.height);

        // Punch the lights out of the darkness — one blit each, no gradients.
        c.globalCompositeOperation = "destination-out";
        if (CUTOUT) {
            for (const L of this.lights) {
                const fl = this._flick(L, time);
                const rad = Math.max(4, L.radius * fl);
                c.globalAlpha = Math.min(LIGHT.cutoutMax,
                    L.intensity * (1 - LIGHT.flicker.intensity * (1 - fl) * 8));
                c.drawImage(CUTOUT, L.x - rad, L.y - rad, rad * 2, rad * 2);
            }
        }
        c.globalAlpha = 1;
        c.globalCompositeOperation = "source-over";

        target.save();
        target.globalCompositeOperation = "multiply";
        target.drawImage(this.canvas, 0, 0);
        target.restore();

        // Warm halo pass: additive glow so fires feel hot, not just "less dark".
        target.save();
        target.globalCompositeOperation = "lighter";
        for (const L of this.lights) {
            if (L.warmth <= 0) continue;
            const sprite = L.warmth > 0.5 ? HALO_WARM : HALO_COOL;
            if (!sprite) break;
            const rad = L.radius * LIGHT.halo.scale * this._flick(L, time, 1.3);
            target.globalAlpha = Math.min(0.85, LIGHT.halo.alpha * L.intensity * amb.alpha * 1.45 * L.glow);
            target.drawImage(sprite, L.x - rad, L.y - rad, rad * 2, rad * 2);
        }
        // The hot core: a small bright disc over the embers themselves.
        for (const L of this.lights) {
            if (L.warmth <= 0.5 || !HALO_WARM) continue;
            const rad = L.radius * LIGHT.core.scale * this._flick(L, time, 2.1);
            target.globalAlpha = Math.min(0.9, LIGHT.core.alpha * L.intensity * amb.alpha * 1.55 * L.glow);
            target.drawImage(HALO_WARM, L.x - rad, L.y - rad, rad * 2, rad * 2);
        }
        target.globalAlpha = 1;
        target.restore();

        // Moonlight: a cool, even lift so the night is dark BLUE and legible
        // instead of a black screen with one orange hole in it.
        const m = LIGHT.moon;
        if (!underground && amb.alpha > m.rise) {
            const nightK = Math.min(1, (amb.alpha - m.rise) / (0.86 - m.rise));
            const cloud = m.cloud[weather] === undefined ? 1 : m.cloud[weather];
            const a = m.peak * nightK * cloud * moonFactor(day);
            if (a > 0.004) {
                target.save();
                target.globalCompositeOperation = "lighter";
                target.globalAlpha = a;
                target.fillStyle = `rgb(${m.hex[0]},${m.hex[1]},${m.hex[2]})`;
                target.fillRect(0, 0, this.width, this.height);
                target.restore();
            }
        }

        // Fog is a pale veil, not extra night.
        if (weather === "fog") {
            target.save();
            target.globalAlpha = LIGHT.fogVeil;
            target.fillStyle = LIGHT.fogHex;
            target.fillRect(0, 0, this.width, this.height);
            target.restore();
        }
        return this;
    }
}
