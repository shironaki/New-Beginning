// Пиксельный конвейер стенда: кадр любого рендера (3D или 2D) → спрайт фиксированной сетки.
// Только массивы пикселей на входе и на выходе — без обращений к DOM, поэтому тот же код
// работает и в браузере (hero3d.js), и в node-смоуке через tools/canvas-shim.js.

const BAYER = [[0, 2], [3, 1]];
// Размер блока дизеринга в пикселях сетки. 1 даёт шахматное чередование
// пиксель-в-пиксель: на спрайте героя в 100 px это выглядит как «ткань
// просвечивает» (именно так это и описал владелец). 2 — классический блок
// 2×2: узор остаётся, но читается как texture, а не как дырка.
const DITHER_BLOCK = 2;

export function parseHex(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function buildPalette(source) {
  const list = Array.isArray(source) ? source : Object.values(source);
  const out = [];
  for (const value of list) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) out.push(parseHex(value));
  }
  return out;
}

function boxAverage(data, w, h, ax, ay, bx, by, alphaCutoff) {
  const x0 = Math.max(0, Math.floor(ax));
  const y0 = Math.max(0, Math.floor(ay));
  const x1 = Math.min(w, Math.ceil(bx));
  const y1 = Math.min(h, Math.ceil(by));
  let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * w + x) * 4;
      const alpha = data[i + 3];
      if (alpha < alphaCutoff) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; a += alpha; n += 1;
    }
  }
  if (!n) return null;
  return { r: r / n, g: g / n, b: b / n, coverage: n / Math.max(1, (x1 - x0) * (y1 - y0)) };
}

export function spriteFromPixels(src, options = {}) {
  const {
    grid = { w: 96, h: 128 },
    mode = 'palette',
    palette = [],
    ink = [28, 22, 16],
    dither = 2,
    levels = 4,
    outline = true,
    fill = 0.94,
    alphaCutoff = 96,
    floorAlpha = 0.34,
    background = null,
    box = null
  } = options;

  const { data, w, h } = src;
  if (box) {
    return cropBox(src, { ...options, fill: 1 }, box);
  }
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      if (data[(row + x) * 4 + 3] > alphaCutoff) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;

  const bw = Math.max(1, x1 - x0 + 1);
  const bh = Math.max(1, y1 - y0 + 1);
  const scale = Math.min(grid.w / bw, grid.h / bh) * fill;
  const dw = bw * scale;
  const dh = bh * scale;
  const dx = (grid.w - dw) / 2;
  const dy = (grid.h - dh) / 2;

  const out = new Uint8ClampedArray(grid.w * grid.h * 4);
  const filled = new Uint8Array(grid.w * grid.h);
  const index = new Uint8Array(grid.w * grid.h).fill(255);
  const step = 1 / scale;

  for (let gy = 0; gy < grid.h; gy += 1) {
    for (let gx = 0; gx < grid.w; gx += 1) {
      const sx0 = x0 + (gx - dx) * step;
      const sy0 = y0 + (gy - dy) * step;
      const avg = boxAverage(data, w, h, sx0, sy0, sx0 + step, sy0 + step, alphaCutoff);
      const idx = (gy * grid.w + gx) * 4;
      if (!avg || avg.coverage < floorAlpha) continue;
      let chosen = 255;
      const bias = (BAYER[((gy / DITHER_BLOCK) | 0) & 1][((gx / DITHER_BLOCK) | 0) & 1] / 3 - 0.5) * dither * 6;
      let r = avg.r + bias;
      let g = avg.g + bias;
      let b = avg.b + bias;
      if (mode === 'poster' || !palette.length) {
        const q = v => {
          const clamped = Math.max(0, Math.min(255, v));
          return Math.round(clamped / 255 * (levels - 1)) / (levels - 1) * 255;
        };
        r = q(r); g = q(g); b = q(b);
      } else {
        let best = 0;
        let bestD = Infinity;
        for (let p = 0; p < palette.length; p += 1) {
          const c = palette[p];
          const dr = c[0] - r; const dg = c[1] - g; const db = c[2] - b;
          const dist = dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11;
          if (dist < bestD) { bestD = dist; best = p; }
        }
        const c = palette[best];
        [r, g, b] = c;
        chosen = best;
      }
      out[idx] = Math.max(0, Math.min(255, r));
      out[idx + 1] = Math.max(0, Math.min(255, g));
      out[idx + 2] = Math.max(0, Math.min(255, b));
      out[idx + 3] = 255;
      index[gy * grid.w + gx] = chosen;
      filled[gy * grid.w + gx] = 1;
    }
  }

  if (outline) {
    const isFilled = (x, y) => x >= 0 && y >= 0 && x < grid.w && y < grid.h && filled[y * grid.w + x] === 1;
    for (let y = 0; y < grid.h; y += 1) {
      for (let x = 0; x < grid.w; x += 1) {
        if (isFilled(x, y)) continue;
        if (isFilled(x - 1, y) || isFilled(x + 1, y) || isFilled(x, y - 1) || isFilled(x, y + 1)) {
          const idx = (y * grid.w + x) * 4;
          out[idx] = ink[0]; out[idx + 1] = ink[1]; out[idx + 2] = ink[2]; out[idx + 3] = 255;
          index[y * grid.w + x] = palette.length;
        }
      }
    }
  }

  if (background) {
    for (let i = 0; i < out.length; i += 4) {
      if (out[i + 3] > 0) continue;
      out[i] = background[0]; out[i + 1] = background[1]; out[i + 2] = background[2]; out[i + 3] = 255;
    }
  }

  return { data: out, w: grid.w, h: grid.h, index, sourceBox: { x0, y0, x1, y1 } };
}

