/**
 * render — procedural character sprite.
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
import { drawHead } from "./head.js";
import { torchFlame, paintTorchFlame } from "./torch.js";
import { SUN, castShadow } from "./tilesart.js";
import { BODY, GEAR, TONE, PALETTE, READ, SHADOW, WADE, GAIT, ACTION, ATTACH, fallPose, clamp01, easeInOutSine, q } from "./charspec.js";

export const DEFAULT_LOOK = {
    skin: "#caa27e",
    hair: "#39332b",
    shirt: "#899383",
    vest: "#41524e",
    pants: "#48473e",
    accent: "#b18058",       // one accent per figure — sash, flap, trim
    cloak: null,
    hairStyle: "short",
    stubble: true,
    satchel: true,
    shoulders: false,         // gear as silhouette
    bracers: false,
    bootCuff: false,
    beltFlap: false
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
    if (p.fallTimer > 0) p = { ...p, gait: 0, runBlend: 0, ax: 0, ay: 0, leanAX: 0, leanAY: 0, actionTimer: 0 };
    const dir = p.dir || "down";
    const phase = (p.phase != null ? p.phase : p.anim) || 0;
    const gaitRaw = clamp01(p.gait != null ? p.gait : (p.moving ? 1 : 0));
    const g = easeInOutSine(gaitRaw);                 // the one easing
    const run = clamp01(p.runBlend != null ? p.runBlend : 0);
    const idle = p.idleTime || 0;

    const side = dir === "left" ? -1 : 1;
    const back = dir === "up";
    const sideView = dir === "left" || dir === "right";

    // Distance-driven cadence; bound the visual swing by anatomical reach.
    const strideU = (GAIT.strideWalk + (GAIT.strideRun - GAIT.strideWalk) * run) / GAIT.pxPerUnit;
    // Cadence may slow without overextending the legs or pumping the head.
    const amp = Math.min(3.5, strideU / 4);
    const liftAmp = GAIT.liftWalk + (GAIT.liftRun - GAIT.liftWalk) * run;
    const bobAmp = GAIT.bobWalk + (GAIT.bobRun - GAIT.bobWalk) * run;

    // `side` mirrors the whole gait: +1 facing right, -1 facing left. Without
    // it the feet swung backwards when the hero walked left.
    const swingN = side * Math.sin(phase) * amp * g;           // near leg, forward+
    const swingF = side * Math.sin(phase + Math.PI) * amp * g; // far leg, antiphase
    const fallen = fallPose(p).amount;
    const liftN = Math.max(0, Math.cos(phase)) * liftAmp * g + fallen * 3.5;
    const liftF = Math.max(0, Math.cos(phase + Math.PI)) * liftAmp * g + fallen * 1.4;

    // Hips are HIGH when the legs pass under the body, LOW on contact, with an
    // extra dip the instant the heel lands.
    const breath = Math.sin(idle * GAIT.breathHz * Math.PI * 2) * GAIT.breathAmp;
    const strike = Math.pow(Math.max(0, -Math.cos(phase * 2)), 3) * GAIT.heelStrike * g;
    let bob = (Math.abs(Math.cos(phase)) - 0.5) * bobAmp * g - strike + breath * (1 - g);

    // Weight: the pelvis slides over the supporting leg, shoulders counter it.
    const sway = sideView ? 0 : -Math.cos(phase) * GAIT.hipSway * g;
    const counter = -sway * GAIT.shoulderCounter;
    // Cloth trails the pelvis — which no longer moves sideways, so this is
    // zero by construction. Kept as one expression, not scattered magic.
    const flagX = sideView
        ? 0
        : -Math.cos(phase - GAIT.clothLagPhase) * GAIT.hipSway * g;

    // Travel lean (steady) + acceleration lean (transient). On the side view
    // both are horizontal; head-on, acceleration shows as the body rising
    // onto the toes instead, because a sideways offset would read as a wiggle.
    // How much of the acceleration points the way the hero faces: positive
    // while starting off, negative while braking.
    const fmag = Math.hypot(p.faceX || 0, p.faceY || 0) || 1;
    const accAlong = ((p.leanAX ?? p.ax ?? 0) * (p.faceX || 0) + (p.leanAY ?? p.ay ?? 0) * (p.faceY || 0)) / fmag;
    const accK = Math.max(-1, Math.min(1, accAlong / GAIT.accelRef));
    const lean = (sideView ? side * GAIT.leanRun * run * g : 0)
               + (sideView ? side * GAIT.leanAccel * accK : 0);
    const accLift = sideView ? 0 : -GAIT.leanAccel * 0.45 * accK;
    const squash = -GAIT.squash * Math.cos(phase * 2) * g;     // ±3% on contact
    const stance = sideView ? side * BODY.idleStance * (1 - g) : 0;

    // Action swing: wind-up then strike, both on the same eased curve.
    const act = p.actionTimer > 0 ? clamp01(1 - p.actionTimer / 0.35) : 0;
    const swing = act > 0
        ? (act < ACTION.windUp
            ? easeInOutSine(act / ACTION.windUp) * ACTION.windAmp
            : Math.sin(((act - ACTION.windUp) / (1 - ACTION.windUp)) * Math.PI) * ACTION.strikeAmp)
        : 0;

    bob += accLift - fallPose(p).crouch;                       // head-on: push off / settle back
    // Keep each ankle planted without stretching the shin beyond its IK
    // reach. Previously only the knee target was clamped: the boot was not.
    const reach = BODY.thigh + BODY.shin - 0.08;
    for (const [travel, lift] of [[sideView ? swingN + stance : 0, liftN], [sideView ? swingF - stance : 0, liftF]]) {
        const vertical = Math.sqrt(Math.max(0, reach * reach - travel * travel));
        bob = Math.min(bob, BODY.hipY - BODY.ankleY + lift + vertical);
    }
    return { dir, phase, g, run, idle, side, back, sideView, amp,
        swingN, swingF, liftN, liftF, bob, sway, counter, flagX,
        lean, squash, stance, swing };
}

/** Anatomical hands. RIGHT is screen-left head-on, screen-right from behind;
 * near in right profile, far in left profile. Never swaps hands for visibility. */
