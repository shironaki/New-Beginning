import { palette } from './palette.js';
import { ellipse, line, limb, path } from './primitives.js';

/* --------------------------------------------------------------- backpack */

export function drawBackpack(ctx, state, pose) {
  if (!state.garments.pack) return;
  if (pose.isSide) {
    // Compact pack hugging the back instead of the wide front silhouette.
    path(ctx, c => {
      c.moveTo(420, 216);
      c.quadraticCurveTo(414, 208, 428, 206);
      c.lineTo(458, 208);
      c.quadraticCurveTo(474, 212, 472, 228);
      c.quadraticCurveTo(478, 262, 470, 296);
      c.quadraticCurveTo(464, 310, 430, 310);
      c.quadraticCurveTo(416, 308, 418, 292);
      c.quadraticCurveTo(412, 254, 420, 216);
      c.closePath();
    }, palette.pack, palette.ink, 2.4);
    path(ctx, c => {
      c.moveTo(424, 202);
      c.quadraticCurveTo(426, 192, 440, 191);
      c.lineTo(462, 193);
      c.quadraticCurveTo(476, 196, 474, 206);
      c.quadraticCurveTo(452, 213, 428, 210);
      c.closePath();
    }, palette.blanket, palette.ink, 1.9);
    ellipse(ctx, 470, 200, 6.5, 8, palette.blanket, palette.ink, 1.4);
    path(ctx, c => {
      c.moveTo(470, 197); c.quadraticCurveTo(473.5, 198.5, 472, 202);
      c.quadraticCurveTo(470, 204, 468.5, 201.5);
    }, null, palette.blanketDark, 1.2);
    path(ctx, c => {
      c.moveTo(424, 238); c.lineTo(468, 240); c.lineTo(467, 250); c.lineTo(423, 248); c.closePath();
      c.moveTo(423, 272); c.lineTo(467, 274); c.lineTo(466, 284); c.lineTo(423, 282); c.closePath();
    }, palette.leather, palette.leatherDark, 1.3);
    path(ctx, c => {
      c.moveTo(442, 252); c.lineTo(458, 253); c.lineTo(457, 269); c.lineTo(441, 268); c.closePath();
    }, palette.packLight, palette.inkSoft, 1.2);
    line(ctx, [[449, 238], [449, 296]], palette.packDark, 1.4);
    return;
  }
  // Body of the pack: wider than the coat so its wings read from the front.
  path(ctx, c => {
    c.moveTo(322, 224);
    c.quadraticCurveTo(312, 210, 334, 204);
    c.lineTo(426, 204);
    c.quadraticCurveTo(448, 210, 438, 224);
    c.quadraticCurveTo(452, 260, 444, 300);
    c.quadraticCurveTo(436, 314, 380, 316);
    c.quadraticCurveTo(324, 314, 316, 300);
    c.quadraticCurveTo(308, 260, 322, 224);
    c.closePath();
  }, palette.pack, palette.ink, 2.6);
  path(ctx, c => {
    c.moveTo(324, 228); c.quadraticCurveTo(319, 264, 325, 298);
    c.lineTo(340, 300); c.lineTo(338, 232); c.closePath();
  }, palette.packDark, null);
  path(ctx, c => {
    c.moveTo(436, 228); c.quadraticCurveTo(441, 264, 435, 298);
    c.lineTo(420, 300); c.lineTo(422, 232); c.closePath();
  }, palette.packLight, null);
  // Rolled bedroll across the top, with its spiral end showing on one side.
  path(ctx, c => {
    c.moveTo(326, 208);
    c.quadraticCurveTo(330, 191, 354, 188);
    c.lineTo(392, 188);
    c.quadraticCurveTo(404, 189, 402, 205);
    c.quadraticCurveTo(370, 216, 326, 208);
    c.closePath();
  }, palette.blanket, palette.ink, 2.1);
  path(ctx, c => {
    c.moveTo(334, 202); c.quadraticCurveTo(368, 194, 400, 201);
  }, null, palette.blanketDark, 1.6);
  ellipse(ctx, 330, 199, 8.5, 10, palette.blanket, palette.ink, 1.7);
  path(ctx, c => {
    c.moveTo(330, 195);
    c.quadraticCurveTo(335, 197, 332, 201.5);
    c.quadraticCurveTo(329, 204, 327.5, 200.5);
  }, null, palette.blanketDark, 1.4);
  line(ctx, [[360, 190], [360, 208]], palette.leatherDark, 3);
  line(ctx, [[396, 189], [396, 207]], palette.leatherDark, 3);
  if (pose.isBack) {
    // Lid flap, buckened compression straps and side pockets on the back view.
    path(ctx, c => {
      c.moveTo(336, 214); c.quadraticCurveTo(380, 206, 424, 214);
      c.lineTo(421, 244); c.quadraticCurveTo(380, 252, 339, 244); c.closePath();
    }, palette.packDark, palette.ink, 1.5);
    path(ctx, c => {
      c.moveTo(320, 252); c.lineTo(338, 250); c.lineTo(340, 292); c.lineTo(323, 290); c.closePath();
      c.moveTo(440, 252); c.lineTo(422, 250); c.lineTo(420, 292); c.lineTo(437, 290); c.closePath();
    }, palette.packLight, palette.inkSoft, 1.2);
    line(ctx, [[352, 214], [350, 306]], palette.leather, 7);
    line(ctx, [[408, 214], [410, 306]], palette.leather, 7);
    line(ctx, [[352, 214], [350, 306]], palette.leatherDark, 1.4);
    line(ctx, [[408, 214], [410, 306]], palette.leatherDark, 1.4);
    for (const x of [350, 410]) {
      path(ctx, c => {
        c.moveTo(x - 6, 262); c.lineTo(x + 6, 262); c.lineTo(x + 6, 275); c.lineTo(x - 6, 275); c.closePath();
      }, palette.metal, palette.ink, 1.2);
    }
    line(ctx, [[362, 230], [358, 296]], palette.leatherLight, 3.5);
    line(ctx, [[398, 230], [402, 296]], palette.leatherLight, 3.5);
  } else {
    // Side pockets peeking past the coat, rope coil on one hip.
    path(ctx, c => {
      c.moveTo(310, 260); c.quadraticCurveTo(318, 253, 325, 258);
      c.lineTo(326, 290); c.quadraticCurveTo(318, 296, 309, 291); c.closePath();
      c.moveTo(450, 260); c.quadraticCurveTo(442, 253, 435, 258);
      c.lineTo(434, 290); c.quadraticCurveTo(442, 296, 451, 291); c.closePath();
    }, palette.packDark, palette.inkSoft, 1.1);
    path(ctx, c => {
      c.arc(312, 300, 9, 0, Math.PI * 2);
      c.moveTo(319, 300); c.arc(312, 300, 5.5, 0, Math.PI * 2);
    }, null, '#a99a74', 1.6);
    line(ctx, [[305, 262], [314, 290]], '#71613d', 1.1);
  }
}

