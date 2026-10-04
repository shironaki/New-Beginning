/**
 * v3 render — procedural character sprite.
 *
 * Drawn from primitives so appearance (gear, hair, skin) is data, not an
 * atlas: the same function draws settlers, travellers and raiders by swapping
 * the palette and the gear flags in `look`.
 *
 * THE CONTRACT LIVES IN charspec.js. There are no magic numbers in here — if
 * you want to change a proportion, a colour or the length of a stride, edit
 * the spec. This file only knows how to paint what the spec describes.
 *
 * Style target: Albion's readable chunk — small head, heavy shoulders, pinched
 * waist, big hands and boots, three tone bands with a warm rim, and a contour
 * that exists only on the shadow side. Locomotion is distance driven (see
 * entities/player.js) and carries weight: the pelvis swings over the
 * supporting leg, the shoulders counter-rotate, the belt flap trails behind.
 *
 * Body frame: origin between the feet, on the ground; up is negative Y.
 */
import { BODY, GEAR, TONE, PALETTE, SHADOW, GAIT, ACTION, clamp01, easeInOutSine, q } from "./charspec.js";

export const DEFAULT_LOOK = {
    skin: "#e2b48a",
    hair: "#4a3526",
    shirt: "#6d7f4a",
    pants: "#524636",
    accent: "#8a4b32",       // one accent per figure — sash, flap, trim
    cloak: null,
    hairStyle: "short",
    shoulders: true,         // gear as silhouette
    bracers: true,
    bootCuff: true,
    beltFlap: true
};

function shadeHex(hex, amount) {
    const c = hex.replace("#", "");
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + amount)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Tone band of a base colour: band(c, "lit" | "base" | "dark" | "deep"). */
const band = (hex, name) => shadeHex(hex, TONE[name]);

/* --- primitives ---------------------------------------------------------
 * Everything lands on the pixel grid. The contour is SELECTIVE: an edge is
 * outlined only when it faces away from the sun (right / down), which is what
 * separates a stylised object from a sticker.
 */

function outlineEdges(ctx, pts, mode) {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = PALETTE.outlineW;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        // Outward direction of this edge, from the shape's centre.
        const ox = mx - cx, oy = my - cy;
        const len = Math.hypot(ox, oy) || 1;
        if (mode === "all" || ox / len > 0.25 || oy / len > 0.3) {   // away from the sun
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
            ctx.stroke();
        }
    }
}

function poly(ctx, pts, fill, contour = true) {
    const mode = contour === "all" ? "all" : "lit";
    const p = pts.map(([x, y]) => [q(x), q(y)]);
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (contour) outlineEdges(ctx, p, mode);
}

const boxPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function rect(ctx, x, y, w, h, fill, contour = true) {
    poly(ctx, boxPts(x, y, w, h), fill, contour);
}

/** A tapered quad between two joints — thigh, shin, upper arm, forearm. */
function limb(ctx, x0, y0, x1, y1, w0, w1, fill, contour = true) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 0.001;
    const nx = -dy / len, ny = dx / len;
    poly(ctx, [
        [x0 + nx * w0 / 2, y0 + ny * w0 / 2],
        [x1 + nx * w1 / 2, y1 + ny * w1 / 2],
        [x1 - nx * w1 / 2, y1 - ny * w1 / 2],
        [x0 - nx * w0 / 2, y0 - ny * w0 / 2]
    ], fill, contour);
}

/* --- body profile: rows of (y, halfWidth) ------------------------------- */

/** Full outline of a profile. */
const silhouette = (rows) => [
    ...rows.map(([y, hw]) => [-hw, y]),
    ...[...rows].reverse().map(([y, hw]) => [hw, y])
];

/**
 * A vertical stripe measured inwards from one edge of the profile — this is
 * how the tone bands follow the pinched waist instead of cutting across it.
 * `s` = -1 left edge, +1 right edge; `a`,`b` = insets.
 */
