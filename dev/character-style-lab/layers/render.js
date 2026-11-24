import { drawBaseBody } from './body.js';
import { drawCloakLayer, drawClothingFrontLayers } from './garments.js';
import { drawBackpack, drawHeldItems, drawHands, drawPackStraps, drawShoulderElements } from './gear.js';
import { buildPose } from './rig.js';
import { garmentWarmth } from './palette.js';

export function calculateWarmth(garments) {
  return Object.entries(garmentWarmth).reduce((total, [name, value]) => total + (garments[name] ? value : 0), 0);
}

export function countVisibleLayers(state) {
  const clothes = ['shirt', 'trousers', 'coat', 'scarf', 'boots', 'cloak'].filter(name => state.garments[name]).length;
  const gear = (state.garments.pack ? 1 : 0) + ['right', 'left'].filter(hand => state.items[hand] && state.items[hand] !== 'none').length;
  return 1 + clothes + gear;
}

export function drawLayeredCharacter(ctx, width, height, state, time = 0) {
  ctx.clearRect(0, 0, width, height);
  const scale = Math.min(width / 760, height / 620);
  ctx.save();
  ctx.translate((width - 760 * scale) / 2, (height - 620 * scale) / 2);
  ctx.scale(scale, scale);
  ctx.save();
  ctx.fillStyle = '#111b15';
  ctx.globalAlpha = 0.28;
  ctx.beginPath(); ctx.ellipse(380, 519, 86, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.12;
  ctx.beginPath(); ctx.ellipse(380, 518, 130, 22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const pose = buildPose({ ...state, time });
  ctx.translate(0, pose.bob);
  if (pose.isSide) { ctx.translate(380, 0); ctx.scale(0.87, 1); ctx.translate(-380, 0); }
  if (pose.mirror) { ctx.translate(760, 0); ctx.scale(-1, 1); }
  if (!pose.isBack) {
    drawCloakLayer(ctx, state, pose);
    drawBackpack(ctx, state, pose);
  }
  drawBaseBody(ctx, pose);
  drawClothingFrontLayers(ctx, state, pose);
  if (pose.isBack) {
    drawCloakLayer(ctx, state, pose);
    drawBackpack(ctx, state, pose);
  }
  drawPackStraps(ctx, state, pose);
  drawShoulderElements(ctx, state, pose);
  drawHeldItems(ctx, state, pose, time);
  drawHands(ctx, state, pose);
  ctx.restore();
}