export function drawPackStraps(ctx, state, pose) {
  if (!state.garments.pack || pose.isBack) return;
  const left = [[356, 204], [351, 230], [354, 268], [358, 316]];
  const right = [[404, 204], [409, 230], [406, 268], [402, 316]];
  for (const pts of [left, right]) {
    limb(ctx, pts, palette.leather, 9.5, palette.leatherDark);
    line(ctx, [[pts[0][0], pts[0][1] + 6], [pts[1][0] - 1, pts[1][1] + 4], [pts[2][0] - 1, pts[2][1] + 2], [pts[3][0] - 1, pts[3][1]]], palette.leatherLight, 3);
    line(ctx, [[pts[0][0] - 5, pts[0][1] + 4], [pts[1][0] - 5, pts[1][1] + 4], [pts[2][0] - 5, pts[2][1] + 2], [pts[3][0] - 5, pts[3][1]]], '#6a4322', 0.9);
    line(ctx, [[pts[0][0] + 5, pts[0][1] + 2], [pts[1][0] + 5, pts[1][1] + 3], [pts[2][0] + 5, pts[2][1]], [pts[3][0] + 5, pts[3][1] - 1]], '#6a4322', 0.9);
  }
  for (const x of [353, 407]) {
    path(ctx, c => {
      c.moveTo(x - 6, 246); c.lineTo(x + 6, 246); c.lineTo(x + 6, 259); c.lineTo(x - 6, 259); c.closePath();
    }, palette.metalShade, palette.ink, 1.4);
    path(ctx, c => {
      c.moveTo(x - 3.5, 248.5); c.lineTo(x + 3.5, 248.5); c.lineTo(x + 3.5, 256.5); c.lineTo(x - 3.5, 256.5); c.closePath();
    }, palette.leather, null);
    line(ctx, [[x - 5.5, 248], [x + 5.5, 248]], palette.metalLight, 1.2);
  }
}

