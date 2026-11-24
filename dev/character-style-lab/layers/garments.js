import { palette } from './palette.js';
import { ellipse, limb, line, path } from './primitives.js';

function wetFinish(ctx, wetness, clip, bounds) {
  if (wetness < 0.015) return;
  ctx.save();
  ctx.beginPath();
  clip(ctx);
  ctx.clip();
  const glaze = ctx.createLinearGradient(bounds.x, bounds.y, bounds.x, bounds.y + bounds.height);
  glaze.addColorStop(0, '#31616e');
  glaze.addColorStop(1, '#1b3540');
  ctx.globalAlpha = 0.05 + wetness * 0.24;
  ctx.fillStyle = glaze;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.globalAlpha = wetness * 0.3;
  ctx.strokeStyle = '#cfe9e6';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (const [x, y, length] of [[356, 244, 22], [398, 268, 28], [372, 312, 16]]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 4, y + length * 0.5, x - 1, y + length);
    ctx.stroke();
  }
  ctx.restore();
}

function alongArm(arm, t) {
  const a = arm.shoulder, b = arm.elbow, c = arm.wrist;
  if (t <= 0.5) return { x: a.x + (b.x - a.x) * (t / 0.5), y: a.y + (b.y - a.y) * (t / 0.5) };
  return { x: b.x + (c.x - b.x) * ((t - 0.5) / 0.5), y: b.y + (c.y - b.y) * ((t - 0.5) / 0.5) };
}

/* ---------------------------------------------------------------- cloak */

function drawCloakShape(ctx) {
  ctx.moveTo(339, 212);
  ctx.quadraticCurveTo(360, 193, 380, 197);
  ctx.quadraticCurveTo(400, 193, 421, 212);
  ctx.quadraticCurveTo(437, 268, 429, 360);
  ctx.lineTo(415, 418);
  ctx.quadraticCurveTo(400, 411, 390, 409);
  ctx.lineTo(380, 424);
  ctx.lineTo(370, 409);
  ctx.quadraticCurveTo(360, 411, 345, 418);
  ctx.lineTo(331, 360);
  ctx.quadraticCurveTo(323, 268, 339, 212);
  ctx.closePath();
}

export function drawCloakLayer(ctx, state, pose) {
  if (!state.garments.cloak) return;
  path(ctx, drawCloakShape, palette.cloak, palette.ink, 2.6);
  path(ctx, c => {
    c.moveTo(344, 226); c.quadraticCurveTo(356, 262, 352, 318); c.lineTo(362, 404);
    c.quadraticCurveTo(370, 399, 378, 407); c.lineTo(377, 254); c.closePath();
  }, '#2c3826', null);
  path(ctx, c => {
    c.moveTo(417, 226); c.quadraticCurveTo(405, 264, 409, 320); c.lineTo(399, 402);
    c.quadraticCurveTo(391, 397, 383, 407); c.lineTo(384, 254); c.closePath();
  }, palette.cloakLight, null);
  path(ctx, c => {
    c.moveTo(352, 214); c.quadraticCurveTo(380, 236, 408, 214);
    c.lineTo(399, 238); c.quadraticCurveTo(380, 249, 361, 238); c.closePath();
  }, '#55643f', palette.inkSoft, 1.2);
  ellipse(ctx, 380, 224, 3.6, 3.6, palette.brass, palette.ink, 1);
  wetFinish(ctx, state.wetness, drawCloakShape, { x: 322, y: 196, width: 116, height: 226 });
}

/* -------------------------------------------------------------- trousers */

function trouserYoke(ctx) {
  ctx.moveTo(346, 318);
  ctx.quadraticCurveTo(380, 330, 414, 318);
  ctx.lineTo(417, 342);
  ctx.quadraticCurveTo(398, 372, 386, 384);
  ctx.lineTo(380, 372);
  ctx.lineTo(374, 384);
  ctx.quadraticCurveTo(362, 372, 343, 342);
  ctx.closePath();
}

