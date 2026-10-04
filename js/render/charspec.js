/**
 * v3 render — the character visual contract.
 *
 * EVERY number that decides how a person looks or moves lives here. The
 * drawing code in character.js must not contain a single magic literal, and
 * the locomotion code in entities/player.js reads its stride numbers from
 * here too. Change the look by editing this file, never the painter.
 *
 * Units are world units; the camera renders at zoom 2, so 1 unit = 2 screen
 * pixels. Geometry is quantised to QUANT so edges land on whole device
 * pixels instead of smearing across halves.
 *
 * Coordinate frame: the origin is BETWEEN THE FEET, on the ground.
 * Up is negative Y.  Facing "right" is +X.
 *
 *      y  -28  ┌──────┐   head top
 *         -19  ├──────┤   chin / shoulders
 *          -9  ├──────┤   hip
 *           0  └──────┘   ground, feet
 */

/** Quantisation grid: 0.5 u = exactly 1 screen pixel at zoom 2. */
export const QUANT = 0.5;

/** Body proportions — head : body = 1 : 3.1. */
export const BODY = {
    total: 28,

    headH: 9,
    headW: 9,
    headY: -28,              // top of the skull

    torsoY: -19,             // shoulder line
    torsoH: 10,
    shoulderW: 11,           // front/back view
    shoulderWSide: 8.5,      // profile is narrower — that is what sells the turn
    hipW: 7.5,

    hipY: -9,
    legW: 3.4,
    legGap: 1.2,
    thigh: 3.6,
    shin: 3.6,

    ankleY: -2.0,
    bootW: 4.6,
    bootH: 2.4,
    bootToe: 1.4,            // how far the toe sticks out past the ankle
    idleStance: 1.1,         // profile: feet part this much when standing

    armY: -17.5,             // shoulder pivot
    armLen: 8,
    armW: 2.6,
    sleeveW: 1.25,           // the shoulder is wider than the forearm
    handH: 2.2,
    farArmX: 1.4,            // profile: how far the hidden arm peeks out
    nearArmX: 0.8,

    knifeScale: 0.78,        // a belt knife, not a short sword
    gripX: 6.4,              // where a tool sits — the end of the arm, not the face
    gripY: -11
};

/** Palette tokens. Shades are offsets fed to shadeHex(), not separate hexes. */
export const PALETTE = {
    skinLit: 16,
    skinShade: -28,
    skinDeep: -48,           // far-side limb
    shirtLit: 20,
    shirtShade: -22,
    shirtFar: -34,
    pantsShade: -16,
    pantsLit: 14,
    pantsFar: -34,
    hairLit: 24,
    hairShade: -22,

    boot: "#3a2d22",
    bootFar: "#2e241b",
    sole: "#241b14",
    soleFar: "#1d160f",
    belt: "#4a3722",
    buckle: "#8a6a3c",
    eye: "#2a211a",

    outline: "rgba(34,26,19,0.50)",
    outlineW: QUANT,
    rim: "rgba(255,233,194,0.22)",
    rimW: QUANT
};

/** Contact shadow — anchored to the centroid of the feet, not the sprite. */
export const SHADOW = {
    coreRX: 6.6, coreRY: 2.6, coreA: 0.30,
    haloRX: 9.0, haloRY: 3.4, haloA: 0.14,
    liftShrink: 0.045        // radii *= 1 - liftShrink * bob
};

/**
 * Locomotion. The whole point: the phase is driven by DISTANCE, so the feet
 * cannot outrun or lag behind the ground.
 *
 *   stride  — screen pixels of ground covered by one full cycle (two steps)
 *   swing   — foot travel amplitude; strideUnits / 4 means zero slip:
 *             one step covers stride/2 px = stride/4 u, and the foot moves
 *             2 * swing = stride/4 u relative to the hip. Exactly matched.
 */
export const GAIT = {
    strideWalk: 24,          // px of ground per cycle  -> 2.83 cycles/s at 68 px/s
    strideRun: 34,           //                         -> 3.47 cycles/s at 118 px/s
    pxPerUnit: 2,            // camera zoom; stride is quoted in screen px
    cadenceCap: 4.2,         // cycles/s, guards against a sewing machine on buffs

    liftWalk: 1.8,           // max foot lift
    liftRun: 2.6,
    bobWalk: 0.9,            // hips rise when the legs PASS, i.e. |cos(phase)|
    bobRun: 1.4,
    armRatio: 0.75,          // arm swing relative to leg swing
    armRatioTool: 0.40,      // the hand holding a tool swings less
    leanRun: 1.2,            // torso offset into the direction of travel
    squash: 0.03,            // ±3% on contact
    kneeBend: 0.6,           // how hard the IK pushes the knee forward (0..1)

    blendWalk: 0.12,         // s, idle <-> walk
    blendRun: 0.18,          // s, walk <-> run
    blendAction: 0.09,       // s, into a tool swing
    park: 0.12,              // s, coasting the phase to the nearest contact pose

    breathAmp: 0.35,         // idle
    breathHz: 0.28,
    blinkEvery: 4.1,
    blinkFor: 0.12
};

/** Action (tool swing) timing — one curve, no linear/sine mix. */
export const ACTION = {
    windUp: 0.30,            // fraction of the swing spent winding up
    windAmp: -0.45,
    strikeAmp: 1.15
};

/** Animation states. hit/down are reserved for the combat phase. */
export const STATES = ["idle", "walk", "run", "action", "hit", "down"];

/* --- shared easing: one curve everywhere -------------------------------- */

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The only easing in the character system. */
export const easeInOutSine = (t) => 0.5 - Math.cos(clamp01(t) * Math.PI) * 0.5;

/** Snap to the pixel grid so edges stay crisp. */
export const q = (v) => Math.round(v / QUANT) * QUANT;

/**
 * Move `cur` toward `target` at a rate that covers the full 0..1 range in
 * `seconds`. Linear in the simulation, eased when read by the painter —
 * that keeps the blend frame-rate independent and deterministic.
 */
export function approach(cur, target, dt, seconds) {
    const step = seconds > 0 ? dt / seconds : 1;
    if (cur < target) return Math.min(target, cur + step);
    if (cur > target) return Math.max(target, cur - step);
    return target;
}
