/**
 * v3 render — procedural character sprite.
 *
 * Drawn from primitives so appearance (hair, clothes, skin) is data, not an
 * atlas: the same function draws settlers, travellers and raiders by swapping
 * the palette.
 *
 * THE CONTRACT LIVES IN charspec.js. There are no magic numbers in here — if
 * you want to change a proportion, a colour or the length of a stride, edit
 * the spec. This file only knows how to paint what the spec describes.
 *
 * Locomotion is DISTANCE DRIVEN: the caller advances `phase` by
 * 2π · travelled / stride (see entities/player.js), and the swing amplitude in
 * the spec is exactly stride/4, so a planted foot moves with the ground
 * instead of skating. The hips rise when the legs pass under the body
 * (|cos φ|), which is what makes the torso and the legs read as one creature.
 *
 * Body frame: origin between the feet, on the ground; up is negative Y.
 */
import { BODY, PALETTE, SHADOW, GAIT, ACTION, clamp01, easeInOutSine, q } from "./charspec.js";

export const DEFAULT_LOOK = {
    skin: "#e2b48a",
    hair: "#4a3526",
    shirt: "#6d7f4a",
    pants: "#4a4034",
    cloak: null,
    hairStyle: "short"
};

function shadeHex(hex, amount) {
    const c = hex.replace("#", "");
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + amount)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/* --- primitives: everything lands on the pixel grid and carries the same
       silhouette outline, so the hero reads on grass, ash, sand and water -- */

function rect(ctx, x, y, w, h, fill, outline = true) {
    const x0 = q(x), y0 = q(y), x1 = q(x + w), y1 = q(y + h);
    ctx.fillStyle = fill;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (outline) {
        ctx.strokeStyle = PALETTE.outline;
        ctx.lineWidth = PALETTE.outlineW;
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
}

/** A tapered quad between two joints — thigh, shin, upper arm, forearm. */
function limb(ctx, x0, y0, x1, y1, w0, w1, fill, outline = true) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 0.001;
    const nx = -dy / len, ny = dx / len;
    ctx.beginPath();
    ctx.moveTo(q(x0 + nx * w0 / 2), q(y0 + ny * w0 / 2));
    ctx.lineTo(q(x1 + nx * w1 / 2), q(y1 + ny * w1 / 2));
    ctx.lineTo(q(x1 - nx * w1 / 2), q(y1 - ny * w1 / 2));
    ctx.lineTo(q(x0 - nx * w0 / 2), q(y0 - ny * w0 / 2));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (outline) {
        ctx.strokeStyle = PALETTE.outline;
        ctx.lineWidth = PALETTE.outlineW;
        ctx.stroke();
    }
}

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
 * @param {CanvasRenderingContext2D} ctx translated to the character's feet
 * @param {object} p { dir, phase|anim, gait|moving, runBlend, look,
 *                     actionTimer, tool, idleTime }
 */
