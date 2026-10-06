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

/**
 * Body proportions — "Albion lean": small head, heavy shoulders, waist pulled
 * in, hips and boots wide again. The pyramid is what makes a 60 px figure
 * read as a person with gear instead of a cute doll.
 *
 * head : body = 1 : 3.9
 */
export const BODY = {
    total: 31,

    headH: 8,
    headW: 8,
    headY: -31,              // top of the skull

    torsoY: -23,             // shoulder line
    torsoH: 11,
    shoulderW: 13,           // front/back view
    shoulderWSide: 9.5,      // profile is narrower — that is what sells the turn
    waistW: 8.5,             // the pinch, at 72% down the torso
    waistAt: 0.72,
    hipW: 9,

    hipY: -12,
    legW: 3.8,
    legGap: 1.0,
    thigh: 5.0,
    shin: 4.8,

    ankleY: -2.4,
    bootW: 5.2,
    bootH: 2.8,
    bootToe: 1.5,            // how far the toe sticks out past the ankle
    idleStance: 1.2,         // profile: feet part this much when standing

    armY: -22,               // shoulder pivot, just under the shoulder line
    armLen: 9.5,
    armW: 3.0,
    sleeveW: 1.3,            // the shoulder is wider than the forearm
    handH: 2.8,              // big hands — an Albion marker
    farArmX: 1.6,            // profile: how far the hidden arm peeks out
    nearArmX: 0.9,

    knifeScale: 0.78,        // a belt knife, not a short sword
    gripX: 7,                // where a tool sits — the end of the arm, not the face
    gripY: -12
};

/**
 * Gear is what you recognise at distance, so it is geometry, not texture.
 * Every piece is optional and lives in `look`, which keeps the door open for
 * "you are what you wear" later without touching the painter.
 */
export const GEAR = {
    shoulderW: 5.5,          // pauldron
    shoulderH: 2.5,
    shoulderDrop: 1.2,       // how far it slants down past the arm
    bracerH: 1.8,            // forearm cuff
    bracerW: 1.25,           // multiplier on arm width
    cuffH: 1.2,              // boot cuff
    cuffW: 1.1,              // multiplier on boot width
    flapW: 2.4,              // belt flap hanging on the near hip
    flapH: 3.5
};

/**
 * Tone system: three bands plus a deep core, not two. The shadow boundary runs
 * upper-left -> lower-right, matching the sun used by tilesart.
 */
export const TONE = { lit: 22, base: 0, dark: -20, deep: -38 };

/** Palette tokens. Shades are offsets fed to shadeHex(), not separate hexes. */
export const PALETTE = {
    skinLit: 16,
    skinShade: -28,
    skinDeep: -48,           // far-side limb
    shirtFar: -44,
    pantsFar: -46,
    hairLit: 24,
    hairShade: -22,

    boot: "#55402b",
    bootFar: "#3e2e1e",
    sole: "#241b14",
    soleFar: "#1d160f",
    belt: "#4a3722",
    buckle: "#9a7a44",
    leather: "#6b4b2c",      // pauldrons, bracers, cuffs
    leatherLit: 20,
    leatherDark: -22,
    metal: "#8e949c",
    metalLit: "#e8eef4",
    metalDark: "#4b5159",
    eye: "#2a211a",

    // Selective contour: dark only where the form turns AWAY from the sun.
    // A uniform outline makes an icon; this makes an object in a world.
    outline: "rgba(26,20,14,0.55)",
    outlineW: QUANT,
    ao: "rgba(0,0,0,0.22)",  // ambient occlusion in the joints
    aoW: QUANT,
    rim: "rgba(255,236,200,0.34)",
    rimW: QUANT
};

/** Contact shadow — anchored to the centroid of the feet, not the sprite. */
/**
 * Readability. At a camera zoom of 2 the hero is ~60 px tall, and at that
 * size legs merge into one block, hands disappear into sleeves and the whole
 * figure dissolves on a busy background. These numbers exist for one job: a
 * silhouette that still reads over ash, grass, stone and night.
 */
