import { createPixelRenderer } from './layers/pixelpass.js';

const DEMO = { cols: 8, cell: { w: 96, h: 128 }, rows: [
  { name: 'idle', frames: 5, fps: 7 },
  { name: 'walk', frames: 8, fps: 10 },
  { name: 'run', frames: 8, fps: 14 }
] };

const canvas = document.getElementById('sheetCanvas');
const ctx = canvas.getContext('2d', { alpha: true });
const rowPick = document.getElementById('rowPick');
const facePick = document.getElementById('facePick');
const fpsPick = document.getElementById('fpsPick');
const zoomPick = document.getElementById('zoomPick');
const sourceTag = document.getElementById('sourceTag');

const renderPixel = createPixelRenderer((w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
});

function buildDemoSheet() {
  const sheet = document.createElement('canvas');
  sheet.width = DEMO.cols * DEMO.cell.w;
  sheet.height = DEMO.rows.length * DEMO.cell.h;
  const sctx = sheet.getContext('2d', { alpha: true });
  const state = {
    style: 'pixel', direction: 'down', leadHand: 'right', wetness: 0,
    garments: { shirt: true, trousers: true, coat: true, scarf: true, boots: true, cloak: false, pack: true },
    items: { right: 'axe', left: 'torch' }
  };
  DEMO.rows.forEach((row, r) => {
    const fps = row.fps;
    for (let i = 0; i < row.frames; i += 1) {
      sctx.save();
      sctx.translate(i * DEMO.cell.w, r * DEMO.cell.h);
      state.motion = row.name;
      renderPixel(sctx, DEMO.cell.w, DEMO.cell.h, state, i / fps);
      sctx.restore();
    }
  });
  return sheet;
}

function loadImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

let sheet = null;
let cell = { w: DEMO.cell.w, h: DEMO.cell.h };
let rowFrames = DEMO.rows.map(r => r.frames);
let sourceName = 'demo';

async function pickSource() {
  sourceTag.textContent = 'загрузка…';
  const wanted = new URLSearchParams(location.search).get('sheet');
  const candidates = wanted ? [wanted] : ['./gandalf-refs/male.png', './gandalf-refs/female.png'];
  for (const url of candidates) {
    const img = await loadImage(url);
    if (img && img.width > 160) {
      sheet = img;
      cell = { w: 80, h: 64 };
      const cols = Math.floor(img.width / cell.w);
      const rowCount = Math.floor(img.height / cell.h);
      const standard = [5, 8, 8, 4, 4, 6, 10];
      rowFrames = Array.from({ length: rowCount }, (_, r) => Math.min(standard[r] ?? cols, cols));
      sourceName = `PACK · ${url.split('/').pop()}`;
      applyRowAvailability();
      sourceTag.textContent = sourceName;
      return;
    }
  }
  sheet = buildDemoSheet();
  sourceName = 'демо-лист (пиксель-риг лаборатории)';
  applyRowAvailability();
  sourceTag.textContent = `${sourceName} · male.png/female.png не найдены`;
}

function applyRowAvailability() {
  for (const option of rowPick.options) {
    const idx = Number(option.value);
    const ok = (rowFrames[idx] ?? 0) > 0 && idx < rowFrames.length;
    option.disabled = !ok;
    option.textContent = ok ? `${['Idle', 'Walk', 'Run', 'Jump', 'Fall', 'Attack', 'Death'][idx]} · ${rowFrames[idx]} кадр.` : ['Idle', 'Walk', 'Run', 'Jump', 'Fall', 'Attack', 'Death'][idx];
  }
  if (rowPick.selectedOptions[0]?.disabled) {
    const first = [...rowPick.options].find(o => !o.disabled);
    if (first) rowPick.value = first.value;
  }
}

let startTime = performance.now();
function frame(now) {
  if (sheet) {
    const row = Number(rowPick.value);
    const frames = rowFrames[row] || 1;
    const fps = Number(fpsPick.value);
    const zoom = [2, 3, 4][Number(zoomPick.value) - 1];
    const face = Number(facePick.value);
    canvas.width = Math.round(cell.w * zoom);
    canvas.height = Math.round(cell.h * zoom);
    const t = (now - startTime) / 1000;
    const fi = Math.floor(t * fps) % frames;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (face === -1) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(sheet, fi * cell.w, row * cell.h, cell.w, cell.h, 0, 0, cell.w * zoom, cell.h * zoom);
    ctx.restore();
  }
  requestAnimationFrame(frame);
}

pickSource();
requestAnimationFrame(frame);