function drawTrousers(ctx, state, pose) {
  if (!state.garments.trousers) return;
  for (const part of pose.legs) {
    const top = { x: part.hip.x, y: part.hip.y - 14 };
    limb(ctx, [[top.x, top.y], [part.knee.x, part.knee.y], [part.ankle.x, part.ankle.y - 34]], palette.trousers, 30);
    path(ctx, c => {
      c.moveTo(part.hip.x - 9, part.hip.y - 6);
      c.quadraticCurveTo(part.knee.x - 11, part.knee.y - 14, part.knee.x - 6, part.knee.y + 12);
      c.quadraticCurveTo(part.ankle.x - 9, part.ankle.y - 42, part.ankle.x - 7, part.ankle.y - 30);
    }, null, '#54545f', 1.9);
    path(ctx, c => {
      c.moveTo(part.hip.x + 8, part.hip.y - 2);
      c.quadraticCurveTo(part.knee.x + 12, part.knee.y - 10, part.knee.x + 6, part.knee.y + 12);
      c.quadraticCurveTo(part.ankle.x + 10, part.ankle.y - 40, part.ankle.x + 8, part.ankle.y - 30);
    }, null, palette.trousersDeep, 3.2);
    path(ctx, c => {
      c.moveTo(part.knee.x - 8, part.knee.y - 1); c.quadraticCurveTo(part.knee.x, part.knee.y - 6, part.knee.x + 8, part.knee.y - 1);
      c.moveTo(part.knee.x - 6, part.knee.y + 5); c.quadraticCurveTo(part.knee.x, part.knee.y + 1, part.knee.x + 6, part.knee.y + 5);
    }, null, palette.trousersShade, 1.5);
    line(ctx, [[part.ankle.x - 8, part.ankle.y - 36], [part.ankle.x + 7, part.ankle.y - 33]], palette.trousersShade, 1.6);
    const lx = Math.min(part.hip.x, part.ankle.x) - 18;
    wetFinish(ctx, state.wetness, c => {
      c.moveTo(part.hip.x - 15, top.y - 6); c.lineTo(part.hip.x + 15, top.y - 6);
      c.lineTo(part.ankle.x + 15, part.ankle.y - 32); c.lineTo(part.ankle.x - 15, part.ankle.y - 32); c.closePath();
    }, { x: lx, y: top.y - 6, width: 36, height: part.ankle.y - top.y + 26 });
  }
  path(ctx, trouserYoke, palette.trousers, palette.ink, 2.2);
  path(ctx, c => {
    c.moveTo(380, 336); c.lineTo(380, 370);
    c.moveTo(376, 338); c.quadraticCurveTo(371, 356, 366, 366);
  }, null, palette.trousersDeep, 1.6);
  path(ctx, c => {
    c.moveTo(350, 338); c.quadraticCurveTo(361, 347, 371, 348);
    c.moveTo(410, 338); c.quadraticCurveTo(399, 347, 389, 348);
  }, null, '#50505a', 1.3);
  if (!pose.isBack) {
    path(ctx, c => {
      c.moveTo(349, 326); c.quadraticCurveTo(361, 334, 371, 334); c.lineTo(369, 348); c.quadraticCurveTo(358, 348, 347, 340); c.closePath();
      c.moveTo(411, 326); c.quadraticCurveTo(399, 334, 389, 334); c.lineTo(391, 348); c.quadraticCurveTo(402, 348, 413, 340); c.closePath();
    }, '#52525d', '#2c2c34', 1.2);
  }
  wetFinish(ctx, state.wetness, trouserYoke, { x: 343, y: 316, width: 74, height: 70 });
}

/* ----------------------------------------------------------------- shirt */

function shirtShape(ctx) {
  ctx.moveTo(350, 212);
  ctx.quadraticCurveTo(364, 200, 380, 204);
  ctx.quadraticCurveTo(396, 200, 410, 212);
  ctx.lineTo(414, 348);
  ctx.quadraticCurveTo(380, 360, 346, 348);
  ctx.closePath();
}