/**
 * Тот же раскрой, но по фиксированной рамке, а не по габаритам силуэта.
 * Нужно для запекки анимации: если каждый кадр центрировать по своему боксу,
 * персонаж дрожит на месте вместо шага — рамка одна на все кадры ряда.
 */
function cropBox(src, options, box) {
  const { grid, mode = 'palette', palette = [], ink = [28, 22, 16], dither = 0, levels = 4, outline = true, alphaCutoff = 96 } = options;
  const { data, w } = src;
  const scale = box.w / grid.w;
  const out = new Uint8ClampedArray(grid.w * grid.h * 4);
  const index = new Uint8Array(grid.w * grid.h).fill(255);
  const filled = new Uint8Array(grid.w * grid.h);
  for (let gy = 0; gy < grid.h; gy += 1) {
    for (let gx = 0; gx < grid.w; gx += 1) {
      const avg = boxAverage(data, w, src.h, box.x + gx * scale, box.y + gy * scale, box.x + (gx + 1) * scale, box.y + (gy + 1) * scale, alphaCutoff);
      if (!avg) continue;
      const at = (gy * grid.w + gx) * 4;
      const bias = (BAYER[((gy / DITHER_BLOCK) | 0) & 1][((gx / DITHER_BLOCK) | 0) & 1] / 3 - 0.5) * dither * 6;
      let r = avg.r + bias; let g = avg.g + bias; let b = avg.b + bias;
      let chosen = 255;
      if (mode === 'poster' || !palette.length) {
        const q = v => Math.round(Math.max(0, Math.min(255, v)) / 255 * (levels - 1)) / (levels - 1) * 255;
        r = q(r); g = q(g); b = q(b);
      } else {
        let bestD = Infinity;
        for (let p = 0; p < palette.length; p += 1) {
          const c = palette[p];
          const dr = c[0] - r; const dg = c[1] - g; const db = c[2] - b;
          const dist = dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11;
          if (dist < bestD) { bestD = dist; chosen = p; }
        }
        [r, g, b] = palette[chosen];
      }
      out[at] = Math.max(0, Math.min(255, r));
      out[at + 1] = Math.max(0, Math.min(255, g));
      out[at + 2] = Math.max(0, Math.min(255, b));
      out[at + 3] = 255;
      index[gy * grid.w + gx] = chosen;
      filled[gy * grid.w + gx] = 1;
    }
  }
  if (outline) {
    // Обводка может быть в n пикселей: на 60-пиксельной фигуре один пиксель
    // тонет в фоне, два — уже держат силуэт. Кольца наращиваем наружу, поэтому
    // следующий проход видит уже залитый контур.
    const rings = Math.max(1, options.outlineWidth || 1);
    const outlineIndex = Math.max(0, palette.length);
    for (let ring = 0; ring < rings; ring += 1) {
      const before = Uint8Array.from(filled);
      const isFilled = (x, y) => x >= 0 && y >= 0 && x < grid.w && y < grid.h && before[y * grid.w + x] === 1;
      for (let y = 0; y < grid.h; y += 1) {
        for (let x = 0; x < grid.w; x += 1) {
          const at = y * grid.w + x;
          if (before[at] === 1) continue;
          if (!(isFilled(x - 1, y) || isFilled(x + 1, y) || isFilled(x, y - 1) || isFilled(x, y + 1))) continue;
          const px = at * 4;
          out[px] = ink[0]; out[px + 1] = ink[1]; out[px + 2] = ink[2]; out[px + 3] = 255;
          index[at] = outlineIndex;
          filled[at] = 1;
        }
      }
    }
  }
  return { data: out, w: grid.w, h: grid.h, index, sourceBox: box };
}