export function drawShoulderElements(ctx, state, pose) {
  if (!state.garments.coat) return;
  for (const arm of pose.arms) {
    const x = arm.shoulder.x, y = arm.shoulder.y - 6, side = arm.side;
    path(ctx, c => {
      c.moveTo(x - 15, y + 1);
      c.quadraticCurveTo(x - 4, y - 7, x + 13, y - 3);
      c.lineTo(x + 14, y + 4);
      c.quadraticCurveTo(x, y + 1, x - 14, y + 7);
      c.closePath();
    }, palette.shoulder, palette.ink, 1.7);
    path(ctx, c => {
      c.moveTo(x - 11, y - 1);
      c.quadraticCurveTo(x - 2, y - 6, x + 9, y - 3);
      c.lineTo(x + 9, y - 1);
      c.quadraticCurveTo(x - 2, y - 3, x - 11, y + 1);
      c.closePath();
    }, palette.shoulderLight, null);
    ellipse(ctx, x - side * 9, y + 1, 2.2, 2.2, palette.brass, palette.inkSoft, 0.8);
  }
}

/* ------------------------------------------------------------ held items */

function drawAxe(ctx, outward) {
  const o = outward >= 0 ? 1 : -1;
  // Wooden haft with a worn leather wrap; the head sits at the lower end.
  limb(ctx, [[-2, -12], [0, 18], [2, 62], [1, 98]], '#7c5230', 9, palette.ink);
  line(ctx, [[-3.4, -8], [-1.4, 18], [0.6, 62], [-0.4, 94]], '#a26a3e', 2);
  line(ctx, [[-1, -8], [1, 18], [3, 62], [2, 94]], '#57351c', 1.1);
  for (let y = -6; y <= 8; y += 5) line(ctx, [[-5, y], [4, y + 2.5]], palette.leatherDark, 1.6);
  ellipse(ctx, 1, 100, 4.8, 3.8, palette.leatherDark, palette.ink, 1.1);
  // Poll block opposite the blade.
  path(ctx, c => {
    c.moveTo(-2, 58);
    c.lineTo(-10 * o, 60);
    c.lineTo(-11 * o, 88);
    c.lineTo(-2, 90);
    c.closePath();
  }, palette.metalShade, palette.ink, 1.6);
  // Angular crescent blade: top and bottom flares, straight bevel to a wide edge.
  path(ctx, c => {
    c.moveTo(3, 56);
    c.lineTo(16 * o, 52);
    c.lineTo(29 * o, 61);
    c.quadraticCurveTo(34 * o, 74, 28 * o, 87);
    c.lineTo(15 * o, 93);
    c.lineTo(3, 88);
    c.closePath();
  }, '#5f6a66', palette.ink, 2);
  path(ctx, c => {
    c.moveTo(4, 57); c.lineTo(15.5 * o, 53.5); c.lineTo(24 * o, 60);
    c.lineTo(21.5 * o, 63.5); c.lineTo(14 * o, 57.5); c.lineTo(4, 60.5); c.closePath();
  }, '#77827e', null);
  // Bright ground bevel hugging the cutting edge.
  path(ctx, c => {
    c.moveTo(27.5 * o, 62.5);
    c.quadraticCurveTo(31.5 * o, 74, 26 * o, 85);
    c.lineTo(23 * o, 82.5);
    c.quadraticCurveTo(27.5 * o, 73.5, 24 * o, 65);
    c.closePath();
  }, '#d8e0da', null);
  line(ctx, [[18 * o, 55], [16 * o, 91]], '#58625e', 1);
  path(ctx, c => {
    c.moveTo(-1, 53); c.lineTo(7 * o, 51); c.lineTo(7.5 * o, 60); c.lineTo(-1, 61); c.closePath();
  }, palette.brass, palette.inkSoft, 1);
}