function drawShirtTorso(ctx, state) {
  if (!state.garments.shirt) return;
  path(ctx, shirtShape, palette.shirt, palette.ink, 2.1);
  path(ctx, c => {
    c.moveTo(356, 218); c.quadraticCurveTo(352, 270, 355, 334);
    c.lineTo(349, 336); c.lineTo(350, 222); c.closePath();
  }, palette.shirtDeep, null);
  path(ctx, c => {
    c.moveTo(404, 218); c.quadraticCurveTo(408, 272, 406, 334);
    c.lineTo(412, 336); c.lineTo(411, 222); c.closePath();
  }, palette.shirtShade, null);
  path(ctx, c => {
    c.moveTo(355, 210); c.quadraticCurveTo(368, 228, 380, 232);
    c.quadraticCurveTo(392, 228, 405, 210);
    c.lineTo(397, 205); c.quadraticCurveTo(380, 219, 363, 205); c.closePath();
  }, palette.shirtLight, palette.inkSoft, 1.2);
  for (const y of [238, 249]) ellipse(ctx, 380, y, 1.2, 1.2, palette.shirtDeep, null);
  path(ctx, c => {
    c.moveTo(362, 250); c.quadraticCurveTo(366, 278, 362, 312);
    c.moveTo(398, 254); c.quadraticCurveTo(394, 284, 399, 318);
  }, null, palette.shirtShade, 1.5);
  path(ctx, c => {
    c.moveTo(366, 296); c.quadraticCurveTo(380, 302, 394, 296);
    c.moveTo(356, 322); c.quadraticCurveTo(380, 334, 404, 322);
  }, null, palette.shirtShade, 1.4);
  // Cast shadow from the jacket edges onto the shirt.
  path(ctx, c => {
    c.moveTo(368, 236); c.lineTo(375, 238); c.lineTo(375, 344); c.lineTo(368, 341); c.closePath();
    c.moveTo(392, 238); c.lineTo(385, 236); c.lineTo(385, 341); c.lineTo(392, 344); c.closePath();
  }, '#c9bd9780', null);
  if (state.garments.trousers) {
    path(ctx, c => {
      c.moveTo(349, 316); c.quadraticCurveTo(380, 326, 411, 316);
      c.lineTo(412, 330); c.quadraticCurveTo(380, 340, 348, 330); c.closePath();
    }, palette.leatherDark, palette.ink, 1.4);
    path(ctx, c => {
      c.moveTo(352, 320); c.quadraticCurveTo(380, 329, 408, 320);
      c.lineTo(408, 325); c.quadraticCurveTo(380, 334, 352, 325); c.closePath();
    }, palette.leather, null);
    path(ctx, c => {
      c.moveTo(373, 318); c.lineTo(387, 318); c.lineTo(387, 336); c.lineTo(373, 336); c.closePath();
    }, palette.metal, palette.ink, 1.5);
    path(ctx, c => {
      c.moveTo(375, 322); c.lineTo(385, 322); c.lineTo(385, 332); c.lineTo(375, 332); c.closePath();
    }, palette.leatherDark, null);
    line(ctx, [[380, 320], [380, 334]], palette.metalLight, 1.6);
  }
  wetFinish(ctx, state.wetness, shirtShape, { x: 346, y: 200, width: 68, height: 160 });
}

function drawShirtSleeves(ctx, pose) {
  for (const arm of pose.arms) {
    const end = alongArm(arm, 0.55);
    limb(ctx, [[arm.shoulder.x, arm.shoulder.y], [arm.elbow.x, arm.elbow.y], [end.x, end.y]], palette.shirt, 26);
    path(ctx, c => {
      c.moveTo(arm.shoulder.x - arm.side * 8, arm.shoulder.y + 6);
      c.quadraticCurveTo(arm.elbow.x - arm.side * 8, arm.elbow.y - 10, arm.elbow.x - arm.side * 3, arm.elbow.y + 12);
    }, null, palette.shirtLight, 2);
    path(ctx, c => {
      c.moveTo(arm.shoulder.x + arm.side * 9, arm.shoulder.y + 8);
      c.quadraticCurveTo(arm.elbow.x + arm.side * 9, arm.elbow.y, arm.elbow.x + arm.side * 4, arm.elbow.y + 12);
    }, null, palette.shirtShade, 2);
  }
}