const stripe = (rows, s, a, b) => [
    ...rows.map(([y, hw]) => [s * hw - s * a, y]),
    ...[...rows].reverse().map(([y, hw]) => [s * hw - s * b, y])
];

/**
 * Two-bone IK: given hip and ankle, where is the knee?
 * The old code faked a lift by SHORTENING the leg, which read as a telescope.
 * A real knee keeps both bones at full length and folds between them.
 */
function knee(hx, hy, ax, ay, bendDir) {
    const l1 = BODY.thigh, l2 = BODY.shin;
    let dx = ax - hx, dy = ay - hy;
    let d = Math.hypot(dx, dy) || 0.001;
    const maxD = l1 + l2 - 0.08;
    if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
    const a = (d * d + l1 * l1 - l2 * l2) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const ux = dx / d, uy = dy / d;
    return { x: hx + ux * a + uy * h * bendDir, y: hy + uy * a - ux * h * bendDir };
}

/**
 * The pose, as pure numbers. Separated from the painting so the walk can be
 * unit tested — this is where the left/right mirror bug lived.
 */
export function posture(p) {
    const dir = p.dir || "down";
    const phase = (p.phase != null ? p.phase : p.anim) || 0;
    const gaitRaw = clamp01(p.gait != null ? p.gait : (p.moving ? 1 : 0));
    const g = easeInOutSine(gaitRaw);                 // the one easing
    const run = clamp01(p.runBlend != null ? p.runBlend : 0);
    const idle = p.idleTime || 0;

    const side = dir === "left" ? -1 : 1;
    const back = dir === "up";
    const sideView = dir === "left" || dir === "right";

    // Stride -> swing amplitude. stride/4 units of foot travel per step is
    // exactly the ground covered per step, so the plant does not slide.
    const strideU = (GAIT.strideWalk + (GAIT.strideRun - GAIT.strideWalk) * run) / GAIT.pxPerUnit;
    const amp = strideU / 4;
    const liftAmp = GAIT.liftWalk + (GAIT.liftRun - GAIT.liftWalk) * run;
    const bobAmp = GAIT.bobWalk + (GAIT.bobRun - GAIT.bobWalk) * run;

    // `side` mirrors the whole gait: +1 facing right, -1 facing left. Without
    // it the feet swung backwards when the hero walked left.
    const swingN = side * Math.sin(phase) * amp * g;           // near leg, forward+
    const swingF = side * Math.sin(phase + Math.PI) * amp * g; // far leg, antiphase
    const liftN = Math.max(0, Math.cos(phase)) * liftAmp * g;
    const liftF = Math.max(0, Math.cos(phase + Math.PI)) * liftAmp * g;

    // Hips are HIGH when the legs pass under the body, LOW on contact, with an
    // extra dip the instant the heel lands.
    const breath = Math.sin(idle * GAIT.breathHz * Math.PI * 2) * GAIT.breathAmp;
    const strike = Math.pow(Math.max(0, -Math.cos(phase * 2)), 3) * GAIT.heelStrike * g;
    const bob = (Math.abs(Math.cos(phase)) - 0.5) * bobAmp * g - strike + breath * (1 - g);

    // Weight: the pelvis slides over the supporting leg, shoulders counter it.
    const sway = sideView ? 0 : -Math.cos(phase) * GAIT.hipSway * g;
    const counter = -sway * GAIT.shoulderCounter;
    // Cloth trails the pelvis — which no longer moves sideways, so this is
    // zero by construction. Kept as one expression, not scattered magic.
    const flagX = sideView
        ? 0
        : -Math.cos(phase - GAIT.clothLagPhase) * GAIT.hipSway * g;

    const lean = sideView ? side * GAIT.leanRun * run * g : 0;
    const squash = -GAIT.squash * Math.cos(phase * 2) * g;     // ±3% on contact
    const stance = sideView ? side * BODY.idleStance * (1 - g) : 0;

    // Action swing: wind-up then strike, both on the same eased curve.
    const act = p.actionTimer > 0 ? clamp01(1 - p.actionTimer / 0.35) : 0;
    const swing = act > 0
        ? (act < ACTION.windUp
            ? easeInOutSine(act / ACTION.windUp) * ACTION.windAmp
            : Math.sin(((act - ACTION.windUp) / (1 - ACTION.windUp)) * Math.PI) * ACTION.strikeAmp)
        : 0;

    return { dir, phase, g, run, idle, side, back, sideView, amp,
        swingN, swingF, liftN, liftF, bob, sway, counter, flagX,
        lean, squash, stance, swing };
}

