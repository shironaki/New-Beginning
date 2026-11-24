import { palette } from './palette.js';
import { ellipse, limb, path, line } from './primitives.js';

// Head proportions: top of hair y=104, chin y=184, face x 352..408.
// Shoulders are deliberately wide (x 336..424) so the adult silhouette reads heroic.

function drawEar(ctx, x, y) {
  const dir = x < 380 ? -1 : 1;
  path(ctx, c => {
    c.moveTo(x, y - 6);
    c.quadraticCurveTo(x + dir * 3.6, y - 7, x + dir * 3.8, y - 1);
    c.quadraticCurveTo(x + dir * 3.2, y + 5, x, y + 5);
    c.closePath();
  }, palette.skinShadow, palette.inkSoft, 1);
  path(ctx, c => {
    c.moveTo(x + dir * 1, y - 3);
    c.quadraticCurveTo(x + dir * 2.4, y - 0.5, x + dir * 1.4, y + 1.8);
  }, null, palette.skinDeep, 0.9);
}

function drawFaceFront(ctx) {
  path(ctx, c => {
    c.moveTo(353, 136);
    c.quadraticCurveTo(351, 158, 358, 168);
    c.quadraticCurveTo(363, 179, 372, 183);
    c.quadraticCurveTo(380, 186, 388, 183);
    c.quadraticCurveTo(397, 179, 402, 168);
    c.quadraticCurveTo(409, 158, 407, 136);
    c.quadraticCurveTo(401, 118, 380, 115);
    c.quadraticCurveTo(359, 118, 353, 136);
    c.closePath();
  }, palette.skin, palette.ink, 1.8);

  // Stubble across the jaw, then planes: shaded left, lit right (torch side).
  path(ctx, c => {
    c.moveTo(356, 156);
    c.quadraticCurveTo(362, 174, 372, 182);
    c.quadraticCurveTo(380, 185.5, 388, 182);
    c.quadraticCurveTo(398, 174, 404, 156);
    c.quadraticCurveTo(396, 166, 380, 168);
    c.quadraticCurveTo(364, 166, 356, 156);
    c.closePath();
  }, palette.stubble, null);
  path(ctx, c => {
    c.moveTo(354, 140);
    c.quadraticCurveTo(352, 158, 358, 170);
    c.quadraticCurveTo(356, 154, 359, 142);
    c.closePath();
  }, palette.skinShadow, null);
  path(ctx, c => {
    c.moveTo(396, 130);
    c.quadraticCurveTo(405, 135, 405, 148);
    c.quadraticCurveTo(401, 140, 394, 136);
    c.closePath();
  }, palette.skinHighlight, null);

  // Brows: thick, drawn low and angled inward for the focused look.
  path(ctx, c => { c.moveTo(359, 143); c.quadraticCurveTo(366, 141, 372, 145); c.lineTo(371, 147.5); c.quadraticCurveTo(365, 144.5, 360, 146); c.closePath(); }, palette.hair, null);
  path(ctx, c => { c.moveTo(401, 143); c.quadraticCurveTo(394, 141, 388, 145); c.lineTo(389, 147.5); c.quadraticCurveTo(395, 144.5, 400, 146); c.closePath(); }, palette.hair, null);

  for (const x of [365.5, 394.5]) {
    path(ctx, c => {
      c.moveTo(x - 4.6, 151.5);
      c.quadraticCurveTo(x, 148.6, x + 4.6, 151.5);
      c.quadraticCurveTo(x, 154.4, x - 4.6, 151.5);
      c.closePath();
    }, '#f2e8d2', '#7c5540', 0.8);
    ellipse(ctx, x + (x < 380 ? 0.6 : -0.6), 151.5, 1.8, 2.1, '#33291f');
    ellipse(ctx, x + (x < 380 ? 1.1 : -1.1), 150.9, 0.55, 0.6, '#fff2d5');
    path(ctx, c => { c.moveTo(x - 4.4, 150.2); c.quadraticCurveTo(x, 147.8, x + 4.4, 150.2); }, null, palette.skinDeep, 1.3);
  }

  // Angular nose with side shadow.
  path(ctx, c => {
    c.moveTo(381, 149);
    c.lineTo(385, 161);
    c.lineTo(378, 163.5);
    c.quadraticCurveTo(377, 156, 381, 149);
    c.closePath();
  }, palette.skinShadow, null);
  path(ctx, c => { c.moveTo(385, 161); c.quadraticCurveTo(388.5, 161.5, 388, 164); }, null, palette.skinDeep, 1.2);
  path(ctx, c => { c.moveTo(374, 162.5); c.quadraticCurveTo(377, 164, 378.5, 163); }, null, palette.skinDeep, 1);

  // Mouth: level and reserved, slight downturn at the corners.
  path(ctx, c => { c.moveTo(372.5, 172); c.quadraticCurveTo(380, 173.5, 387.5, 171.8); }, null, '#6e4028', 2);
  path(ctx, c => { c.moveTo(372.5, 172); c.lineTo(370.5, 173.2); c.moveTo(387.5, 171.8); c.lineTo(389.5, 173); }, null, '#8a4f35', 1.1);
  path(ctx, c => { c.moveTo(375, 176); c.quadraticCurveTo(380, 177.5, 385, 175.5); }, null, '#d89166', 1.2);
  path(ctx, c => {
    c.moveTo(372, 167); c.quadraticCurveTo(380, 170, 388, 167);
    c.quadraticCurveTo(380, 171.5, 372, 167); c.closePath();
  }, '#a06846', null);
}