export const READ = {
    legSeam: 0.6,            // u — dark seam drawn down between the legs
    legSeamA: 0.30,
    bootTop: 0.6,            // u — lit edge along the top of the boot
    bootTopA: 0.30,
    footAO: 0.8,             // u — darkening right where the boot meets ground
    footAOA: 0.26,
    handEdgeA: 0.34,         // the line that separates hand from sleeve
    rimA: 0.34               // contour light on the sunward silhouette
};

/**
 * Wading. Standing in the shallows the hero loses his contact shadow (water
 * swallows it) and gains a waterline across the boots, a foam collar and a
 * ring that breathes. Numbers in u, as everywhere else in this file.
 */
export const WADE = {
    lineY: -1.6,        // how high up the boot the water reaches
    rx: 7.0, ry: 2.6,   // the ellipse of displaced water
    bodyA: 0.5,         // α of the water over the legs
    foamA: 0.55,        // α of the collar of foam
    foamW: 0.9,         // u — its thickness
    ringRX: 9.5, ringRY: 3.2,
    ringA: 0.3,
    breathe: 0.55,      // u — how much the ring swells
    breatheHz: 1.7,
    sink: 0.9           // u — the hero settles into the water
};

export const SHADOW = {
    coreRX: 7.2, coreRY: 2.8, coreA: 0.30,
    haloRX: 9.8, haloRY: 3.7, haloA: 0.14,
    liftShrink: 0.045,       // radii *= 1 - liftShrink * bob
    // The CORE stays strictly under the feet — that is the rule that keeps
    // the hero planted. Only the soft halo leans with the sun, and never more
    // than this, so the hero is lit by the same sun as the trees without ever
    // looking like he is hovering next to his own shadow.
    castHeight: 26,          // u of body that actually throws a shadow
    sunLean: 2.6,            // u of halo offset at a full-length sun shadow
    sunStretch: 0.35         // halo radii gained along the sun direction
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
/**
 * Ground physics of the hero. Instant velocity made the hero feel weightless:
 * full speed on frame one, dead stop on key-up. These numbers give the body
 * mass without costing responsiveness — at `accel` the hero is at full walk in
 * about 0.08 s and stops within ~2 px.
 */
export const MOVE = {
    // Time constants, not accelerations: an exponential approach composes,
    // so 30, 60 and 120 FPS give bit-identical motion. v(t) reaches 95 % of
    // the wanted speed in 3 x tau.
    tauStart: 0.075,     // s, spinning up to the wanted velocity
    tauStop: 0.055,      // s, coasting down when the stick is released
    tauTurn: 0.045,      // s, when the new direction opposes the old one
    slipStop: 2.6,       // tauStop multiplier on slippery ground (mud, shallows)
    slipBelow: 0.8,      // terrain speed under which the ground counts as slippery
    stopBelow: 1.5       // px/s — below this the hero is simply standing
};

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
    squash: 0.015,           // ±1.5% on contact — a hint, not a bounce
    kneeBend: 0.6,           // how hard the IK pushes the knee forward (0..1)

    blendWalk: 0.12,         // s, idle <-> walk
    blendRun: 0.18,          // s, walk <-> run
    blendAction: 0.09,       // s, into a tool swing
    park: 0.12,              // s, coasting the phase to the nearest contact pose

    // Weight. Albion walks heavy, but weight is VERTICAL: the body drops on
    // contact and rises on the pass. Lateral pelvis travel was a mistake — at
    // this scale any sideways hip motion reads as a wiggle, not as weight.
    // Keep hipSway at 0; the number stays so the choice is explicit.
    hipSway: 0,              // lateral pelvis travel, head-on — DO NOT RAISE
    shoulderCounter: 0,      // follows the sway; zero while the sway is zero
    clothLagPhase: 0.5,      // rad the belt flap trails the pelvis
    heelStrike: 0.6,         // extra dip on contact — this is where weight lives

    // Diagonals. There is no separate three-quarter pose; the side view is
    // used (it is the only one with a readable stride) and the body is
    // narrowed slightly, as a figure turning towards or away from the camera
    // would be. 10 % is enough to read, little enough to never look squashed.
    slantNarrow: 0.10,       // x scale lost at a full 45° diagonal
    slantHead: 0.6,          // u the head shifts along the travel direction

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
