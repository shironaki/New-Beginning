// Смоук конвейера «кадр → спрайт»: гоняет слои/photopix.js без браузера и без WebGL.
// Источник — тот же пиксель-риг лаборатории, потому что WebGL в песочнице недоступен:
// проверяем не сам рендер, а раскрой по сетке, квантизацию палитрой и обводку.
// Запуск: node dev/character-style-lab/tools/smoke-photopix.mjs [имя-файла-png]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShimCanvas, encodePNG } from '../../../tools/canvas-shim.js';
import { createPixelRenderer } from '../layers/pixelpass.js';
import { palette } from '../layers/palette.js';
import { spriteFromPixels, buildPalette } from '../layers/photopix.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] ? path.dirname(process.argv[2]) : path.join(root, '.smoke');
fs.mkdirSync(outDir, { recursive: true });

const PAL = buildPalette(palette);
const renderPixel = createPixelRenderer((w, h) => new ShimCanvas(w, h));
const state = {
  style: 'pixel', direction: 'down', motion: 'idle', leadHand: 'right', wetness: 0,
  garments: { shirt: true, trousers: true, coat: true, scarf: true, boots: true, cloak: false, pack: true },
  items: { right: 'axe', left: 'torch' }
};

function sourceFrame(motion, direction) {
  const canvas = new ShimCanvas(340, 560);
  const ctx = canvas.getContext('2d', { alpha: true });
  state.motion = motion;
  state.direction = direction;
  renderPixel(ctx, canvas.width, canvas.height, state, 0.25);
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, w: canvas.width, h: canvas.height, canvas };
}

function upscale(sprite, zoom) {
  const canvas = new ShimCanvas(sprite.w * zoom, sprite.h * zoom);
  const d = canvas.data;
  for (let y = 0; y < sprite.h; y += 1) {
    for (let x = 0; x < sprite.w; x += 1) {
      const i = (y * sprite.w + x) * 4;
      for (let oy = 0; oy < zoom; oy += 1) {
        for (let ox = 0; ox < zoom; ox += 1) {
          const t = (((y * zoom + oy) * sprite.w * zoom) + (x * zoom + ox)) * 4;
          d[t] = sprite.data[i]; d[t + 1] = sprite.data[i + 1];
          d[t + 2] = sprite.data[i + 2]; d[t + 3] = sprite.data[i + 3];
        }
      }
    }
  }
  return canvas;
}

const GRIDS = [{ w: 96, h: 128 }, { w: 64, h: 80 }, { w: 48, h: 64 }];
const cases = [
  ['idle', 'down'], ['walk', 'down'], ['run', 'side'], ['idle', 'up'], ['idle', 'left']
];
let checked = 0;
const montage = [];

for (const [motion, direction] of cases) {
  const src = sourceFrame(motion, direction);
  for (const grid of GRIDS) {
    const sprite = spriteFromPixels(src, {
      grid, mode: 'palette', palette: PAL, ink: [28, 22, 16], dither: 2, outline: true
    });
    if (!sprite) throw new Error(`пустой спрайт: ${motion}/${direction} @ ${grid.w}x${grid.h}`);
    let filled = 0;
    let offPalette = 0;
    let inky = 0;
    for (let i = 0; i < sprite.data.length; i += 4) {
      if (sprite.data[i + 3] === 0) continue;
      filled += 1;
      const rgb = [sprite.data[i], sprite.data[i + 1], sprite.data[i + 2]];
      if (rgb.join() === '28,22,16') { inky += 1; continue; }
      if (!PAL.some(c => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2])) offPalette += 1;
    }
    const ratio = filled / (grid.w * grid.h);
    if (ratio < 0.12 || ratio > 0.92) throw new Error(`заполнение ${ratio.toFixed(2)} вне разумных границ (${motion}/${direction} @ ${grid.w}x${grid.h})`);
    if (offPalette) throw new Error(`${offPalette} пикселей мимо палитры (${motion}/${direction})`);
    if (!inky) throw new Error(`обводка не появилась (${motion}/${direction} @ ${grid.w}x${grid.h})`);
    if (sprite.sourceBox.x0 > sprite.sourceBox.x1) throw new Error('bad source box');
    checked += 1;
    if (motion === 'idle' && direction === 'down' && grid.w === 96) montage.push(upscale(sprite, 2));
    if (motion === 'run' && direction === 'side' && grid.w === 64) montage.push(upscale(sprite, 3));
  }
}

const poster = spriteFromPixels(sourceFrame('idle', 'down'), {
  grid: { w: 96, h: 128 }, mode: 'poster', levels: 4, dither: 0, outline: true, palette: []
});
if (!poster) throw new Error('постеризация вернула пустой кадр');
montage.push(upscale(poster, 2));

const width = montage.reduce((sum, c) => sum + c.width, 0);
const height = Math.max(...montage.map(c => c.height));
const strip = new ShimCanvas(width, height);
let cursor = 0;
for (const part of montage) {
  for (let y = 0; y < part.height; y += 1) {
    for (let x = 0; x < part.width; x += 1) {
      const s = (y * part.width + x) * 4;
      const t = ((y + (height - part.height)) * width + cursor + x) * 4;
      strip.data[t] = part.data[s]; strip.data[t + 1] = part.data[s + 1];
      strip.data[t + 2] = part.data[s + 2]; strip.data[t + 3] = part.data[s + 3] ? part.data[s + 3] : 0;
    }
  }
  cursor += part.width;
}
const outPath = process.argv[2] || path.join(outDir, 'photopix-smoke.png');
fs.writeFileSync(outPath, encodePNG(strip, [22, 36, 28]));
console.log(`PHOTOPIX SMOKE OK: ${checked} сеток, палитра ${PAL.length} цветов, montage ${width}x${height} → ${outPath}`);