function drawHairFront(ctx) {
  path(ctx, c => {
    c.moveTo(350, 150);
    c.quadraticCurveTo(344, 125, 354, 112);
    c.quadraticCurveTo(364, 101, 380, 102);
    c.quadraticCurveTo(396, 102, 406, 111);
    c.quadraticCurveTo(413, 120, 412, 133);
    c.quadraticCurveTo(411, 143, 410, 150);
    c.lineTo(405, 145);
    c.lineTo(406, 132);
    c.quadraticCurveTo(402, 124, 395, 127);
    c.lineTo(389, 122);
    c.quadraticCurveTo(381, 129, 374, 126);
    c.lineTo(368, 132);
    c.quadraticCurveTo(361, 128, 357, 136);
    c.lineTo(354, 147);
    c.closePath();
  }, palette.hair, palette.ink, 1.8);
  path(ctx, c => {
    c.moveTo(358, 116);
    c.quadraticCurveTo(372, 104, 390, 108);
    c.quadraticCurveTo(402, 111, 408, 121);
    c.quadraticCurveTo(396, 116, 384, 119);
    c.quadraticCurveTo(370, 122, 358, 116);
    c.closePath();
  }, palette.hairMid, null);
  path(ctx, c => {
    c.moveTo(392, 109);
    c.quadraticCurveTo(404, 113, 409, 128);
    c.quadraticCurveTo(401, 120, 390, 116);
    c.closePath();
  }, palette.hairLight, null);
  line(ctx, [[361, 128], [371, 123], [380, 127], [389, 122]], palette.hairMid, 1.4);
  path(ctx, c => { c.moveTo(350, 141); c.quadraticCurveTo(352, 153, 356, 158); c.lineTo(358, 151); c.lineTo(356, 140); c.closePath(); }, palette.hair, palette.ink, 0.9);
  path(ctx, c => { c.moveTo(411, 141); c.quadraticCurveTo(409, 153, 405, 158); c.lineTo(403, 151); c.lineTo(405, 140); c.closePath(); }, palette.hair, palette.ink, 0.9);
}

function drawHeadSide(ctx) {
  path(ctx, c => {
    c.moveTo(360, 118);
    c.quadraticCurveTo(356, 130, 357, 141);
    c.lineTo(354, 151);
    c.quadraticCurveTo(350, 156, 356, 158.5);
    c.lineTo(359, 158);
    c.quadraticCurveTo(357, 164, 360, 166);
    c.quadraticCurveTo(363, 174, 369, 179);
    c.quadraticCurveTo(380, 187, 392, 179);
    c.quadraticCurveTo(403, 171, 404, 149);
    c.quadraticCurveTo(405, 127, 396, 118);
    c.quadraticCurveTo(378, 110, 360, 118);
    c.closePath();
  }, palette.skin, palette.ink, 1.8);
  path(ctx, c => {
    c.moveTo(359, 158);
    c.quadraticCurveTo(365, 174, 375, 181);
    c.quadraticCurveTo(366, 179, 361, 170);
    c.closePath();
  }, palette.stubble, null);
  path(ctx, c => {
    c.moveTo(362, 116);
    c.quadraticCurveTo(357, 127, 358, 141);
    c.quadraticCurveTo(368, 133, 382, 132);
    c.quadraticCurveTo(397, 131, 404, 141);
    c.quadraticCurveTo(407, 124, 397, 116);
    c.quadraticCurveTo(380, 108, 362, 116);
    c.closePath();
  }, palette.hair, palette.ink, 1.6);
  path(ctx, c => {
    c.moveTo(398, 116);
    c.quadraticCurveTo(407, 128, 405, 150);
    c.quadraticCurveTo(400, 165, 392, 174);
    c.lineTo(400, 156);
    c.quadraticCurveTo(403, 136, 398, 116);
    c.closePath();
  }, palette.hairMid, null);
  line(ctx, [[364, 124], [376, 119], [390, 121]], palette.hairLight, 1.5);
  path(ctx, c => { c.moveTo(360, 143); c.lineTo(371, 145); }, null, palette.hair, 2.4);
  path(ctx, c => {
    c.moveTo(361, 148.5); c.quadraticCurveTo(365, 146.8, 369, 148.5);
    c.quadraticCurveTo(365, 151, 361, 148.5); c.closePath();
  }, '#f2e8d2', '#7c5540', 0.8);
  ellipse(ctx, 365.5, 148.8, 1.5, 1.9, '#33291f');
  path(ctx, c => { c.moveTo(352, 154); c.quadraticCurveTo(349, 157.5, 353, 158.5); }, null, palette.skinDeep, 1.2);
  line(ctx, [[356, 168], [362, 168.5]], '#6e4028', 1.7);
  drawEar(ctx, 388, 152);
}

