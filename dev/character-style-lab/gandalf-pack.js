const PACK = './gandalf-refs/pack';
const status = document.getElementById('status');
const say = (msg, isError = false) => { status.textContent = msg; status.classList.toggle('err', isError); };

const frameCanvas = document.getElementById('frameCanvas');
const stripCanvas = document.getElementById('stripCanvas');
const frameCtx = frameCanvas.getContext('2d');
const stripCtx = stripCanvas.getContext('2d');
const rowPick = document.getElementById('rowPick');
const framePick = document.getElementById('framePick');
const fpsPick = document.getElementById('fpsPick');
const zoomPick = document.getElementById('zoomPick');
const playBtn = document.getElementById('playBtn');
const mirrorBtn = document.getElementById('mirrorBtn');
const gridBtn = document.getElementById('gridBtn');
const swatches = document.getElementById('swatches');
const paletteInfo = document.getElementById('paletteInfo');

const state = {
  row: 0, frame: 0, playing: false, mirror: false, grid: false,
  sex: 'male', base: null, hair: null, hand: null, clothing: []
};
let manifest = null;
const images = new Map();

function loadImage(relPath) {
  if (images.has(relPath)) return images.get(relPath);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`не отдаётся ${PACK}/${relPath}`));
    img.src = `${PACK}/${relPath}`;
  }).catch(error => { say(`${error.message}. Распакуйте пак: node dev/character-style-lab/tools/unpack-gandalf.mjs <zip>`, true); return null; });
  images.set(relPath, p);
  return p;
}

const options = (kind, sex) => (manifest?.assets || []).filter(a => a.kind === kind && a.sex === sex);

function buildOptions(el, items, { multiple = false, allowNone = true, current = null } = {}) {
  el.innerHTML = '';
  const list = allowNone ? [{ path: null, name: 'нет' }, ...items] : items;
  for (const item of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.name;
    btn.dataset.path = item.path || '';
    const active = multiple
      ? (current || []).includes(item.path)
      : (current || 'нет') === (item.path || 'нет');
    btn.setAttribute('aria-pressed', String(active));
    el.appendChild(btn);
  }
}

function wireLayer(el, apply) {
  el.addEventListener('click', event => {
    const btn = event.target.closest('button');
    if (!btn) return;
    apply(btn, el);
    render();
  });
}

async function refreshLayerChoices() {
  if (state.hair && state.hair.sex !== state.sex) state.hair = null;
  if (state.hand && state.hand.sex !== state.sex) state.hand = null;
  state.clothing = state.clothing.filter(p => options('clothing', state.sex).some(a => a.path === p));
  const bases = options('base', state.sex);
  if (!bases.some(a => a.path === state.base?.path)) state.base = bases[0] || null;
  buildOptions(document.getElementById('basePick'), bases, { allowNone: false, current: state.base?.path });
  buildOptions(document.getElementById('hairPick'), options('hair', state.sex), { current: state.hair?.path || 'нет' });
  buildOptions(document.getElementById('clothingPick'), options('clothing', state.sex), { multiple: true, allowNone: false, current: state.clothing });
  buildOptions(document.getElementById('handPick'), options('hand', state.sex), { current: state.hand?.path || 'нет' });
  await measurePalette();
}

function layerStack() {
  const stack = [];
  if (state.base) stack.push(state.base.path);
  for (const p of state.clothing) stack.push(p);
  if (state.hair) stack.push(state.hair.path);
  if (state.hand) stack.push(state.hand.path);
  return stack;
}

function rows() { return manifest?.rows || []; }
function framesInRow(row) { return (manifest?.framesPerRow || [])[row] || 1; }

async function drawRow(target, ctx, row, { zoom, onlyFrame = null, cellGap = 0 }) {
  const { w: CW, h: CH } = manifest.cell;
  const frames = onlyFrame !== null ? 1 : framesInRow(row);
  const count = onlyFrame !== null ? 1 : frames;
  target.width = CW * zoom * count + cellGap * (count - 1);
  target.height = CH * zoom;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b1410';
  ctx.fillRect(0, 0, target.width, target.height);
  const stack = layerStack();
  const loaded = await Promise.all(stack.map(loadImage));
  for (let i = 0; i < count; i += 1) {
    const frame = onlyFrame !== null ? onlyFrame : i;
    const ox = i * (CW * zoom + cellGap);
    ctx.save();
    if (state.mirror) { ctx.translate(ox + CW * zoom, 0); ctx.scale(-1, 1); ctx.translate(-ox, 0); }
    loaded.forEach((img, index) => {
      if (!img) return;
      ctx.drawImage(img, frame * CW, row * CH, CW, CH, ox, 0, CW * zoom, CH * zoom);
    });
    ctx.restore();
  }
  if (state.grid) {
    ctx.strokeStyle = 'rgba(143,177,105,.35)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= target.width; x += zoom) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, target.height); ctx.stroke();
    }
    for (let y = 0; y <= target.height; y += zoom) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(target.width, y + 0.5); ctx.stroke();
    }
  }
  return frames;
}

let rendering = null;
function render() {
  if (!manifest) return Promise.resolve();
  if (rendering) return rendering;
  rendering = renderNow().finally(() => { rendering = null; });
  return rendering;
}

async function renderNow() {
  if (!manifest) return;
  const zoom = Number(zoomPick.value);
  await drawRow(frameCanvas, frameCtx, state.row, { zoom, onlyFrame: state.frame });
  await drawRow(stripCanvas, stripCtx, state.row, { zoom: 2, cellGap: 2 });
}