export function drawCharacter(ctx, p) {
    const look = Object.assign({}, DEFAULT_LOOK, p.look || {});
    const dir = p.dir || "down";
    const idle = p.idleTime || 0;

    /* ---- pose: pure numbers first, paint second ------------------------ */
    const phase = (p.phase != null ? p.phase : p.anim) || 0;
    const gaitRaw = clamp01(p.gait != null ? p.gait : (p.moving ? 1 : 0));
    const g = easeInOutSine(gaitRaw);                 // the one easing
    const run = clamp01(p.runBlend != null ? p.runBlend : 0);

    const side = dir === "left" ? -1 : 1;
    const back = dir === "up";
    const sideView = dir === "left" || dir === "right";

    // Stride -> swing amplitude. stride/4 units of foot travel per step is
    // exactly the ground covered per step, so the plant does not slide.
    const strideU = (GAIT.strideWalk + (GAIT.strideRun - GAIT.strideWalk) * run) / GAIT.pxPerUnit;
    const amp = strideU / 4;
    const liftAmp = GAIT.liftWalk + (GAIT.liftRun - GAIT.liftWalk) * run;
    const bobAmp = GAIT.bobWalk + (GAIT.bobRun - GAIT.bobWalk) * run;

    const swingN = Math.sin(phase) * amp * g;                 // near leg, forward+
    const swingF = Math.sin(phase + Math.PI) * amp * g;       // far leg, antiphase
    const liftN = Math.max(0, Math.cos(phase)) * liftAmp * g;
    const liftF = Math.max(0, Math.cos(phase + Math.PI)) * liftAmp * g;

    // Hips are HIGH when the legs pass under the body, LOW on contact.
    const breath = Math.sin(idle * GAIT.breathHz * Math.PI * 2) * GAIT.breathAmp;
    const bob = (Math.abs(Math.cos(phase)) - 0.5) * bobAmp * g + breath * (1 - g);
    const lean = sideView ? side * GAIT.leanRun * run * g : 0;
    const squash = -GAIT.squash * Math.cos(phase * 2) * g;    // ±3% on contact

    // Action swing: wind-up then strike, both on the same eased curve.
    const act = p.actionTimer > 0 ? clamp01(1 - p.actionTimer / 0.35) : 0;
    const swing = act > 0
        ? (act < ACTION.windUp
            ? easeInOutSine(act / ACTION.windUp) * ACTION.windAmp
            : Math.sin(((act - ACTION.windUp) / (1 - ACTION.windUp)) * Math.PI) * ACTION.strikeAmp)
        : 0;

    const skinDark = shadeHex(look.skin, PALETTE.skinShade);
    const skinLit = shadeHex(look.skin, PALETTE.skinLit);
    const shirtDark = shadeHex(look.shirt, PALETTE.shirtShade);
    const shirtLit = shadeHex(look.shirt, PALETTE.shirtLit);
    const pantsDark = shadeHex(look.pants, PALETTE.pantsShade);

    /* ---- contact shadow, under the FEET, not under the sprite ---------- */
    const hipY = BODY.hipY - bob;
    const groundY = BODY.ankleY + BODY.bootH;                 // sole line
    const legSpread = BODY.legW / 2 + BODY.legGap / 2;
    const stance = sideView ? side * BODY.idleStance * (1 - g) : 0;   // feet apart when idle
    const footNX = sideView ? swingN + stance : legSpread;
    const footFX = sideView ? -0.9 * side + swingF - stance : -legSpread;
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
        const ax = hipX + footX, ay = BODY.ankleY - lift;
        const kn = knee(hipX, hipY, ax, ay, bendDir);
        const cloth = far ? shadeHex(look.pants, PALETTE.pantsFar) : shadeHex(look.pants, PALETTE.pantsLit);
        limb(ctx, hipX, hipY, kn.x, kn.y, BODY.legW, BODY.legW * 0.92, cloth);
        limb(ctx, kn.x, kn.y, ax, ay, BODY.legW * 0.92, BODY.legW * 0.82,
            far ? cloth : shadeHex(look.pants, PALETTE.pantsShade * 0.4));
        // Boot: the toe points the way the hero faces. Head-on the boots are
        // narrower so the two feet never merge into one dark block.
        const toe = sideView ? side * BODY.bootToe : 0;
        const bw = sideView ? BODY.bootW : BODY.bootW * 0.8;
        rect(ctx, ax - bw / 2 + toe, ay - 0.4, bw, BODY.bootH,
            far ? PALETTE.bootFar : PALETTE.boot);
        rect(ctx, ax - bw / 2 + toe, ay - 0.4 + BODY.bootH - 0.8, bw, 0.8,
            far ? PALETTE.soleFar : PALETTE.sole, false);
    };

    const drawArm = (shoulderX, reach, lift, far) => {
        const sx = shoulderX, sy = BODY.armY - bob + lean;
        const ex = sx + reach, ey = sy + BODY.armLen - Math.abs(reach) * 0.25 - lift;
        const el = { x: (sx + ex) / 2 + reach * 0.1, y: (sy + ey) / 2 };
        const sleeve = far ? shadeHex(look.shirt, PALETTE.shirtFar) : shirtDark;
        const skinC = far ? shadeHex(look.skin, PALETTE.skinDeep) : look.skin;
        limb(ctx, sx, sy, el.x, el.y, BODY.armW * BODY.sleeveW, BODY.armW, sleeve);  // sleeve
        limb(ctx, el.x, el.y, ex, ey, BODY.armW, BODY.armW * 0.85, skinC);           // forearm
        rect(ctx, ex - BODY.armW / 2, ey - 0.5, BODY.armW, BODY.handH,               // hand
            far ? shadeHex(look.skin, PALETTE.skinDeep) : skinLit, !far);
    };

    const armAmp = amp * GAIT.armRatio * g;
    const armAmpTool = amp * GAIT.armRatioTool * g;

    // Far arm and the far leg go behind the body.
    if (sideView) drawArm(-BODY.farArmX * side, -side * Math.sin(phase) * armAmp, 0, true);
    if (p.tool && back) drawHeldTool(ctx, p.tool, dir, side, swing, -bob, true);

    if (sideView) {
        drawLeg(-0.9 * side, swingF - stance, liftF, true, side);
        drawLeg(0, swingN + stance, liftN, false, side);
    } else {
        drawLeg(-legSpread, 0, liftF, true, -0.5);
        drawLeg(legSpread, 0, liftN, false, 0.5);
    }

    /* ---- torso + head: one group, one transform ------------------------ */
    ctx.save();
    ctx.translate(lean, 0);
    ctx.translate(0, hipY);
    ctx.scale(1 + squash * 0.5, 1 - squash);                  // squash & stretch
    ctx.translate(0, -hipY);

    const torsoTop = BODY.torsoY - bob;
    const torsoW = sideView ? BODY.shoulderWSide : BODY.shoulderW;
    const torsoX = -torsoW / 2;
    const torsoH = BODY.torsoH;
    rect(ctx, torsoX, torsoTop, torsoW, torsoH, look.shirt);
    rect(ctx, torsoX, torsoTop, 2, torsoH - 2, shirtLit, false);          // light upper-left
    rect(ctx, torsoX + torsoW - 2, torsoTop, 2, torsoH, shirtDark, false);
    rect(ctx, torsoX, torsoTop, torsoW, 1, "rgba(0,0,0,0.18)", false);    // shoulder line
    if (back) {
        rect(ctx, -0.5, torsoTop + 1, 1, torsoH - 3, "rgba(0,0,0,0.12)", false);
        rect(ctx, -4, torsoTop + 1.5, 3, 1, shirtLit, false);
        rect(ctx, 1, torsoTop + 1.5, 3, 1, shirtLit, false);
    } else if (!sideView) {
        rect(ctx, -2, torsoTop, 4, 1.5, shirtDark, false);                // collar
    }
    rect(ctx, torsoX, torsoTop + torsoH - 2, torsoW, 2, PALETTE.belt, false);
    rect(ctx, sideView ? side * 1.5 - 1 : -1, torsoTop + torsoH - 1.5, 2, 1.5, PALETTE.buckle, false);
    if (look.cloak) {
        rect(ctx, torsoX - 1, torsoTop - 0.5, torsoW + 2, 7.5, look.cloak);
        rect(ctx, torsoX + torsoW - 1.5, torsoTop - 0.5, 3.5, 7.5, "rgba(0,0,0,0.2)", false);
    }
    rect(ctx, torsoX, torsoTop, PALETTE.rimW, torsoH - 2, PALETTE.rim, false);   // rim light

    /* ---- near arm ------------------------------------------------------- */
    if (sideView) {
        const reach = side * (Math.sin(phase) * armAmpTool + swing * 2.2);
        drawArm(BODY.nearArmX * side, reach, Math.max(0, swing) * 1.5, false);
    } else {
        const ax0 = BODY.shoulderW / 2 + BODY.armW / 2 - 0.4;  // clear of the shirt
        drawArm(-ax0, 0, (back ? 1 : -1) * Math.sin(phase) * armAmp, false);
        drawArm(ax0, 0, (back ? -1 : 1) * Math.sin(phase) * armAmpTool - swing * 2.2, false);
    }

    /* ---- head ----------------------------------------------------------- */
    const headY = BODY.headY - bob;
    const headH = BODY.headH, headW = BODY.headW;
    const headX = sideView ? side * 0.5 : 0;
    rect(ctx, -2.5, headY + headH - 0.5, 5, 1.5, "rgba(0,0,0,0.16)", false);   // neck shade
    rect(ctx, headX - headW / 2, headY, headW, headH, look.skin);
    rect(ctx, headX + headW / 2 - 2, headY + 1, 2, headH - 1, skinDark, false);
    rect(ctx, headX - headW / 2, headY + 1, 1.5, headH - 2, skinLit, false);
    rect(ctx, headX - headW / 2, headY + 1, PALETTE.rimW, headH - 3, PALETTE.rim, false);
    if (back) rect(ctx, headX - headW / 2, headY + headH - 2.5, headW, 2.5, skinDark, false);

    const hairDark = shadeHex(look.hair, PALETTE.hairShade);
    const hairLit = shadeHex(look.hair, PALETTE.hairLit);
    if (back) {
        rect(ctx, headX - headW / 2 - 0.5, headY - 1, headW + 1, headH - 1.5, look.hair);
        rect(ctx, headX + headW / 2 - 2.5, headY - 1, 2.5, headH - 1.5, hairDark, false);
        rect(ctx, headX - headW / 2 + 1, headY - 0.5, 3.5, 1.5, hairLit, false);
        rect(ctx, headX - 3, headY + headH - 2.5, 6, 1.5, hairDark, false);
    } else {
        rect(ctx, headX - headW / 2 - 0.5, headY - 1, headW + 1, 4, look.hair);
        rect(ctx, headX + headW / 2 - 2.5, headY - 1, 2.5, 4, hairDark, false);
        if (look.hairStyle === "long") {
            rect(ctx, headX - headW / 2 - 1.5, headY, 2, 7.5, look.hair, false);
            rect(ctx, headX + headW / 2 - 0.5, headY, 2, 7.5, look.hair, false);
        } else {
            rect(ctx, headX - headW / 2 - 1, headY + 0.5, 1.5, 2.5, look.hair, false);
            rect(ctx, headX + headW / 2 - 0.5, headY + 0.5, 1.5, 2.5, look.hair, false);
        }
        rect(ctx, headX - headW / 2 + 1, headY - 0.5, 3, 1, hairLit, false);
    }

    if (!back) {
        const blink = (idle % GAIT.blinkEvery) < GAIT.blinkFor;
        const eyeH = blink ? 0.5 : 1.5, eyeW = 1.5;
        const eyeY = headY + (blink ? 5.5 : 4.5);
        if (dir === "left") {
            rect(ctx, headX - 3.5, eyeY, eyeW, eyeH, PALETTE.eye, false);
            rect(ctx, headX - headW / 2 - 0.5, headY + 4.5, 1, 1.5, skinDark, false);   // nose
            rect(ctx, headX - 4, headY + 7, 2.5, 1, "rgba(0,0,0,0.2)", false);
        } else if (dir === "right") {
            rect(ctx, headX + 2, eyeY, eyeW, eyeH, PALETTE.eye, false);
            rect(ctx, headX + headW / 2 - 0.5, headY + 4.5, 1, 1.5, skinDark, false);
            rect(ctx, headX + 1.5, headY + 7, 2.5, 1, "rgba(0,0,0,0.2)", false);
        } else {
            rect(ctx, headX - 3, eyeY, eyeW, eyeH, PALETTE.eye, false);
            rect(ctx, headX + 1.5, eyeY, eyeW, eyeH, PALETTE.eye, false);
            rect(ctx, headX - 1, headY + 7, 2, 1, "rgba(0,0,0,0.16)", false);
        }
    }

    ctx.restore();

    // Tool in the near hand, in front of the body.
    if (p.tool && !back) drawHeldTool(ctx, p.tool, dir, side, swing, -bob, false);
}

/**
 * Draw the held tool at the hand. `dir` decides which side of the body the
 * grip sits on; the tool is rotated around the grip when swinging.
 */
function drawHeldTool(ctx, tool, dir, side, swing, bob, behind) {
    const gx = (dir === "down" ? BODY.gripX - 0.2 : dir === "up" ? -BODY.gripX + 0.2 : side * BODY.gripX);
    const gy = BODY.gripY + bob + (dir === "up" ? -0.5 : 0);
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
        case "knife": drawKnife(ctx); break;
        case "spear": drawSpear(ctx); break;
        case "rod": drawRod(ctx); break;
        case "hoe": drawHoe(ctx); break;
        case "torch": drawTorch(ctx); break;
        default: drawGeneric(ctx); break;
    }

    // The hand itself, over the handle, so the grip reads as a grip.
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#e2b48a";
    ctx.fillRect(-1.5, -1.6, 3, 3.2);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(-1.5, 0.8, 3, 0.8);
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