function drawHeadBack(ctx) {
  path(ctx, c => {
    c.moveTo(352, 150);
    c.quadraticCurveTo(344, 122, 357, 108);
    c.quadraticCurveTo(369, 100, 382, 101);
    c.quadraticCurveTo(399, 100, 408, 114);
    c.quadraticCurveTo(415, 128, 408, 150);
    c.quadraticCurveTo(405, 170, 393, 179);
    c.quadraticCurveTo(380, 185, 367, 179);
    c.quadraticCurveTo(355, 170, 352, 150);
    c.closePath();
  }, palette.hair, palette.ink, 1.9);
  path(ctx, c => {
    c.moveTo(357, 118);
    c.quadraticCurveTo(374, 105, 398, 114);
    c.quadraticCurveTo(410, 121, 408, 138);
    c.quadraticCurveTo(397, 128, 380, 130);
    c.quadraticCurveTo(366, 131, 357, 140);
    c.closePath();
  }, palette.hairMid, null);
  path(ctx, c => {
    c.moveTo(361, 158);
    c.quadraticCurveTo(380, 168, 399, 158);
    c.lineTo(395, 176);
    c.quadraticCurveTo(380, 183, 365, 176);
    c.closePath();
  }, palette.hairMid, null);
  line(ctx, [[368, 162], [370, 174]], palette.hair, 1.4);
  line(ctx, [[380, 165], [380, 177]], palette.hair, 1.4);
  line(ctx, [[392, 162], [390, 174]], palette.hair, 1.4);
  line(ctx, [[368, 112], [382, 107], [394, 111]], palette.hairHighlight, 1.5);
  drawEar(ctx, 349, 146);
  drawEar(ctx, 411, 146);
}

function drawHead(ctx, pose) {
  if (pose.isBack) { drawHeadBack(ctx); return; }
  if (pose.isSide) { drawHeadSide(ctx); return; }
  drawEar(ctx, 349, 149);
  drawEar(ctx, 411, 149);
  drawFaceFront(ctx);
  drawHairFront(ctx);
}

function drawNeck(ctx, pose) {
  path(ctx, c => {
    c.moveTo(366, 172);
    c.quadraticCurveTo(364, 188, 360, 200);
    c.lineTo(400, 200);
    c.quadraticCurveTo(396, 188, 394, 172);
    c.quadraticCurveTo(380, 181, 366, 172);
    c.closePath();
  }, palette.skinShadow, palette.ink, 1.6);
  if (!pose.isBack) {
    path(ctx, c => {
      c.moveTo(368, 182);
      c.quadraticCurveTo(380, 190, 392, 182);
      c.quadraticCurveTo(389, 192, 380, 193);
      c.quadraticCurveTo(371, 192, 368, 182);
      c.closePath();
    }, palette.jawShade, null);
  }
}