/**
 * @param {CanvasRenderingContext2D} ctx translated to the character's feet
 * @param {object} p { dir, phase|anim, gait|moving, runBlend, look,
 *                     actionTimer, tool, idleTime }
 */
export function drawCharacter(ctx, p) {
    const look = Object.assign({}, DEFAULT_LOOK, p.look || {});
    const { phase, g, side, back, sideView,
        swingN, swingF, liftN, liftF, bob, sway, counter, flagX,
        lean, squash, stance, swing } = posture(p);
    const dir = p.dir || "down";
    const idle = p.idleTime || 0;

    const skin = look.skin, shirt = look.shirt, pants = look.pants;
    const leather = PALETTE.leather;

    /* ---- contact shadow, under the FEET, not under the sprite ---------- */
    const hipY = BODY.hipY - bob;
    const legSpread = BODY.legW / 2 + BODY.legGap / 2;
    const footNX = sideView ? swingN + stance : legSpread + sway;
    const footFX = sideView ? -0.9 * side + swingF - stance : -legSpread + sway;
    const centroid = (footNX + footFX) / 2;
    const shrink = 1 - SHADOW.liftShrink * Math.max(0, bob);
    ctx.fillStyle = `rgba(10,9,8,${SHADOW.haloA})`;
    ctx.beginPath();
    ctx.ellipse(centroid, 0, SHADOW.haloRX * shrink, SHADOW.haloRY * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(10,9,8,${SHADOW.coreA})`;
    ctx.beginPath();
    ctx.ellipse(centroid, 0, SHADOW.coreRX * shrink, SHADOW.coreRY * shrink, 0, 0, Math.PI * 2);
    ctx.fill();

    /* ---- legs ---------------------------------------------------------- */
    const drawLeg = (hipX, footX, lift, far, bendDir) => {
        const hx = hipX + sway;
        const ax = hx + footX, ay = BODY.ankleY - lift;
        const kn = knee(hx, hipY, ax, ay, bendDir);
        const cloth = far ? shadeHex(pants, PALETTE.pantsFar) : band(pants, "base");
        limb(ctx, hx, hipY, kn.x, kn.y, BODY.legW, BODY.legW * 0.92, cloth);
        limb(ctx, kn.x, kn.y, ax, ay, BODY.legW * 0.92, BODY.legW * 0.84,
            far ? cloth : band(pants, "dark"));
        if (!far) {                                           // knee AO
            rect(ctx, kn.x - BODY.legW / 2, kn.y - 0.3, BODY.legW, PALETTE.aoW, PALETTE.ao, false);
        }
        const toe = sideView ? side * BODY.bootToe : 0;
        const bw = sideView ? BODY.bootW : BODY.bootW * 0.74;
        const bx = ax - bw / 2 + toe, by = ay - 0.4;
        rect(ctx, bx, by, bw, BODY.bootH, far ? PALETTE.bootFar : PALETTE.boot);
        rect(ctx, bx, by + BODY.bootH - 0.9, bw, 0.9, far ? PALETTE.soleFar : PALETTE.sole, false);
        if (look.bootCuff) {                                  // gear: boot cuff
            const cw = bw * GEAR.cuffW;
            rect(ctx, ax - cw / 2 + toe * 0.6, by - GEAR.cuffH, cw, GEAR.cuffH,
                far ? shadeHex(leather, PALETTE.leatherDark) : leather);
        }
    };

    /* ---- arms: kinematics first, the tool needs the hand --------------- */
    const armPose = (shoulderX, reach, lift) => {
        const sx = shoulderX + counter, sy = BODY.armY - bob + lean;
        const ex = sx + reach, ey = sy + BODY.armLen - Math.abs(reach) * 0.25 - lift;
        return { sx, sy, ex, ey, mx: (sx + ex) / 2 + reach * 0.1, my: (sy + ey) / 2 };
    };

    const paintHand = (a, far) => {
        rect(ctx, a.ex - BODY.armW / 2, a.ey - 0.5, BODY.armW, BODY.handH,
            far ? shadeHex(skin, PALETTE.skinDeep) : shadeHex(skin, PALETTE.skinLit),
            far ? true : "all");
        rect(ctx, a.ex - BODY.armW / 2, a.ey - 0.5 + BODY.handH - 0.7, BODY.armW, 0.7,
            PALETTE.ao, false);
    };

    const paintArm = (a, far, hand = true) => {
        const sleeve = far ? shadeHex(shirt, PALETTE.shirtFar) : band(shirt, "deep");
        const skinC = far ? shadeHex(skin, PALETTE.skinDeep) : skin;
        limb(ctx, a.sx, a.sy, a.mx, a.my, BODY.armW * BODY.sleeveW, BODY.armW, sleeve, "all");
        limb(ctx, a.mx, a.my, a.ex, a.ey, BODY.armW, BODY.armW * 0.85, skinC, "all");
        if (look.bracers) {                                   // gear: bracer
            const bw = BODY.armW * GEAR.bracerW;
            rect(ctx, a.ex - bw / 2 + (a.mx - a.ex) * 0.1, a.ey - 0.6 - GEAR.bracerH, bw, GEAR.bracerH,
                far ? shadeHex(leather, PALETTE.leatherDark) : shadeHex(leather, PALETTE.leatherLit));
        }
        if (hand) paintHand(a, far);
    };

    // Arms counter-swing the legs: the far arm goes with the NEAR leg. Head-on
    // the tool is in the right hand, from behind it is on the left, so the free
    // arm swaps sides too — otherwise the hero loses an arm.
    const ax0 = BODY.shoulderW / 2 + BODY.armW / 2 - 1.0;      // outside, slight overlap
    const farArm = sideView
        ? armPose(-BODY.farArmX * side, -swingF * GAIT.armRatio, 0)
        : armPose(back ? ax0 : -ax0, 0, (back ? 1 : -1) * swingN * GAIT.armRatio);
    const toolArm = sideView
        ? armPose(BODY.nearArmX * side,
            -swingN * GAIT.armRatioTool + side * swing * 2.2, Math.max(0, swing) * 1.5)
        : armPose(back ? -ax0 : ax0, 0,
            (back ? -1 : 1) * swingN * GAIT.armRatioTool - swing * 2.2);

    if (sideView) paintArm(farArm, true);
    if (p.tool && back) { drawHeldTool(ctx, p.tool, dir, side, swing, toolArm, true); paintHand(toolArm, false); }

    if (sideView) {
        drawLeg(-0.9 * side, swingF - stance, liftF, true, side);
        drawLeg(0, swingN + stance, liftN, false, side);
    } else {
        drawLeg(-legSpread, 0, liftF, true, -0.5);
        drawLeg(legSpread, 0, liftN, false, 0.5);
    }

    /* ---- torso: the pyramid, in three tone bands ----------------------- */
    ctx.save();
    ctx.translate(lean + counter, 0);
    ctx.translate(0, hipY);
    ctx.scale(1 + squash * 0.5, 1 - squash);                  // squash & stretch
    ctx.translate(0, -hipY);

    const top = BODY.torsoY - bob;
    const bottom = top + BODY.torsoH;
    const waistY = top + BODY.torsoH * BODY.waistAt;
    const narrow = sideView ? BODY.shoulderWSide / BODY.shoulderW : 1;
    const rows = [
        [top, BODY.shoulderW / 2 * narrow],
        [waistY, BODY.waistW / 2 * narrow],
        [bottom, BODY.hipW / 2 * narrow]
    ];
    poly(ctx, silhouette(rows), band(shirt, "base"));
    poly(ctx, stripe(rows, -1, 0, 2.4), band(shirt, "lit"), false);      // sun side
    poly(ctx, stripe(rows, 1, 0, 2.0), band(shirt, "dark"), false);
    poly(ctx, stripe(rows, 1, 0, 0.8), band(shirt, "deep"), false);
    rect(ctx, -rows[0][1], top, rows[0][1] * 2, PALETTE.aoW * 2, PALETTE.ao, false);   // under the collar

    if (back) {
        rect(ctx, -0.5, top + 1.5, 1, BODY.torsoH - 4, PALETTE.ao, false);            // spine seam
    } else if (!sideView) {
        rect(ctx, -2, top, 4, 1.5, band(shirt, "dark"), false);                        // collar
    }

    // Belt, buckle and the accent flap that trails the pelvis.
    const beltY = bottom - 2.2;
    rect(ctx, -rows[2][1] - 0.2, beltY, rows[2][1] * 2 + 0.4, 2.2, PALETTE.belt);
    rect(ctx, (sideView ? side * 1.8 : 0) - 1.1, beltY + 0.3, 2.2, 1.6, PALETTE.buckle, false);
    if (look.beltFlap) {
        const fw = GEAR.flapW;
        const fx = (sideView ? side * 1.0 : rows[2][1] - fw * 0.35) + flagX * 0.6;
        rect(ctx, fx - fw / 2, beltY + 1.5, fw, GEAR.flapH, look.accent);
        rect(ctx, fx - fw / 2, beltY + 1.5, fw * 0.3, GEAR.flapH,
            shadeHex(look.accent, TONE.lit), false);
    }
    if (look.cloak) {
        poly(ctx, silhouette(rows.map(([y, hw]) => [y + 0.5, hw + 1])), look.cloak);
    }

    rect(ctx, -rows[0][1], top + 0.5, PALETTE.rimW, BODY.torsoH * 0.55, PALETTE.rim, false);

    // Pauldrons go on AFTER the arms, so they cover the shoulder joint — that
    // is what makes gear read as worn instead of glued on.
    const paintPauldrons = () => {
        if (!look.shoulders) return;
        const sw = rows[0][1];
        const pad = (s, inner, outer, drop) => poly(ctx, [
            [s * inner, top - 0.4],
            [s * outer, top + 0.4],
            [s * (outer - 0.6), top + GEAR.shoulderH + drop],
            [s * (inner - 0.4), top + GEAR.shoulderH + drop * 0.5]
        ], s < 0 ? shadeHex(leather, PALETTE.leatherLit) : leather, "all");
        const out = sw + GEAR.shoulderW * 0.42;
        // In profile a single compact cap sits on the near shoulder; a slab
        // across the chest reads as a plank, not as armour.
        if (sideView) pad(side, -1.0, sw + 0.9, GEAR.shoulderDrop * 0.6);
        else { pad(-1, sw - 2.6, out, GEAR.shoulderDrop); pad(1, sw - 2.6, out, GEAR.shoulderDrop); }
    };

    /* ---- near arm ------------------------------------------------------- */
    if (!sideView) paintArm(farArm, false);
    paintArm(toolArm, false, !p.tool);        // with a tool the hand comes later
    paintPauldrons();

    /* ---- head ----------------------------------------------------------- */
    const headY = BODY.headY - bob;
    const headH = BODY.headH, headW = BODY.headW;
    const headX = (sideView ? side * 0.5 : 0) + counter * 0.5;
    rect(ctx, -2.2, headY + headH - 0.5, 4.4, 1.6, PALETTE.ao, false);          // neck
    rect(ctx, headX - headW / 2, headY, headW, headH, skin);
    rect(ctx, headX + headW / 2 - 1.8, headY + 1, 1.8, headH - 1, shadeHex(skin, PALETTE.skinShade), false);
    rect(ctx, headX - headW / 2, headY + 1, 1.3, headH - 2, shadeHex(skin, PALETTE.skinLit), false);
    rect(ctx, headX - headW / 2, headY + 1, PALETTE.rimW, headH - 3, PALETTE.rim, false);
    if (back) rect(ctx, headX - headW / 2, headY + headH - 2.2, headW, 2.2,
        shadeHex(skin, PALETTE.skinShade), false);

    const hairDark = shadeHex(look.hair, PALETTE.hairShade);
    const hairLit = shadeHex(look.hair, PALETTE.hairLit);
    if (back) {
        rect(ctx, headX - headW / 2 - 0.5, headY - 1, headW + 1, headH - 1, look.hair);
        rect(ctx, headX + headW / 2 - 2.2, headY - 1, 2.2, headH - 1, hairDark, false);
        rect(ctx, headX - headW / 2 + 1, headY - 0.5, 3, 1.2, hairLit, false);
    } else {
        rect(ctx, headX - headW / 2 - 0.5, headY - 1, headW + 1, 3.6, look.hair);
        rect(ctx, headX + headW / 2 - 2.2, headY - 1, 2.2, 3.6, hairDark, false);
        if (look.hairStyle === "long") {
            rect(ctx, headX - headW / 2 - 1.2, headY, 1.7, 6.5, look.hair, false);
            rect(ctx, headX + headW / 2 - 0.5, headY, 1.7, 6.5, look.hair, false);
        } else {
            rect(ctx, headX - headW / 2 - 1, headY + 0.5, 1.4, 2.2, look.hair, false);
            rect(ctx, headX + headW / 2 - 0.4, headY + 0.5, 1.4, 2.2, look.hair, false);
        }
        rect(ctx, headX - headW / 2 + 1, headY - 0.5, 2.6, 1, hairLit, false);
    }

    if (!back) {
        const blink = (idle % GAIT.blinkEvery) < GAIT.blinkFor;
        const eyeH = blink ? 0.5 : 1.4, eyeW = 1.4;
        const eyeY = headY + (blink ? 4.8 : 4);
        if (dir === "left") {
            rect(ctx, headX - 3.2, eyeY, eyeW, eyeH, PALETTE.eye, false);
            rect(ctx, headX - headW / 2 - 0.5, headY + 4, 1, 1.4, shadeHex(skin, PALETTE.skinShade), false);
            rect(ctx, headX - 3.6, headY + 6.2, 2.2, 0.9, "rgba(0,0,0,0.2)", false);
        } else if (dir === "right") {
            rect(ctx, headX + 1.8, eyeY, eyeW, eyeH, PALETTE.eye, false);
            rect(ctx, headX + headW / 2 - 0.5, headY + 4, 1, 1.4, shadeHex(skin, PALETTE.skinShade), false);
            rect(ctx, headX + 1.4, headY + 6.2, 2.2, 0.9, "rgba(0,0,0,0.2)", false);
        } else {
            rect(ctx, headX - 2.7, eyeY, eyeW, eyeH, PALETTE.eye, false);
            rect(ctx, headX + 1.3, eyeY, eyeW, eyeH, PALETTE.eye, false);
            rect(ctx, headX - 0.9, headY + 6.2, 1.8, 0.9, "rgba(0,0,0,0.16)", false);
        }
    }

    ctx.restore();

    // Tool in the near hand, in front of the body; the fist closes over the
    // handle afterwards so the grip reads as a grip and not as a loose block.
    if (p.tool && !back) {
        drawHeldTool(ctx, p.tool, dir, side, swing, toolArm, false);
        paintHand(toolArm, false);
    }
}

/**
 * Draw the held tool at the hand. `dir` decides which side of the body the
 * grip sits on; the tool is rotated around the grip when swinging.
 */
function drawHeldTool(ctx, tool, dir, side, swing, arm, behind) {
    // The grip IS the hand of the tool arm — passing a fixed GRIP_Y used to
    // leave the knife floating next to a second, phantom hand.
    const gx = arm.ex, gy = arm.ey + BODY.handH / 2 - 0.5;
    const lean = dir === "up" ? -0.35 : dir === "down" ? 0.3 : side * 0.45;
    const angle = lean - side * swing * 1.9;

    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(angle);
    if (dir === "left") ctx.scale(-1, 1);          // mirror so tools face forward
    if (behind) ctx.globalAlpha = 0.9;

    const id = typeof tool === "string" ? tool : (tool.tool || tool.id || "");
    const itemId = typeof tool === "string" ? tool : (tool.id || "");
    switch (id) {
        case "axe": drawAxe(ctx, itemId.includes("iron")); break;
        case "pick": drawPick(ctx); break;
        case "knife": ctx.scale(BODY.knifeScale, BODY.knifeScale); drawKnife(ctx); break;
        case "spear": drawSpear(ctx); break;
        case "rod": drawRod(ctx); break;
        case "hoe": drawHoe(ctx); break;
        case "torch": drawTorch(ctx); break;
        default: drawGeneric(ctx); break;
    }

    // No hand here: the fist is part of the arm and is painted by the caller
    // right after this, so it always lines up with the forearm.
    ctx.globalAlpha = 1;
    ctx.restore();
}

/* --- tool drawings: grip at (0,0), the business end points up ------------ */

function handle(ctx, len, w = 1.6, c = "#7a5a34") {
    ctx.fillStyle = c;
    ctx.fillRect(-w / 2, -len, w, len + 2.5);
    ctx.fillStyle = "rgba(255,230,190,0.25)";
    ctx.fillRect(-w / 2, -len, w * 0.4, len + 2.5);
}

function drawAxe(ctx, iron) {
    handle(ctx, 11);
    const head = iron ? "#b9c2cc" : "#9a9890";
    ctx.fillStyle = "#4a3a24";                   // binding
    ctx.fillRect(-1.6, -11.5, 3.2, 2);
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.moveTo(0.4, -13.5); ctx.lineTo(5.6, -12.2);
    ctx.lineTo(6.4, -8.6); ctx.lineTo(0.4, -8.4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";    // edge glint
    ctx.beginPath();
    ctx.moveTo(5.6, -12.2); ctx.lineTo(6.4, -8.6); ctx.lineTo(5.2, -8.8); ctx.lineTo(4.6, -11.8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0.4, -9.4, 5.4, 1);
}

function drawPick(ctx) {
    handle(ctx, 11);
    ctx.fillStyle = "#8d8b84";
    ctx.beginPath();
    ctx.moveTo(-6.5, -9.6); ctx.quadraticCurveTo(0, -14.2, 6.5, -9.6);
    ctx.quadraticCurveTo(0, -11.8, -6.5, -9.6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(-6.4, -10.2, 2, 1);
    ctx.fillRect(4.4, -10.2, 2, 1);
}

function drawKnife(ctx) {
    // A short blade in the fist: handle through the hand, blade above it.
    ctx.fillStyle = "#5a3f26";
    ctx.fillRect(-1.1, -2.6, 2.2, 5);
    ctx.fillStyle = "#3c2a19";
    ctx.fillRect(-1.1, -2.6, 0.8, 5);
    ctx.fillStyle = "#6d5536";                   // guard
    ctx.fillRect(-2, -3.6, 4, 1.2);
    ctx.fillStyle = "#c9ced6";                   // blade
    ctx.beginPath();
    ctx.moveTo(-1.3, -3.6); ctx.lineTo(1.3, -3.6);
    ctx.lineTo(1.5, -9.6); ctx.lineTo(0, -11.4); ctx.lineTo(-1.3, -9.2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(0.3, -10, 0.8, 6);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(-1.3, -9.4, 0.8, 5.6);
}

function drawSpear(ctx) {
    handle(ctx, 17, 1.4, "#6e5331");
    ctx.fillStyle = "#4a3a24";
    ctx.fillRect(-1.2, -17.5, 2.4, 1.6);
    ctx.fillStyle = "#cfd6de";
    ctx.beginPath();
    ctx.moveTo(0, -23.5); ctx.lineTo(2.2, -17.8); ctx.lineTo(0, -16.6); ctx.lineTo(-2.2, -17.8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.moveTo(0, -23.5); ctx.lineTo(0.9, -18); ctx.lineTo(0, -17.2);
    ctx.closePath(); ctx.fill();
}

function drawRod(ctx) {
    ctx.strokeStyle = "#7a5a34"; ctx.lineWidth = 1.4; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 2); ctx.quadraticCurveTo(-1, -9, -5, -18);
    ctx.stroke();
    ctx.strokeStyle = "rgba(240,240,240,0.55)"; ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-5, -18); ctx.quadraticCurveTo(-7.5, -12, -7, -5);
    ctx.stroke();
    ctx.fillStyle = "#d8d8d8";
    ctx.beginPath(); ctx.arc(-7, -4.4, 0.9, 0, Math.PI * 2); ctx.fill();
}

function drawHoe(ctx) {
    handle(ctx, 13);
    ctx.fillStyle = "#8d8b84";
    ctx.fillRect(-0.8, -13.6, 6.4, 1.8);
    ctx.fillRect(4.4, -13.6, 1.8, 4.2);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(-0.8, -13.6, 6.4, 0.6);
}

function drawTorch(ctx) {
    ctx.fillStyle = "#5e4228";
    ctx.fillRect(-1.3, -11, 2.6, 13);
    ctx.fillStyle = "#3f2c18";
    ctx.fillRect(0.4, -11, 0.9, 13);
    ctx.fillStyle = "#2a211a";                  // pitch-soaked rag
    ctx.fillRect(-2.2, -13.5, 4.4, 3);
    ctx.fillStyle = "rgba(255,120,40,0.85)";
    ctx.beginPath();
    ctx.moveTo(-2.6, -13); ctx.quadraticCurveTo(0, -22, 2.6, -13);
    ctx.quadraticCurveTo(0, -11.5, -2.6, -13);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,220,140,0.9)";
    ctx.beginPath();
    ctx.moveTo(-1.2, -13.5); ctx.quadraticCurveTo(0, -18.5, 1.2, -13.5);
    ctx.quadraticCurveTo(0, -12.6, -1.2, -13.5);
    ctx.closePath(); ctx.fill();
}

function drawGeneric(ctx) {
    ctx.fillStyle = "#6a5a44";
    ctx.fillRect(-1.2, -8, 2.4, 10);
    ctx.fillStyle = "#8a7a60";
    ctx.fillRect(-2.4, -10.5, 4.8, 3);
}

/** Sleeping hero: a bedroll lump with zzz, drawn inside the tent. */
export function drawSleeping(ctx, time) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
    const breathe = Math.sin(time * 1.2) * 0.4;
    ctx.fillStyle = "#6d5e48";
    ctx.beginPath(); ctx.ellipse(0, -4, 11.5, 5.4 + breathe, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#7f6e54";
    ctx.beginPath(); ctx.ellipse(-1, -5.4, 9.5, 3.8 + breathe, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.ellipse(4, -3.4, 6, 2.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e2b48a";
    ctx.beginPath(); ctx.arc(-9.5, -5.5, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#4a3526";
    ctx.beginPath(); ctx.arc(-10.6, -6.6, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "7px serif";
    const n = Math.floor(time) % 3;
    for (let i = 0; i <= n; i++) ctx.fillText("z", 6 + i * 4, -13 - i * 5);
}
