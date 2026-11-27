import { calculateWarmth, countVisibleLayers, drawLayeredCharacter } from './render.js';

const canvas = document.querySelector('#rigCanvas');
const ctx = canvas.getContext('2d', { alpha: true });
const controls = {
  motionButtons: [...document.querySelectorAll('[data-motion]')],
  directionButtons: [...document.querySelectorAll('[data-direction]')],
  garments: [...document.querySelectorAll('[data-garment]')],
  rightItem: document.querySelector('#rightItem'),
  leftItem: document.querySelector('#leftItem'),
  leadHand: document.querySelector('#leadHand'),
  drying: document.querySelector('#drying'),
  wetness: document.querySelector('#wetness')
};

const state = {
  motion: 'idle', direction: 'down', leadHand: 'right', wetness: 0.08, drying: false,
  garments: { shirt: true, trousers: true, coat: true, scarf: true, boots: true, cloak: false, pack: true },
  items: { right: 'axe', left: 'torch' }
};
const motionNames = { idle: 'Покой', walk: 'Шаг', run: 'Бег' };
const directionNames = { down: 'спереди', left: 'влево', up: 'со спины', right: 'вправо' };
let previousFrame = 0;
let elapsed = 0;
let canvasWidth = 0;
let canvasHeight = 0;
let pixelRatio = 0;

function syncControls() {
  for (const checkbox of controls.garments) checkbox.checked = Boolean(state.garments[checkbox.dataset.garment]);
  controls.rightItem.value = state.items.right;
  controls.leftItem.value = state.items.left;
  controls.leadHand.value = state.leadHand;
  controls.drying.checked = state.drying;
  controls.wetness.value = String(Math.round((1 - state.wetness) * 100));
  updateReadouts();
}

function updateReadouts() {
  const warmth = calculateWarmth(state.garments);
  const layerCount = countVisibleLayers(state);
  const wetPercent = Math.round(state.wetness * 100);
  const dryness = 100 - wetPercent;
  const fabric = wetPercent > 67 ? 'Мокрая' : wetPercent > 28 ? 'Влажная' : 'Сухая';
  const motion = motionNames[state.motion];
  const direction = directionNames[state.direction];

  document.querySelector('#warmthValue').textContent = `${warmth} / 12`;
  document.querySelector('#warmthMeter').style.width = `${Math.min(100, warmth / 12 * 100)}%`;
  document.querySelector('#wetnessValue').textContent = `${wetPercent}%`;
  document.querySelector('#wetnessMeter').style.width = `${wetPercent}%`;
  document.querySelector('#fabricLabel').textContent = fabric;
  document.querySelector('#stageWetness').textContent = `ОДЕЖДА ${fabric.toUpperCase()}`;
  document.querySelector('#layerCount').textContent = `${layerCount} СЛОЁВ`;
  document.querySelector('#poseStatus').textContent = `${motion} · ${direction}`;
  document.querySelector('#viewMode').textContent = `${state.direction.toUpperCase()} / ${state.motion.toUpperCase()}`;
  document.querySelector('#drying').setAttribute('aria-label', state.drying ? 'Остановить сушку одежды' : 'Начать сушку одежды');
  document.querySelector('#warmthMeter').title = `Одежда добавляет ${warmth} условных единиц теплозащиты`;
  document.querySelector('#wetnessMeter').title = `Влажность ткани: ${wetPercent}% · сухость ${dryness}%`;
}

function setMotion(value) {
  state.motion = value;
  for (const button of controls.motionButtons) button.setAttribute('aria-pressed', String(button.dataset.motion === value));
  updateReadouts();
}

function setDirection(value) {
  state.direction = value;
  for (const button of controls.directionButtons) button.setAttribute('aria-pressed', String(button.dataset.direction === value));
  updateReadouts();
}

for (const button of controls.motionButtons) button.addEventListener('click', () => setMotion(button.dataset.motion));
for (const button of controls.directionButtons) button.addEventListener('click', () => setDirection(button.dataset.direction));
for (const checkbox of controls.garments) checkbox.addEventListener('change', () => {
  state.garments[checkbox.dataset.garment] = checkbox.checked;
  updateReadouts();
});
controls.rightItem.addEventListener('change', () => { state.items.right = controls.rightItem.value; updateReadouts(); });
controls.leftItem.addEventListener('change', () => { state.items.left = controls.leftItem.value; updateReadouts(); });
controls.leadHand.addEventListener('change', () => { state.leadHand = controls.leadHand.value; updateReadouts(); });
controls.drying.addEventListener('change', () => { state.drying = controls.drying.checked; updateReadouts(); });
controls.wetness.addEventListener('input', () => {
  state.wetness = 1 - Number(controls.wetness.value) / 100;
  updateReadouts();
});

document.querySelector('#dressSet').addEventListener('click', () => {
  for (const name of ['shirt', 'trousers', 'coat', 'scarf', 'boots']) state.garments[name] = true;
  state.garments.cloak = false;
  syncControls();
});
document.querySelector('#stripAll').addEventListener('click', () => {
  for (const name of ['shirt', 'trousers', 'coat', 'scarf', 'boots', 'cloak']) state.garments[name] = false;
  syncControls();
});

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const nextRatio = Math.min(window.devicePixelRatio || 1, 2.25);
  const width = Math.round(rect.width * nextRatio);
  const height = Math.round(rect.height * nextRatio);
  if (width !== canvasWidth || height !== canvasHeight || nextRatio !== pixelRatio) {
    canvas.width = width;
    canvas.height = height;
    canvasWidth = width;
    canvasHeight = height;
    pixelRatio = nextRatio;
  }
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { width: rect.width, height: rect.height };
}

function frame(now) {
  const delta = previousFrame ? Math.min(0.06, (now - previousFrame) / 1000) : 0;
  previousFrame = now;
  elapsed += delta;
  if (state.drying && state.wetness > 0) {
    state.wetness = Math.max(0, state.wetness - delta * 0.105);
    controls.wetness.value = String(Math.round((1 - state.wetness) * 100));
    updateReadouts();
  }
  const size = resizeCanvas();
  if (size) drawLayeredCharacter(ctx, size.width, size.height, state, elapsed);
  requestAnimationFrame(frame);
}

syncControls();
if ('ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe(canvas);
window.addEventListener('resize', resizeCanvas, { passive: true });
requestAnimationFrame(frame);