function drawTorso(ctx) {
  path(ctx, c => {
    c.moveTo(348, 206);
    c.quadraticCurveTo(362, 196, 380, 200);
    c.quadraticCurveTo(398, 196, 412, 206);
    c.lineTo(424, 220);
    c.quadraticCurveTo(414, 262, 410, 306);
    c.quadraticCurveTo(404, 332, 414, 346);
    c.quadraticCurveTo(380, 362, 346, 346);
    c.quadraticCurveTo(356, 332, 350, 306);
    c.quadraticCurveTo(346, 262, 336, 220);
    c.closePath();
  }, palette.skin, palette.ink, 2.2);
  path(ctx, c => {
    c.moveTo(352, 232);
    c.quadraticCurveTo(368, 244, 378, 240);
    c.quadraticCurveTo(370, 254, 356, 250);
    c.closePath();
  }, palette.skinLight, null);
  path(ctx, c => {
    c.moveTo(408, 232);
    c.quadraticCurveTo(392, 244, 382, 240);
    c.quadraticCurveTo(390, 254, 404, 250);
    c.closePath();
  }, palette.skinLight, null);
  path(ctx, c => {
    c.moveTo(380, 242); c.lineTo(380, 318);
    c.moveTo(362, 272); c.quadraticCurveTo(368, 278, 374, 274);
    c.moveTo(386, 274); c.quadraticCurveTo(392, 278, 398, 272);
    c.moveTo(364, 296); c.quadraticCurveTo(380, 304, 396, 296);
  }, null, palette.skinShadow, 1.6);
  path(ctx, c => {
    c.moveTo(350, 326);
    c.quadraticCurveTo(380, 340, 410, 326);
    c.quadraticCurveTo(414, 341, 405, 350);
    c.quadraticCurveTo(380, 360, 355, 350);
    c.quadraticCurveTo(346, 341, 350, 326);
    c.closePath();
  }, palette.skin, palette.inkSoft, 1.4);
}

export function drawBaseBody(ctx, pose) {
  const { arms, legs } = pose;
  for (const part of legs) {
    limb(ctx, [[part.hip.x, part.hip.y - 4], [part.knee.x, part.knee.y], [part.ankle.x, part.ankle.y + 4]], palette.skin, 33);
    path(ctx, c => {
      c.moveTo(part.hip.x - 8, part.hip.y + 12);
      c.quadraticCurveTo(part.knee.x - 10, part.knee.y - 12, part.knee.x - 3, part.knee.y + 16);
      c.quadraticCurveTo(part.ankle.x - 7, part.ankle.y + 2, part.ankle.x - 3, part.ankle.y + 10);
    }, null, palette.skinLight, 2.6);
    path(ctx, c => {
      c.moveTo(part.hip.x + 8, part.hip.y + 14);
      c.quadraticCurveTo(part.knee.x + 11, part.knee.y - 8, part.knee.x + 4, part.knee.y + 14);
    }, null, palette.skinShadow, 2.6);
    ellipse(ctx, part.knee.x, part.knee.y, 7.5, 6.5, palette.skin, palette.skinShadow, 1.1);
    path(ctx, c => {
      c.moveTo(part.ankle.x - 13, 489);
      c.quadraticCurveTo(part.ankle.x, 484, part.ankle.x + 12, 490);
      c.quadraticCurveTo(part.ankle.x + 23, 497, part.ankle.x + 21, 507);
      c.quadraticCurveTo(part.ankle.x + 6, 513, part.ankle.x - 17, 509);
      c.quadraticCurveTo(part.ankle.x - 23, 503, part.ankle.x - 13, 489);
      c.closePath();
    }, palette.skin, palette.ink, 1.6);
  }

  drawTorso(ctx);

  for (const part of arms) {
    limb(ctx, [[part.shoulder.x, part.shoulder.y], [part.elbow.x, part.elbow.y], [part.wrist.x, part.wrist.y]], palette.skin, 22);
    ellipse(ctx, part.shoulder.x, part.shoulder.y + 2, 11.5, 10, palette.skin, palette.skinShadow, 1.1);
    ellipse(ctx, part.elbow.x, part.elbow.y, 6.6, 6, palette.skin, palette.skinShadow, 1);
    path(ctx, c => {
      c.moveTo(part.shoulder.x - part.side * 4, part.shoulder.y + 10);
      c.quadraticCurveTo(part.elbow.x - part.side * 6, part.elbow.y - 8, part.wrist.x - part.side * 3, part.wrist.y - 10);
    }, null, palette.skinLight, 2);
    path(ctx, c => {
      c.moveTo(part.shoulder.x + part.side * 6, part.shoulder.y + 12);
      c.quadraticCurveTo(part.elbow.x + part.side * 7, part.elbow.y, part.wrist.x + part.side * 3, part.wrist.y - 4);
    }, null, palette.skinShadow, 2);
  }

  drawNeck(ctx, pose);
  drawHead(ctx, pose);
}
