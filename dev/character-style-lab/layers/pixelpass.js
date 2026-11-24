// Pixel-art pass: quantizes the layered vector rig into a chunky sprite grid
// with a curated palette, dithering, silhouettes outlines and torch lighting.
import { drawLayeredCharacter } from './render.js';
import { buildPose } from './rig.js';

const SURFACE = { width: 760, height: 620 };
const VIEW = { x: 258, y: 74, w: 244, h: 448 };
const CELL = 4;
export const GRID = { width: VIEW.w / CELL, height: VIEW.h / CELL };

// Limited palette: every sprite pixel snaps to one of these, so coats of
// varnish never appear between the bands. Ordered dark → base → light per family.
const PALETTE = [
  '#1c1610', '#241d18', '#33271d', '#453224', '#5c4430', '#77593c', '#93704a', '#b18a58', '#d2ab74',
  '#2e361f', '#414d28', '#5d6b3c', '#788750', '#93a165', '#b0bd85',
  '#26262d', '#33333b', '#474750', '#5b5b66', '#75757f',
  '#8a4f28', '#a86540', '#c9805a', '#e09a6f', '#f0b585', '#f7c99e',
  '#7a5330', '#94663b', '#b5855a', '#cf9d68',
  '#3a2517', '#503322', '#69452c', '#84573a', '#9d6f4a', '#bb9068',
  '#4a2f18', '#5f3d20', '#7c4f28', '#a9764a', '#c89a63',
  '#6e674f', '#8b8168', '#b5aa91', '#d9d0b8', '#efe7d2',
  '#a99c74', '#c3b78f', '#d9cfa9', '#e6dcbc', '#f4ecd2',
  '#292b30', '#3b3d44', '#52525d', '#6d6e78',
  '#46503a', '#5a6441', '#717c52', '#8d8a72', '#a8a488',
  '#382f2c', '#55605c', '#6f7b77', '#8b9691', '#b4bdb8', '#d7ded6', '#eef2ec',
  '#7a5a28', '#a17c3c', '#c29853', '#ddc079', '#f0dca4',
  '#7e3d12', '#a85e1f', '#d97a28', '#e88230', '#f7b850', '#ffe08c', '#fff3b6',
  '#31616e', '#4c8494', '#7fb3bf', '#cfe9e6',
  '#18211a', '#243026', '#39473a', '#556250'
];

const HEX = PALETTE.map(hex => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)
]);
const INK = PALETTE.indexOf('#1c1610');
const BAYER = [[0, 2], [3, 1]];