function drawTorch(ctx, time) {
  const flicker = Math.sin(time * 11.3) * 1.8 + Math.sin(time * 23.1) * 0.9;
  // Handle.
  limb(ctx, [[0, 36], [1, 10], [0, -14], [0, -38]], '#4f3521', 9, palette.ink);
  line(ctx, [[-2, 32], [-1, -34]], '#6e4a2c', 2.4);
  path(ctx, c => {
    c.moveTo(-5, 32); c.quadraticCurveTo(0, 28, 5, 32);
    c.lineTo(4.5, 40); c.quadraticCurveTo(0, 43, -4.5, 40); c.closePath();
  }, palette.leatherDark, palette.ink, 1.2);
  for (let y = 6; y >= -26; y -= 9) line(ctx, [[-4.5, y], [4.5, y - 2.5]], '#2e1e12', 1.5);
  // Wrapped rag around the crown.
  path(ctx, c => {
    c.moveTo(-6, -36);
    c.quadraticCurveTo(0, -40, 6, -36);
    c.lineTo(7.5, -50);
    c.quadraticCurveTo(0, -55, -7.5, -50);
    c.closePath();
  }, '#cbbd9a', palette.ink, 1.4);
  line(ctx, [[-6, -42], [6, -45]], '#a99a74', 1.3);
  line(ctx, [[-7, -47], [5, -50]], '#a99a74', 1.3);
  // Flame with glow and embers.
  ctx.save();
  const glow = ctx.createRadialGradient(0, -70, 4, 0, -70, 34);
  glow.addColorStop(0, '#ffd98c40');
  glow.addColorStop(0.6, '#ffb05a1f');
  glow.addColorStop(1, '#ff9a3c00');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, -70, 34, 0, Math.PI * 2);
  ctx.fill();
  path(ctx, c => {
    c.moveTo(-9.5, -48);
    c.quadraticCurveTo(-18, -64, -8, -84 - flicker);
    c.quadraticCurveTo(-4, -74, 0, -100 - flicker * 1.4);
    c.quadraticCurveTo(7, -76, 11, -64);
    c.quadraticCurveTo(13, -52, 8, -47);
    c.quadraticCurveTo(0, -43, -9.5, -48);
    c.closePath();
  }, palette.flame, '#a85e1f', 1.4);
  path(ctx, c => {
    c.moveTo(-4.5, -50);
    c.quadraticCurveTo(-9, -60, -1, -71 - flicker);
    c.quadraticCurveTo(6, -62, 4.5, -50);
    c.quadraticCurveTo(0, -46, -4.5, -50);
    c.closePath();
  }, palette.flameMid, null);
  path(ctx, c => {
    c.moveTo(-2, -50);
    c.quadraticCurveTo(-4, -58, 0, -64 - flicker * 0.6);
    c.quadraticCurveTo(3.5, -57, 2, -50);
    c.closePath();
  }, palette.flameCore, null);
  ctx.globalAlpha = 0.8;
  ellipse(ctx, -6 + flicker * 0.5, -96, 1.5, 1.5, palette.ember);
  ellipse(ctx, 5, -104 - flicker, 1.1, 1.1, palette.ember);
  ctx.globalAlpha = 0.5;
  ellipse(ctx, -1, -112, 0.9, 0.9, palette.ember);
  ctx.restore();
}

export function drawHeldItems(ctx, state, pose, time) {
  for (const role of ['right', 'left']) {
    const item = state.items[role];
    if (!item || item === 'none') continue;
    const hand = pose.hands[role];
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(hand.angle + hand.side * 0.07);
    if (item === 'axe') drawAxe(ctx, hand.side);
    if (item === 'torch') drawTorch(ctx, time);
    ctx.restore();
  }
}

export function drawHands(ctx, state, pose) {
  for (const role of ['right', 'left']) {
    const hand = pose.hands[role];
    const item = state.items[role];
    const held = item && item !== 'none';
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(hand.angle);
    path(ctx, c => {
      c.moveTo(-7.5, -2);
      c.quadraticCurveTo(-8, -9, -1, -9.5);
      c.quadraticCurveTo(7, -9, 8, -2);
      c.quadraticCurveTo(8.5, 5, 3, 8.5);
      c.quadraticCurveTo(-4, 10, -7.5, 5);
      c.closePath();
    }, palette.skinLight, palette.ink, 1.5);
    if (held) {
      path(ctx, c => {
        c.moveTo(-8, -3.5); c.quadraticCurveTo(-11, -1, -9.5, 3); c.quadraticCurveTo(-8, 5, -6.5, 3.5);
      }, palette.skinLight, palette.ink, 1.2);
      for (const dx of [-4.5, -1, 2.5, 5.5]) line(ctx, [[dx, -6.5], [dx - 0.8, -1]], palette.skinShadow, 1.3);
      path(ctx, c => {
        c.moveTo(-6, 2); c.quadraticCurveTo(0, 5, 6.5, 1.5);
      }, null, palette.skinShadow, 1.1);
      line(ctx, [[-3.5, -8.5], [4.5, -8.5]], palette.skinHighlight, 1.2);
    } else {
      path(ctx, c => {
        c.moveTo(-8, -3); c.quadraticCurveTo(-11.5, 0, -9.5, 4); c.quadraticCurveTo(-7.5, 5.5, -6, 3.5);
      }, palette.skinLight, palette.ink, 1.2);
      for (const dx of [-3, 0.5, 4]) line(ctx, [[dx, 1], [dx - 0.5, 7.5]], palette.skinShadow, 1.2);
      path(ctx, c => {
        c.moveTo(-5, -4); c.quadraticCurveTo(0, -2.5, 5.5, -4.5);
      }, null, palette.skinShadow, 1);
    }
    ctx.restore();
  }
}