function drawSleeveRolls(ctx, pose) {
  for (const arm of pose.arms) {
    const c = alongArm(arm, 0.58);
    const d = { x: arm.wrist.x - arm.elbow.x, y: arm.wrist.y - arm.elbow.y };
    const len = Math.hypot(d.x, d.y) || 1;
    const px = -d.y / len, py = d.x / len;
    const ang = Math.atan2(d.y, d.x) + Math.PI / 2;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(ang - Math.PI / 2);
    path(ctx, cc => {
      cc.moveTo(-13, -6);
      cc.quadraticCurveTo(0, -10, 13, -6);
      cc.lineTo(14, 4);
      cc.quadraticCurveTo(0, 10, -14, 4);
      cc.closePath();
    }, palette.shirt, palette.ink, 1.6);
    path(ctx, cc => {
      cc.moveTo(-12, -2); cc.quadraticCurveTo(0, 3, 12, -2);
      cc.lineTo(12, 1); cc.quadraticCurveTo(0, 6, -12, 1); cc.closePath();
    }, palette.shirtLight, palette.shirtDeep, 0.9);
    line(ctx, [[-8, -8], [-6, -1]], palette.shirtShade, 1.1);
    line(ctx, [[4, -9], [6, -2]], palette.shirtShade, 1.1);
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ coat */

function jacketPanelLeft(ctx) {
  ctx.moveTo(366, 204);
  ctx.quadraticCurveTo(352, 197, 342, 206);
  ctx.lineTo(322, 226);
  ctx.quadraticCurveTo(329, 292, 331, 352);
  ctx.lineTo(374, 356);
  ctx.lineTo(372, 262);
  ctx.lineTo(379, 232);
  ctx.closePath();
}

function jacketPanelRight(ctx) {
  ctx.moveTo(394, 204);
  ctx.quadraticCurveTo(408, 197, 418, 206);
  ctx.lineTo(438, 226);
  ctx.quadraticCurveTo(431, 292, 429, 352);
  ctx.lineTo(386, 356);
  ctx.lineTo(388, 258);
  ctx.lineTo(381, 230);
  ctx.closePath();
}

function jacketCloth(ctx) {
  jacketPanelLeft(ctx);
  ctx.moveTo(394, 204);
  jacketPanelRight(ctx);
}

function drawCoatDetails(ctx) {
  path(ctx, c => {
    c.moveTo(371, 262); c.lineTo(374, 356);
    c.moveTo(377, 232); c.lineTo(371, 262);
  }, null, palette.coatDeep, 1.6);
  path(ctx, c => {
    c.moveTo(389, 258); c.lineTo(386, 356);
    c.moveTo(383, 230); c.lineTo(389, 258);
  }, null, palette.coatDeep, 1.6);
  path(ctx, c => {
    c.moveTo(366, 204);
    c.quadraticCurveTo(356, 214, 360, 232);
    c.quadraticCurveTo(368, 224, 376, 226);
    c.lineTo(379, 232);
    c.quadraticCurveTo(372, 216, 366, 204);
    c.closePath();
  }, palette.coatLight, palette.inkSoft, 1.2);
  path(ctx, c => {
    c.moveTo(394, 204);
    c.quadraticCurveTo(404, 214, 400, 232);
    c.quadraticCurveTo(392, 224, 384, 226);
    c.lineTo(381, 230);
    c.quadraticCurveTo(388, 216, 394, 204);
    c.closePath();
  }, palette.coatHighlight, palette.inkSoft, 1.2);
  path(ctx, c => {
    c.moveTo(331, 240); c.quadraticCurveTo(340, 244, 344, 262);
    c.quadraticCurveTo(338, 300, 342, 348); c.lineTo(332, 350); c.closePath();
  }, palette.coatDark, null);
  path(ctx, c => {
    c.moveTo(429, 240); c.quadraticCurveTo(420, 244, 416, 262);
    c.quadraticCurveTo(422, 300, 418, 348); c.lineTo(428, 350); c.closePath();
  }, palette.coatDark, null);
  line(ctx, [[352, 286], [358, 318], [352, 344]], palette.coatDeep, 1.4);
  line(ctx, [[408, 288], [402, 320], [408, 344]], palette.coatDeep, 1.4);
  for (const x of [342, 404]) {
    path(ctx, c => {
      c.moveTo(x, 296); c.quadraticCurveTo(x + 14, 292, x + 26, 296);
      c.lineTo(x + 27, 322); c.quadraticCurveTo(x + 13, 327, x - 1, 322); c.closePath();
    }, palette.coatLight, palette.inkSoft, 1.4);
    path(ctx, c => {
      c.moveTo(x + 1, 300); c.quadraticCurveTo(x + 13, 294, x + 25, 300);
      c.lineTo(x + 25, 307); c.quadraticCurveTo(x + 13, 313, x + 1, 307); c.closePath();
    }, palette.coat, palette.inkSoft, 1.1);
    ellipse(ctx, x + 13, 306, 1.6, 1.6, palette.brass, palette.inkSoft, 0.6);
    line(ctx, [[x + 4, 318], [x + 22, 318]], palette.coatDeep, 0.9);
  }
  path(ctx, c => {
    c.moveTo(356, 202);
    c.quadraticCurveTo(380, 190, 404, 202);
    c.lineTo(401, 212);
    c.quadraticCurveTo(380, 202, 359, 212);
    c.closePath();
  }, palette.coatDark, palette.ink, 1.4);
  path(ctx, c => {
    c.moveTo(332, 350);
    c.quadraticCurveTo(380, 368, 428, 350);
    c.lineTo(426, 358);
    c.quadraticCurveTo(380, 376, 334, 358);
    c.closePath();
  }, '#00000030', null);
}

function drawCoatSleeves(ctx, pose) {
  for (const arm of pose.arms) {
    const cuff = alongArm(arm, 0.52);
    limb(ctx, [[arm.shoulder.x, arm.shoulder.y - 3], [arm.elbow.x, arm.elbow.y], [cuff.x, cuff.y]], palette.coat, 31);
    path(ctx, c => {
      c.moveTo(arm.shoulder.x - arm.side * 10, arm.shoulder.y + 4);
      c.quadraticCurveTo(arm.elbow.x - arm.side * 9, (arm.elbow.y + cuff.y) / 2 - 6, cuff.x - arm.side * 6, cuff.y - 6);
    }, null, palette.coatLight, 1.8);
    path(ctx, c => {
      c.moveTo(arm.shoulder.x + arm.side * 10, arm.shoulder.y + 6);
      c.quadraticCurveTo(arm.elbow.x + arm.side * 11, (arm.elbow.y + cuff.y) / 2, cuff.x + arm.side * 8, cuff.y - 2);
    }, null, palette.coatDark, 2.6);
    path(ctx, c => {
      c.moveTo(arm.elbow.x - 9, arm.elbow.y + 3);
      c.quadraticCurveTo(arm.elbow.x, arm.elbow.y + 9, arm.elbow.x + 10, arm.elbow.y + 2);
    }, null, palette.coatDeep, 1.5);
    path(ctx, c => {
      c.moveTo(cuff.x - 13, cuff.y - 5);
      c.quadraticCurveTo(cuff.x, cuff.y + 4, cuff.x + 13, cuff.y - 5);
      c.lineTo(cuff.x + 12, cuff.y + 7);
      c.quadraticCurveTo(cuff.x, cuff.y + 14, cuff.x - 12, cuff.y + 7);
      c.closePath();
    }, palette.coatLight, palette.ink, 1.5);
  }
}

/* ----------------------------------------------------------------- scarf */

function scarfBands(ctx) {
  ctx.moveTo(353, 198);
  ctx.quadraticCurveTo(380, 186, 407, 198);
  ctx.quadraticCurveTo(411, 214, 409, 224);
  ctx.quadraticCurveTo(380, 235, 349, 224);
  ctx.quadraticCurveTo(347, 210, 353, 198);
  ctx.closePath();
  ctx.moveTo(384, 218);
  ctx.quadraticCurveTo(396, 216, 403, 228);
  ctx.lineTo(400, 272);
  ctx.quadraticCurveTo(392, 279, 384, 274);
  ctx.closePath();
}

function drawScarf(ctx, state, pose) {
  if (!state.garments.scarf) return;
  const bands = pose.isBack
    ? [[352, 408, 190, 209], [350, 410, 203, 219]]
    : [[353, 407, 186, 203], [349, 411, 197, 219]];
  for (const [x1, x2, y1, y2] of bands) {
    path(ctx, c => {
      c.moveTo(x1, y1 + 6);
      c.quadraticCurveTo((x1 + x2) / 2, y1 - 6, x2, y1 + 6);
      c.quadraticCurveTo(x2 + 4, (y1 + y2) / 2, x2 - 1, y2);
      c.quadraticCurveTo((x1 + x2) / 2, y2 + 9, x1 + 1, y2);
      c.quadraticCurveTo(x1 - 4, (y1 + y2) / 2, x1, y1 + 6);
      c.closePath();
    }, palette.scarf, palette.ink, 1.8);
  }
  path(ctx, c => {
    c.moveTo(351, 205);
    c.quadraticCurveTo(380, 215, 409, 205);
    c.quadraticCurveTo(380, 222, 351, 205);
  }, palette.scarfShadow, null);
  path(ctx, c => {
    c.moveTo(357, 191); c.quadraticCurveTo(380, 183, 403, 191);
    c.quadraticCurveTo(380, 190, 357, 191);
  }, palette.scarfLight, null);
  for (const x of [361, 372, 383, 394, 402]) line(ctx, [[x, 195], [x + 1, 202]], palette.scarfShadow, 1);
  for (const x of [356, 368, 380, 392, 404]) line(ctx, [[x, 207], [x + 1, 215]], palette.scarfShadow, 1);
  if (!pose.isBack) {
    path(ctx, c => {
      c.moveTo(390, 214);
      c.quadraticCurveTo(399, 217, 401, 228);
      c.lineTo(398, 264);
      c.quadraticCurveTo(393, 270, 387, 268);
      c.lineTo(385, 232);
      c.closePath();
    }, palette.scarf, palette.ink, 1.6);
    path(ctx, c => {
      c.moveTo(397, 224); c.quadraticCurveTo(400, 236, 398, 262);
      c.lineTo(393, 260); c.lineTo(394, 228); c.closePath();
    }, palette.scarfShadow, null);
    path(ctx, c => {
      c.moveTo(388, 222); c.quadraticCurveTo(393, 228, 392, 256);
      c.lineTo(389, 258); c.lineTo(386, 230); c.closePath();
    }, palette.scarf, null);
    for (const x of [388, 391.5, 395, 398]) line(ctx, [[x, 266], [x + 0.5, 274]], palette.scarfShadow, 1.3);
    path(ctx, c => {
      c.moveTo(386, 210);
      c.quadraticCurveTo(395, 206, 402, 214);
      c.quadraticCurveTo(396, 222, 388, 219);
      c.closePath();
    }, palette.scarfLight, palette.ink, 1.2);
  }
  if (!pose.isBack) wetFinish(ctx, state.wetness, scarfBands, { x: 347, y: 186, width: 60, height: 96 });
}

/* ----------------------------------------------------------------- boots */

function bootShape(ctx, a) {
  ctx.moveTo(a.x - 14, a.y - 46);
  ctx.quadraticCurveTo(a.x, a.y - 52, a.x + 14, a.y - 46);
  ctx.lineTo(a.x + 13, a.y - 2);
  ctx.quadraticCurveTo(a.x + 24, a.y + 5, a.x + 22, a.y + 16);
  ctx.quadraticCurveTo(a.x + 2, a.y + 27, a.x - 20, a.y + 20);
  ctx.quadraticCurveTo(a.x - 24, a.y + 8, a.x - 13, a.y - 2);
  ctx.closePath();
}

function drawBoots(ctx, state, pose) {
  if (!state.garments.boots) return;
  for (const leg of pose.legs) {
    const a = { x: leg.ankle.x, y: leg.ankle.y };
    const top = a.y - 46;
    path(ctx, c => bootShape(c, a), palette.boots, palette.ink, 1.8);
    path(ctx, c => {
      c.moveTo(a.x - 12, top + 4);
      c.quadraticCurveTo(a.x, top - 5, a.x + 12, top + 4);
      c.lineTo(a.x + 13, top + 15);
      c.quadraticCurveTo(a.x, top + 21, a.x - 13, top + 15);
      c.closePath();
    }, palette.bootsCuff, palette.ink, 1.4);
    path(ctx, c => {
      c.moveTo(a.x - 9, top + 10);
      c.quadraticCurveTo(a.x, top + 16, a.x + 9, top + 10);
    }, null, palette.bootsShade, 1.2);
    for (let i = 0; i < 4; i += 1) {
      const y = top + 22 + i * 8.5;
      line(ctx, [[a.x - 8, y], [a.x + 8, y + 1.5]], palette.laces, 2);
      line(ctx, [[a.x - 8, y + 2.6], [a.x + 8, y + 4]], '#8a6238', 1);
    }
    path(ctx, c => {
      c.moveTo(a.x + 10, a.y + 5);
      c.quadraticCurveTo(a.x + 21, a.y + 8, a.x + 20, a.y + 15);
      c.quadraticCurveTo(a.x + 11, a.y + 20, a.x + 3, a.y + 18);
      c.closePath();
    }, palette.bootsShade, null);
    path(ctx, c => {
      c.moveTo(a.x - 19, a.y + 14);
      c.quadraticCurveTo(a.x + 2, a.y + 24, a.x + 21, a.y + 15);
      c.lineTo(a.x + 20, a.y + 21);
      c.quadraticCurveTo(a.x + 2, a.y + 29, a.x - 18, a.y + 21);
      c.closePath();
    }, palette.bootsSole, palette.ink, 1);
    line(ctx, [[a.x - 11, top + 17], [a.x - 9, a.y - 4]], palette.bootsLight, 1.6);
    line(ctx, [[a.x + 10, top + 17], [a.x + 9, a.y - 2]], palette.bootsShade, 1.8);
    wetFinish(ctx, state.wetness, c => bootShape(c, a), { x: a.x - 24, y: top - 6, width: 50, height: 80 });
  }
}

/* ---------------------------------------------------------------- stitch */

export function drawClothingFrontLayers(ctx, state, pose) {
  drawTrousers(ctx, state, pose);
  drawShirtTorso(ctx, state);
  if (state.garments.shirt) drawShirtSleeves(ctx, pose);
  if (state.garments.coat) {
    path(ctx, jacketPanelLeft, palette.coat, palette.ink, 2.2);
    path(ctx, jacketPanelRight, palette.coat, palette.ink, 2.2);
    drawCoatDetails(ctx);
    drawCoatSleeves(ctx, pose);
    wetFinish(ctx, state.wetness, jacketCloth, { x: 322, y: 192, width: 116, height: 186 });
  }
  if (state.garments.coat && state.garments.shirt) drawSleeveRolls(ctx, pose);
  drawScarf(ctx, state, pose);
  drawBoots(ctx, state, pose);
}