function nearestPalette(r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < HEX.length; i += 1) {
    const c = HEX[i];
    const dr = (c[0] - r) * 0.30;
    const dg = (c[1] - g) * 0.59;
    const db = (c[2] - b) * 0.11;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function flameWorld(state, time) {
  const pose = buildPose({ ...state, time });
  for (const role of ['right', 'left']) {
    if (state.items && state.items[role] === 'torch') {
      return { x: pose.hands[role].x + 2, y: pose.hands[role].y - 66 };
    }
  }
  return null;
}

export function createPixelRenderer(makeCanvas) {
  let surface = null;
  let sctx = null;
  function ensure() {
    if (surface) return;
    surface = makeCanvas(SURFACE.width, SURFACE.height);
    sctx = surface.getContext('2d', { alpha: true });
  }

  function renderPixelSprite(ctx, width, height, state, time) {
    ensure();
    drawLayeredCharacter(sctx, SURFACE.width, SURFACE.height, state, time);
    const src = sctx.getImageData(VIEW.x, VIEW.y, VIEW.w, VIEW.h).data;
    const gw = GRID.width, gh = GRID.height;
    const grid = new Int16Array(gw * gh).fill(-1);
    const tone = new Uint8Array(gw * gh);
    const wet = Math.max(0, Math.min(1, state.wetness ?? 0));
    const light = flameWorld(state, time);
    for (let gy = 0; gy < gh; gy += 1) {
      for (let gx = 0; gx < gw; gx += 1) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let oy = 0; oy < CELL; oy += 1) {
          for (let ox = 0; ox < CELL; ox += 1) {
            const i = (((gy * CELL) + oy) * VIEW.w + (gx * CELL) + ox) * 4;
            const al = src[i + 3];
            a += al; r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al;
          }
        }
        if (a < 40 * CELL * CELL) continue;
        a /= CELL * CELL;
        r /= a * CELL * CELL; g /= a * CELL * CELL; b /= a * CELL * CELL;
        const cx = gx * CELL + VIEW.x;
        const cy = gy * CELL + VIEW.y;
        let warm = 0;
        if (light) {
          const d = Math.hypot(cx - light.x, cy - light.y);
          warm = Math.max(0, 1 - d / 84);
          warm *= warm * 0.8;
        }
        if (warm > 0.05) { r += (255 - r) * warm * 0.42; g += (198 - g) * warm * 0.36; b += (128 - b) * warm * 0.3; }
        else {
          const side = cx > 380 ? -0.06 : 0.10;
          if (side > 0) { r *= 1 - side; g *= 1 - side; b *= 1 - side; }
        }
        if (wet > 0.02) { const k = 1 - 0.22 * wet; r *= k; g *= k * 0.99; b *= k + 0.14 * wet; }
        const dith = (BAYER[gy & 1][gx & 1] - 1.5) * (2.6 + wet * 2);
        r = Math.max(0, Math.min(255, r + dith));
        g = Math.max(0, Math.min(255, g + dith));
        b = Math.max(0, Math.min(255, b + dith));
        grid[gy * gw + gx] = nearestPalette(r, g, b);
        tone[gy * gw + gx] = a < 95 ? 0 : a < 160 ? 1 : a < 220 ? 2 : 3;
      }
    }
    // Face overrides: at 4px cells the vector eyes dissolve, so paint them back.
    {
      const pose = buildPose({ ...state, time });
      const set = (wx, wy, idx) => {
        const x = pose.mirror ? SURFACE.width - wx - 1 : wx;
        const gxx = Math.floor((x - VIEW.x) / CELL);
        const gyy = Math.floor((wy - VIEW.y) / CELL);
        if (gxx < 0 || gyy < 0 || gxx >= gw || gyy >= gh) return;
        const i = gyy * gw + gxx;
        if (grid[i] < 0) return;
        grid[i] = idx; tone[i] = 3;
      };
      if (!pose.isBack) {
        if (pose.isSide) {
          set(363, 147, 0); set(367, 147, 0);
          set(357, 167, 4); set(361, 167, 4);
        } else {
          set(363, 149, 0); set(367, 149, 0);
          set(391, 149, 0); set(395, 149, 0);
          set(376, 171, 4); set(380, 172, 4); set(384, 171, 4);
        }
      }
    }
    // Silhouette outline: solid cells only, so glows and ground shadow stay soft.
    for (let gy = 0; gy < gh; gy += 1) {
      for (let gx = 0; gx < gw; gx += 1) {
        const i = gy * gw + gx;
        if (grid[i] < 0 || tone[i] < 2) continue;
        const blank = (j, ok) => !ok || grid[j] < 0 || tone[j] < 1;
        const empty =
          gx === 0 || gy === 0 || gx === gw - 1 || gy === gh - 1 ||
          blank(i - 1, gx > 0) || blank(i + 1, gx < gw - 1) ||
          blank(i - gw, gy > 0) || blank(i + gw, gy < gh - 1);
        if (empty) grid[i] = INK;
      }
    }
    // Wet sheen: sparse glints on upward-facing edges.
    if (wet > 0.25) {
      for (let gy = 1; gy < gh; gy += 1) {
        for (let gx = 0; gx < gw; gx += 1) {
          const i = gy * gw + gx;
          if (grid[i] < 0 || grid[i] === INK) continue;
          if (grid[i - gw] >= 0) continue;
          if ((gx * 7 + gy * 13) % 5 === 0) grid[i] = PALETTE.indexOf('#cfe9e6');
        }
      }
    }
    const scale = Math.min(width / gw, (height - 10) / gh);
    const ox = (width - gw * scale) / 2;
    const oy = (height - gh * scale) / 2;
    ctx.imageSmoothingEnabled = false;
    for (let gy = 0; gy < gh; gy += 1) {
      for (let gx = 0; gx < gw; gx += 1) {
        const i = gy * gw + gx;
        const c = grid[i];
        if (c < 0) continue;
        ctx.globalAlpha = [0.34, 0.55, 0.78, 1][tone[i]];
        ctx.fillStyle = PALETTE[c];
        ctx.fillRect(ox + gx * scale, oy + gy * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
    ctx.globalAlpha = 1;
  }

  return renderPixelSprite;
}