export function armRig(p, pose = posture(p)) {
    const { sideView, side, back, bob, counter, lean, swingN, swingF, swing, g, idle } = pose;
    const make = (x, reach, lift) => {
        const sx = x + counter + lean, sy = BODY.armY - bob;
        const ex = sx + reach, ey = sy + BODY.armLen - Math.abs(reach) * 0.25 - lift;
        return { sx, sy, ex, ey, mx: (sx + ex) / 2 + reach * 0.1, my: (sy + ey) / 2 };
    };
    const ax = BODY.shoulderW / 2 + BODY.armW / 2 - 1;
    const behind = p.dir === "left" || back;
    const rest = Math.sin(idle * 1.3) * 0.45 * (1 - g);
    const rs = p.actionHand === "left" ? 0 : swing, ls = p.actionHand === "left" ? swing : 0;
    const lr = p.leftTool ? GAIT.armRatioTool : GAIT.armRatio;
    const right = sideView
        ? make(behind ? -BODY.farArmX * side : BODY.nearArmX * side,
            -(behind ? swingF : swingN) * GAIT.armRatioTool + side * rs * 2.2 + rest, Math.max(0, rs) * 1.5)
        : make(back ? ax : -ax, rest, (back ? 1 : -1) * swingN * GAIT.armRatioTool - rs * 2.2);
    const left = sideView
        ? make(behind ? BODY.nearArmX * side : -BODY.farArmX * side,
            -(behind ? swingN : swingF) * lr + side * ls * 2.2 - rest, Math.max(0, ls) * 1.5)
        : make(back ? -ax : ax, -rest, (back ? -1 : 1) * swingN * lr - ls * 2.2);
    // Eating has a real occupied hand at the mouth; the other item stays held.
    if (p.eatingHand) {
        const a = p.eatingHand === "left" ? left : right;
        a.ex = sideView ? side * 5 : (p.eatingHand === "right" ? -2 : 2);
        a.ey = BODY.headY + 6 - bob;
        a.mx = (a.sx + a.ex) / 2 + (p.eatingHand === "right" ? -3 : 3); a.my = (a.sy + a.ey) / 2 + 5;
    }
    // A free hand braces the fall; held items remain in their anatomical hand.
    const brace = fallPose(p).amount;
    left.ex += side * brace * 3; left.ey -= brace * 3;
    left.mx = (left.sx + left.ex) / 2; left.my = (left.sy + left.ey) / 2 - brace;
    return { right, left, behind };
}