async function measurePalette() {
  if (!state.base) return;
  const img = await loadImage(state.base.path);
  if (!img) return;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, c.width, c.height).data;
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 24) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  swatches.innerHTML = '';
  for (const [rgb, amount] of sorted.slice(0, 28)) {
    const hex = `#${rgb.toString(16).padStart(6, '0')}`;
    const dot = document.createElement('i');
    dot.style.background = hex;
    dot.title = `${hex} · ${amount} пикселей`;
    swatches.appendChild(dot);
  }
  paletteInfo.textContent = `${sorted.length} уникальных цветов в листе «${state.base.name}»; топ: ${sorted.slice(0, 3).map(([, n]) => n).join(' / ')} пикселей.`;
}

let last = 0;
function loop(now) {
  if (state.playing && manifest) {
    const dt = (now - last) / 1000;
    last = now;
    const frames = framesInRow(state.row);
    state.frame = (state.frame + dt * Number(fpsPick.value)) % frames;
    framePick.value = String(Math.floor(state.frame));
    render();
  } else {
    last = now;
  }
  requestAnimationFrame(loop);
}

function setRow(row) {
  state.row = row;
  const frames = framesInRow(row);
  framePick.max = String(frames - 1);
  state.frame = 0;
  framePick.value = '0';
  if (manifest?.fpsPerRow) fpsPick.value = String(manifest.fpsPerRow[row]);
  rowPick.value = String(row);
}

async function boot() {
  try {
    const res = await fetch(`${PACK}/manifest.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
    manifest = await res.json();
  } catch (error) {
    say(`пак не найден (${error.message}). Распакуйте его в стенд: node dev/character-style-lab/tools/unpack-gandalf.mjs <zip>`, true);
    return;
  }
  rowPick.innerHTML = '';
  rows().forEach((name, index) => {
    const opt = document.createElement('option');
    opt.value = String(index);
    opt.textContent = `${name} · ${framesInRow(index)} кадров`;
    rowPick.appendChild(opt);
  });
  setRow(0);

  wireLayer(document.getElementById('basePick'), btn => {
    state.base = options('base', state.sex).find(a => a.path === btn.dataset.path) || null;
    for (const b of btn.parentElement.children) b.setAttribute('aria-pressed', String(b === btn));
    measurePalette();
  });
  wireLayer(document.getElementById('hairPick'), btn => {
    state.hair = btn.dataset.path ? options('hair', state.sex).find(a => a.path === btn.dataset.path) : null;
    for (const b of btn.parentElement.children) b.setAttribute('aria-pressed', String(b === btn));
  });
  wireLayer(document.getElementById('handPick'), btn => {
    state.hand = btn.dataset.path ? options('hand', state.sex).find(a => a.path === btn.dataset.path) : null;
    for (const b of btn.parentElement.children) b.setAttribute('aria-pressed', String(b === btn));
  });
  wireLayer(document.getElementById('clothingPick'), btn => {
    const set = new Set(state.clothing);
    if (set.has(btn.dataset.path)) set.delete(btn.dataset.path);
    else set.add(btn.dataset.path);
    state.clothing = options('clothing', state.sex).filter(a => set.has(a.path)).map(a => a.path);
    for (const b of btn.parentElement.children) b.setAttribute('aria-pressed', String(state.clothing.includes(b.dataset.path)));
  });
  const sexRow = document.createElement('div');
  sexRow.className = 'layer-group';
  sexRow.innerHTML = '<span>Пол</span><div class="opts" id="sexPick"></div>';
  document.querySelector('.layers').prepend(sexRow);
  const sexPick = sexRow.querySelector('#sexPick');
  for (const sex of ['male', 'female']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = sex === 'male' ? 'Мужской' : 'Женский';
    btn.dataset.sex = sex;
    btn.setAttribute('aria-pressed', String(sex === state.sex));
    sexPick.appendChild(btn);
  }
  sexPick.addEventListener('click', async event => {
    const btn = event.target.closest('button');
    if (!btn) return;
    state.sex = btn.dataset.sex;
    for (const b of sexPick.children) b.setAttribute('aria-pressed', String(b === btn));
    state.base = null;
    await refreshLayerChoices();
    render();
  });

  rowPick.addEventListener('change', () => { setRow(Number(rowPick.value)); render(); });
  framePick.addEventListener('input', () => { state.playing = false; playBtn.textContent = 'Играть ▸'; state.frame = Number(framePick.value); render(); });
  fpsPick.addEventListener('input', () => {});
  zoomPick.addEventListener('change', render);
  playBtn.addEventListener('click', () => { state.playing = !state.playing; playBtn.textContent = state.playing ? 'Пауза ❙❙' : 'Играть ▸'; });
  mirrorBtn.addEventListener('click', () => {
    state.mirror = !state.mirror;
    mirrorBtn.setAttribute('aria-pressed', String(state.mirror));
    render();
  });
  gridBtn.addEventListener('click', () => {
    state.grid = !state.grid;
    gridBtn.setAttribute('aria-pressed', String(state.grid));
    render();
  });
  window.addEventListener('keydown', event => {
    if (event.target.matches('input, select')) return;
    const frames = framesInRow(state.row);
    if (event.key === 'ArrowRight') { state.frame = (state.frame + 1) % frames; framePick.value = String(state.frame); render(); }
    else if (event.key === 'ArrowLeft') { state.frame = (state.frame - 1 + frames) % frames; framePick.value = String(state.frame); render(); }
    else if (event.code === 'Space') { event.preventDefault(); playBtn.click(); }
    else if (/^[1-7]$/.test(event.key)) { setRow(Number(event.key) - 1); render(); }
  });

  await refreshLayerChoices();
  await render();
  const total = manifest.assets.length;
  say(`готово: ${total} листов по ${manifest.cell.w}×${manifest.cell.h}, ряды ${manifest.framesPerRow.join('/')}`);
  requestAnimationFrame(loop);
}

boot();
