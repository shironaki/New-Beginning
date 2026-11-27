import { drawLayeredCharacter } from '../layers/render.js';
import { createPixelRenderer } from '../layers/pixelpass.js';

const LAYER_SURFACE = { width: 760, height: 620 };
// Frame the actual figure and its tools instead of the original editor margins.
const LAYER_VIEW = { x: 240, y: 72, width: 280, height: 470 };
const BODY_WIDTH_SCALE = 1.32;
const layerCanvas = document.createElement('canvas');
layerCanvas.width = LAYER_SURFACE.width;
layerCanvas.height = LAYER_SURFACE.height;
const layerContext = layerCanvas.getContext('2d', { alpha: true });

const renderPixel = createPixelRenderer((w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
});

export function drawLayeredPortrait(ctx, width, height, state, time) {
  if (state && state.style === 'pixel') {
    ctx.clearRect(0, 0, width, height);
    renderPixel(ctx, width, height, state, time);
    return;
  }
  ctx.clearRect(0, 0, width, height);
  drawLayeredCharacter(layerContext, LAYER_SURFACE.width, LAYER_SURFACE.height, state, time);

  const scale = Math.min(width / (LAYER_VIEW.width * BODY_WIDTH_SCALE), (height - 14) / LAYER_VIEW.height);
  const drawWidth = LAYER_VIEW.width * BODY_WIDTH_SCALE * scale;
  const drawHeight = LAYER_VIEW.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2 - 3;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.beginPath();
  ctx.rect(x, y, drawWidth, drawHeight);
  ctx.clip();
  ctx.translate(x - LAYER_VIEW.x * scale * BODY_WIDTH_SCALE, y - LAYER_VIEW.y * scale);
  ctx.scale(scale * BODY_WIDTH_SCALE, scale);
  ctx.drawImage(layerCanvas, 0, 0);
  ctx.restore();
}