function heldToolAngle(dir, side, swing, hand = "right") {
    const anatomical = hand === "left" ? -1 : 1;
    const lean = dir === "up" ? .35 * anatomical : dir === "down" ? -.4 * anatomical : side * .45;
    return lean - side * swing * 1.9;
}

/** Shared attachment for sprite and light map, relative to the foot line. */
export function toolAttachment(p, hand = "right") {
    const pose = posture(p), rig = armRig(p, pose);
    const dir = p.dir || "down";
    const angle = heldToolAngle(dir, pose.side, p.actionHand && p.actionHand !== hand ? 0 : pose.swing, hand);
    const gx = rig[hand].ex, gy = rig[hand].ey + BODY.handH / 2 - 0.5;
    const narrow = pose.sideView ? 1 - GAIT.slantNarrow * Math.abs(p.slant || 0) : 1;
    const flame = torchFlame(p.idleTime || 0, p.torchWind || 0, p.gait || 0);
    const localX = flame.x * (dir === "left" ? -1 : 1);
    let x = (gx + localX * Math.cos(angle) - flame.y * Math.sin(angle)) * narrow;
    let y = gy + localX * Math.sin(angle) + flame.y * Math.cos(angle);
    if (p.fallTimer > 0) {
        const f = fallPose(p), a = f.angle, xx = x;
        x = xx * Math.cos(a) - y * Math.sin(a);
        y = xx * Math.sin(a) + y * Math.cos(a) + f.y;
    }
    return { x, y, intensity: flame.intensity, gripX: gx, gripY: gy, angle, behind: hand === "right" ? rig.behind : !rig.behind };
}

/**
 * @param {CanvasRenderingContext2D} ctx translated to the character's feet
 * @param {object} p { dir, phase|anim, gait|moving, runBlend, look,
 *                     actionTimer, tool, idleTime }
 */
