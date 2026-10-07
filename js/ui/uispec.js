/**
 * UI — the contract.
 *
 * Every number the interface uses lives here, so the CSS has no magic values
 * and the HUD has no inline styling decisions. The palette is the source of
 * truth: `applyTheme()` writes it onto the document as custom properties, and
 * `css/style.css` only ever reads `var(--…)`.
 *
 * Two rules drive the numbers:
 *   1. contrast — every text/background pair in `CONTRACTS` is checked by
 *      `tests/core.test.js` against WCAG AA (4.5:1 for body text, 3:1 for
 *      large text and UI edges). A survival HUD read at a glance in a dark
 *      room cannot be "almost readable";
 *   2. one scale — type and spacing step in a fixed ratio, and the whole UI
 *      scales with the viewport through `--ui`, so a 4K screen does not show
 *      a 14 px postage stamp and a phone does not show a wall of panels.
 */

/* ========================= palette ========================= */

export const COLORS = {
    ink: "#f3e8d4",          // body text on panels          — 15.1:1
    inkDim: "#c9b795",       // secondary text on panels     —  9.4:1
    gold: "#f0cc8c",         // headings, clock              — 12.0:1
    ember: "#ff9d55",        // warnings, "next" lines       —  8.9:1
    danger: "#ff6b6b",       // a need about to hurt you     —  6.6:1
    panel: "#17140f",        // panel body (opaque base)
    panelEdge: "#d6aa68",    // 1 px edge, used at 35 % alpha
    screen: "#0a0c10",       // the letterbox behind the canvas
    need: {
        food: "#e0a44c",
        warmth: "#ef8243",
        fatigue: "#74b8e6",
        health: "#e05464"
    }
};

/* ========================= scales ========================= */

export const UI = {
    /**
     * Type scale, in `--ui` units (1 unit ≈ 1 px at a 1200 px wide viewport).
     * Ratio ~1.2 — a minor third. Nothing between the steps.
     */
    type: { xs: 11, sm: 12.5, md: 14, lg: 17, xl: 21, xxl: 26 },
    /** Spacing scale, same idea: 4 → 24, no in-between paddings. */
    space: { xs: 4, sm: 6, md: 10, lg: 14, xl: 18, xxl: 24 },
    radius: { sm: 6, md: 10, lg: 14, pill: 999 },
    /** Viewport scaling: `--ui` is clamped between these, 1 at `basisVw`. */
    scale: { min: 0.86, max: 1.35, basisVw: 1200 },
    /** Hit targets never go below this — thumbs and 4K mice both. */
    hit: 44,
    slot: { size: 52, sizeSmall: 44, gap: 8 },
    /** Need bars. */
    bar: { height: 9, low: 25, critical: 12, pulseMs: 1100 },
    /** Toasts. */
    toast: { ms: 3200, fadeMs: 400, max: 4 },
    /** Device pixel ratio is honoured up to here — above it the gain is nil
     *  and the fill rate is not. */
    dprCap: 2,
    /** The world keeps its apparent size on any DPI: zoom is multiplied. */
    baseZoom: 2.4
};

/**
 * Pairs that must pass WCAG. `min` is the required ratio: 4.5 for body text,
 * 3 for large text (≥ 19 px) and for the edges of controls.
 */
export const CONTRACTS = [
    { name: "body text on panel", fg: COLORS.ink, bg: COLORS.panel, min: 4.5 },
    { name: "secondary text on panel", fg: COLORS.inkDim, bg: COLORS.panel, min: 4.5 },
    { name: "heading on panel", fg: COLORS.gold, bg: COLORS.panel, min: 4.5 },
    { name: "ember note on panel", fg: COLORS.ember, bg: COLORS.panel, min: 4.5 },
    { name: "danger on panel", fg: COLORS.danger, bg: COLORS.panel, min: 4.5 },
    { name: "food bar on panel", fg: COLORS.need.food, bg: COLORS.panel, min: 3 },
    { name: "warmth bar on panel", fg: COLORS.need.warmth, bg: COLORS.panel, min: 3 },
    { name: "rest bar on panel", fg: COLORS.need.fatigue, bg: COLORS.panel, min: 3 },
    { name: "health bar on panel", fg: COLORS.need.health, bg: COLORS.panel, min: 3 }
];

/* ========================= helpers ========================= */

function channel(c) {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Relative luminance of a #rrggbb colour, per WCAG 2.1. */
export function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255)
         + 0.7152 * channel((n >> 8) & 255)
         + 0.0722 * channel(n & 255);
}

/** Contrast ratio between two #rrggbb colours: 1 (same) … 21 (black/white). */
export function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
}

/**
 * Write the contract onto the document root as custom properties. The CSS
 * then reads `var(--ink)`, `var(--t-md)`, `var(--s-lg)` and never hard-codes
 * a colour or a size of its own.
 */
export function applyTheme(doc = typeof document !== "undefined" ? document : null) {
    if (!doc || !doc.documentElement || !doc.documentElement.style) return false;
    const s = doc.documentElement.style;
    const set = (k, v) => s.setProperty(k, v);
    set("--ink", COLORS.ink);
    set("--ink-dim", COLORS.inkDim);
    set("--gold", COLORS.gold);
    set("--ember", COLORS.ember);
    set("--danger", COLORS.danger);
    set("--panel", COLORS.panel);
    set("--panel-edge", COLORS.panelEdge);
    set("--screen", COLORS.screen);
    for (const [k, v] of Object.entries(COLORS.need)) set(`--need-${k}`, v);
    for (const [k, v] of Object.entries(UI.type)) set(`--t-${k}`, `calc(${v} * var(--ui))`);
    for (const [k, v] of Object.entries(UI.space)) set(`--s-${k}`, `calc(${v} * var(--ui))`);
    for (const [k, v] of Object.entries(UI.radius)) set(`--r-${k}`, k === "pill" ? `${v}px` : `calc(${v} * var(--ui))`);
    set("--hit", `calc(${UI.hit} * var(--ui))`);
    set("--slot", `calc(${UI.slot.size} * var(--ui))`);
    set("--slot-gap", `calc(${UI.slot.gap} * var(--ui))`);
    set("--bar-h", `calc(${UI.bar.height} * var(--ui))`);
    set("--pulse-ms", `${UI.bar.pulseMs}ms`);
    return true;
}

/**
 * Backing-store size for a canvas on this display. Capped, because past 2×
 * the extra pixels cost fill rate and buy nothing on a pixel-art frame.
 */
export function pixelRatio(win = typeof window !== "undefined" ? window : null) {
    const raw = win && win.devicePixelRatio ? win.devicePixelRatio : 1;
    return Math.max(1, Math.min(UI.dprCap, raw));
}