export function drawCharacter(ctx, p) {
    const fall = fallPose(p);
    if (!(p.fallTimer > 0)) { paintCharacter(ctx, p); return; }
    ctx.save();
    // Contact shadow stays on the ground; never rotate it with the body.
    ctx.fillStyle = "rgba(12,16,17,0.22)"; ctx.beginPath();
    ctx.ellipse(Math.sin(fall.angle) * 10, 1, 7 + fall.amount * 10, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, fall.y); ctx.rotate(fall.angle);
    paintCharacter(ctx, { ...p, _noShadow: true });
    ctx.restore();
}
function paintCharacter(ctx, p) {
    ctx.save();
    // A diagonal is drawn as the side view, turned: the body narrows a little
    // and the head leads the travel direction. Cheap, and it stops diagonal
    // movement from looking like the hero is sliding on rails.
    const slant = Math.max(-1, Math.min(1, p.slant || 0));
    const turning = slant !== 0 && (p.dir === "left" || p.dir === "right");
    if (turning) {
        ctx.save();
        ctx.scale(1 - GAIT.slantNarrow * Math.abs(slant), 1);
    }
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
    // Cast shadow: the hero is lit by the same sun and the same campfire as
    // every prop around him, so he throws the same kind of shadow. The CORE
    // below still sits strictly under the feet — that is what keeps him
    // planted while the cast part stretches away from the light.
    if (!p._noShadow) {
    ctx.save();
    // In the shallows the water takes the shadow; drawing one under a boot
    // that is underwater reads as a hole in the lake.
    if (!p.wading) {
        castShadow(ctx, SHADOW.coreRX * shrink, SHADOW.coreRY * shrink, 0.9,
                   SHADOW.castHeight, idle);
    }
    ctx.restore();
    // Halo: leans with the sun like every other shadow in the world.
    const sunLean = Math.min(1, SUN.alpha * SUN.len / 1.2);
    const lx = SUN.dx * SHADOW.sunLean * sunLean;
    const ly = SUN.dy * SHADOW.sunLean * sunLean * 0.5;
    const stretch = 1 + SHADOW.sunStretch * sunLean;
    ctx.fillStyle = `rgba(10,9,8,${SHADOW.haloA})`;
    ctx.beginPath();
    ctx.ellipse(centroid + lx, ly, SHADOW.haloRX * shrink * stretch,
                SHADOW.haloRY * shrink, Math.atan2(ly, lx) * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(10,9,8,${SHADOW.coreA})`;
    ctx.beginPath();
    ctx.ellipse(centroid, 0, SHADOW.coreRX * shrink, SHADOW.coreRY * shrink, 0, 0, Math.PI * 2);
    ctx.fill();

    }
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
        poly(ctx, [[bx + 0.7, by], [bx + bw - 0.8, by], [bx + bw, by + 1],
            [bx + bw - 0.3, by + BODY.bootH], [bx + 0.2, by + BODY.bootH], [bx, by + 1]],
            far ? PALETTE.bootFar : PALETTE.boot);
        rect(ctx, bx, by + BODY.bootH - 0.9, bw, 0.9, far ? PALETTE.soleFar : PALETTE.sole, false);
        // A lit edge on top of the boot and a dark line where it meets the
        // ground: without them the leg and the boot are one brown column.
        if (!far) {
            rect(ctx, bx, by, bw, READ.bootTop, `rgba(255,236,200,${READ.bootTopA})`, false);
        }
        rect(ctx, bx - 0.3, by + BODY.bootH - READ.footAO * 0.4, bw + 0.6, READ.footAO,
            `rgba(0,0,0,${far ? READ.footAOA * 0.7 : READ.footAOA})`, false);
        if (look.bootCuff) {                                  // gear: boot cuff
            const cw = bw * GEAR.cuffW;
            rect(ctx, ax - cw / 2 + toe * 0.6, by - GEAR.cuffH, cw, GEAR.cuffH,
                far ? shadeHex(leather, PALETTE.leatherDark) : leather);
        }
    };

    /* ---- arms: kinematics first, the tool needs the hand --------------- */
    const paintHand = (a, far) => {
        // The cuff line: a hand that butts straight onto a sleeve of the same
        // value disappears at this size.
        rect(ctx, a.ex - BODY.armW / 2 - 0.2, a.ey - 1.1, BODY.armW + 0.4, 0.7,
            `rgba(0,0,0,${READ.handEdgeA})`, false);
        ctx.fillStyle = far ? shadeHex(skin, PALETTE.skinDeep) : shadeHex(skin, PALETTE.skinLit);
        ctx.beginPath(); ctx.ellipse(a.ex, a.ey + BODY.handH / 2 - 0.5,
            BODY.armW * 0.49, BODY.handH * 0.57, 0.12, 0, Math.PI * 2); ctx.fill();
        rect(ctx, a.ex - BODY.armW / 2, a.ey - 0.5 + BODY.handH - 0.7, BODY.armW, 0.7,
            PALETTE.ao, false);
    };

    const paintArm = (a, far, hand = true) => {
        const sleeve = far ? shadeHex(shirt, PALETTE.shirtFar) : band(shirt, "deep");
        const skinC = far ? shadeHex(skin, PALETTE.skinDeep) : skin;
        limb(ctx, a.sx, a.sy, a.mx, a.my, BODY.armW * BODY.sleeveW, BODY.armW, sleeve, true);
        limb(ctx, a.mx, a.my, a.ex, a.ey, BODY.armW, BODY.armW * 0.85, skinC, true);
        if (look.bracers) {                                   // gear: bracer
            const bw = BODY.armW * GEAR.bracerW;
            rect(ctx, a.ex - bw / 2 + (a.mx - a.ex) * 0.1, a.ey - 0.6 - GEAR.bracerH, bw, GEAR.bracerH,
                far ? shadeHex(leather, PALETTE.leatherDark) : shadeHex(leather, PALETTE.leatherLit));
        }
        if (hand) paintHand(a, far);
    };

    const rig = armRig(p);
    const held = { right: p.rightTool === undefined ? p.tool : p.rightTool, left: p.leftTool || null };
    const paintHeldArm = (hand, far) => {
        const arm = rig[hand], tool = held[hand];
        paintArm(arm, far, !tool);
        if (tool) {
            const handSwing = !p.actionHand || p.actionHand === hand ? swing : 0;
            drawHeldTool(ctx, tool, dir, side, handSwing, arm, far, p, hand); paintHand(arm, far);
        }
    };
    const farHand = rig.behind ? "right" : "left";
    const farInFront = p.eatingHand === farHand || (!sideView && !back);
    if (!farInFront) paintHeldArm(farHand, true);

    if (sideView) {
        drawLeg(-0.9 * side, swingF - stance, liftF, true, side);
        drawLeg(0, swingN + stance, liftN, false, side);
    } else {
        drawLeg(-legSpread, 0, liftF, true, -0.5);
        drawLeg(legSpread, 0, liftN, false, 0.5);
        // Head-on the two legs touch and read as one block of cloth. One
        // dark seam between them is all it takes to see two legs.
        rect(ctx, sway - READ.legSeam / 2, hipY + 1, READ.legSeam,
            Math.abs(BODY.ankleY - hipY) - 1.4, `rgba(0,0,0,${READ.legSeamA})`, false);
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
    const quarter = sideView ? Math.abs(slant) : 0;
    const narrow = sideView ? (BODY.shoulderWSide + quarter * 2) / BODY.shoulderW : 1;
    const rows = [
        [top, BODY.shoulderW * 0.36 * narrow],
        [top + 1.5, BODY.shoulderW / 2 * narrow],
        [waistY, BODY.waistW / 2 * narrow],
        [bottom, BODY.hipW / 2 * narrow]
    ];
    poly(ctx, silhouette(rows), band(shirt, "base"));
    poly(ctx, stripe(rows, -1, 0, sideView ? 1.4 : 2.0), band(shirt, "lit"), false);      // sun side
    poly(ctx, stripe(rows, 1, 0, sideView ? 1.2 : 1.6), band(shirt, "dark"), false);
    poly(ctx, stripe(rows, 1, 0, 0.5), band(shirt, "deep"), false);
    rect(ctx, -rows[0][1], top, rows[0][1] * 2, PALETTE.aoW * 2, PALETTE.ao, false);   // under the collar

    // Worn waistcoat over a lighter linen shirt. Open neck, tapered panels
    // and a split hem read as clothing instead of a single rectangular torso.
    if (look.vest) {
        const vw = rows[1][1], waist = rows[2][1];
        if (back) {
            poly(ctx, [[-vw + .5, top + .5], [vw - .5, top + .5], [waist, bottom - .8],
                [0, bottom], [-waist, bottom - .8]], look.vest, false);
            rect(ctx, -.25, top + 3, .5, 6, band(look.vest, "dark"), false);
        } else {
            poly(ctx, [[-vw + .4, top + .6], [-1.9, top + .8], [-.6, top + 4.6],
                [-.6, bottom - 1], [-2.1, bottom + .3], [-waist, bottom - .8]], look.vest, false);
            poly(ctx, [[vw - .4, top + .6], [1.8, top + .8], [.6, top + 4.6],
                [.6, bottom - 1], [2.1, bottom + .3], [waist, bottom - .8]], band(look.vest, "dark"), false);
            ctx.strokeStyle = "#a69a73"; ctx.lineWidth = .35;
            ctx.beginPath(); ctx.moveTo(-1.9, top + 1); ctx.lineTo(-.6, top + 4.6); ctx.lineTo(-.6, bottom - 2); ctx.stroke();
            rect(ctx, -waist + .8, top + 7, 1.9, .45, band(look.vest, "lit"), false);
        }
    }

    if (back) {
        rect(ctx, -0.5, top + 1.5, 1, BODY.torsoH - 4, PALETTE.ao, false);            // spine seam
    } else if (!sideView) {
        rect(ctx, -2, top, 4, 1.5, band(shirt, "dark"), false);                        // collar
    }

    if (!back) {
        poly(ctx, [[-3, top], [3, top + 0.5], [1, top + 3], [-1.5, top + 2.5]], look.accent, false);
        poly(ctx, [[1, top + 2], [3, top + 2], [2.5 + Math.sin(idle * 1.7) * 0.7, top + 6], [0.5, top + 5]],
            shadeHex(look.accent, -16), false);
    }
    if (look.satchel) {
        // Cloth strap and a rounded pouch, not metal blocks on every joint.
        const sign = back ? -1 : 1;
        ctx.strokeStyle = "#46392a"; ctx.lineWidth = 1.9;
        ctx.beginPath(); ctx.moveTo(-3.5 * sign, top + 0.6); ctx.lineTo(3.1 * sign, bottom - 1); ctx.stroke();
        ctx.strokeStyle = "#99805a"; ctx.lineWidth = 0.7; ctx.stroke();
        poly(ctx, [[2 * sign, bottom - 3], [5.6 * sign, bottom - 2.4], [6 * sign, bottom + 1.5],
            [4.8 * sign, bottom + 2.7], [2.1 * sign, bottom + 2.1]], PALETTE.leather, false);
        rect(ctx, 2.6 * sign, bottom - 1.7, 2.2, 0.6, "#a88c5c", false);
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
    paintPauldrons();

    /* ---- head: authored silhouette, narrow neck, shaped hair and jaw ---- */
    drawHead(ctx, {
        x: (sideView ? side * 0.5 : 0) + counter * 0.5 + Math.sin(idle * 0.65) * 0.35 * (1 - g),
        y: BODY.headY - bob + (turning ? GAIT.slantHead * slant : 0),
        dir, slant, look, time: idle
    });

    ctx.restore();

    if (farInFront) paintHeldArm(farHand, false);
    paintHeldArm(rig.behind ? "left" : "right", false);
    // --- the waterline -------------------------------------------------
    if (p.wading) {
        const t = idle * WADE.breatheHz;
        const grow = 1 + Math.sin(t) * (WADE.breathe / WADE.ringRX);
        ctx.globalAlpha = 1;
        // Ring on the surface around the legs.
        ctx.strokeStyle = `rgba(226,246,255,${WADE.ringA})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.ellipse(0, WADE.lineY, WADE.ringRX * grow, WADE.ringRY * grow, 0, 0, Math.PI * 2);
        ctx.stroke();
        // The water itself over the boots…
        ctx.fillStyle = `rgba(79,143,168,${WADE.bodyA})`;
        ctx.beginPath();
        ctx.ellipse(0, WADE.lineY, WADE.rx, WADE.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        // …and the collar of foam where body meets surface.
        ctx.strokeStyle = `rgba(236,252,255,${WADE.foamA})`;
        ctx.lineWidth = WADE.foamW;
        ctx.beginPath();
        ctx.ellipse(0, WADE.lineY, WADE.rx, WADE.ry, 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    if (turning) ctx.restore();
    ctx.restore();
}

/**
 * Draw the held tool at the hand. `dir` decides which side of the body the
 * grip sits on; the tool is rotated around the grip when swinging.
 */
function drawHeldTool(ctx, tool, dir, side, swing, arm, behind, pose = {}, hand = "right") {
    // The grip IS the hand of the tool arm — passing a fixed GRIP_Y used to
    // leave the knife floating next to a second, phantom hand.
    const gx = arm.ex, gy = arm.ey + BODY.handH / 2 - 0.5;
    const angle = heldToolAngle(dir, side, swing, hand);

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
        case "torch": drawTorch(ctx, pose); break;
        case "food":
            ctx.fillStyle = itemId === "berry" ? "#555984" : itemId.includes("tea") ? "#b3aa88" : "#b18b54";
            ctx.beginPath(); ctx.ellipse(0, -2, itemId === "berry" ? 1.4 : 2.6, itemId === "berry" ? 1.2 : 2.2, 0, 0, Math.PI * 2); ctx.fill(); break;
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

function drawTorch(ctx, pose) {
    ctx.fillStyle = "#5e4228"; ctx.fillRect(-1.2, -11, 2.4, 13);
    ctx.fillStyle = "#95704a"; ctx.fillRect(-1.2, -10, 0.7, 9);
    ctx.fillStyle = "#302b22"; ctx.fillRect(-2.1, -13.5, 4.2, 3.2);
    paintTorchFlame(ctx, pose.idleTime || 0, pose.torchWind || 0, pose.gait || 0);
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
