import { drawLayeredPortrait } from './variants.js';

const state = {
  motion: 'idle',
  direction: 'down',
  leadHand: 'right',
  style: 'pixel',
  wetness: 0.08,
  drying: false,
  garments: { shirt: true, trousers: true, coat: true, scarf: true, boots: true, cloak: false, pack: true },
  items: { right: 'axe', left: 'torch' }
};

const canvas = document.querySelector('#layersCanvas');
const context = canvas.getContext('2d', { alpha: true });
const motionButtons = [...document.querySelectorAll('[data-motion]')];
const styleButtons = [...document.querySelectorAll('[data-style]')];
const directionButtons = [...document.querySelectorAll('[data-direction]')];
const garmentInputs = [...document.querySelectorAll('[data-garment]')];
let size = { width: 0, height: 0, ratio: 0 };
const motionNames = { idle: 'Покой', walk: 'Шаг', run: 'Бег' };
const directionNames = { down: 'спереди', left: 'влево', up: 'со спины', right: 'вправо' };
let previousFrame = 0;
let elapsed = 0;

function updateStatus() {
  const percent = Math.round(state.wetness * 100);
  document.querySelector('#spriteStatus').textContent = `${motionNames[state.motion]} · ${directionNames[state.direction]} · влажность ${percent}%`;
  document.querySelector('#spriteWetnessLabel').textContent = `${percent}%`;
  document.querySelector('#layerState').textContent = `${state.direction.toUpperCase()} · ${state.motion.toUpperCase()}`;
}

function prepareCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2.25);
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (width !== size.width || height !== size.height || ratio !== size.ratio) {
    canvas.width = width;
    canvas.height = height;
    size = { width, height, ratio };
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width: rect.width, height: rect.height };
}

function render(now) {
  const delta = previousFrame ? Math.min(0.06, (now - previousFrame) / 1000) : 0;
  previousFrame = now;
  elapsed += delta;
  if (state.drying && state.wetness > 0) {
    state.wetness = Math.max(0, state.wetness - delta * 0.035);
    document.querySelector('#spriteWetness').value = String(Math.round(state.wetness * 100));
    updateStatus();
  }
  const canvasSize = prepareCanvas();
  if (canvasSize) drawLayeredPortrait(context, canvasSize.width, canvasSize.height, state, elapsed);
  requestAnimationFrame(render);
}

function setMotion(value) {
  state.motion = value;
  for (const button of motionButtons) button.setAttribute('aria-pressed', String(button.dataset.motion === value));
  updateStatus();
}

function setDirection(value) {
  state.direction = value;
  for (const button of directionButtons) button.setAttribute('aria-pressed', String(button.dataset.direction === value));
  updateStatus();
}

for (const button of motionButtons) button.addEventListener('click', () => setMotion(button.dataset.motion));
for (const button of directionButtons) button.addEventListener('click', () => setDirection(button.dataset.direction));
for (const input of garmentInputs) input.addEventListener('change', () => {
  state.garments[input.dataset.garment] = input.checked;
});
document.querySelector('#spriteLeadHand').addEventListener('change', event => {
  state.leadHand = event.currentTarget.value;
});
document.querySelector('#spriteRightItem').addEventListener('change', event => {
  state.items.right = event.currentTarget.value;
});
document.querySelector('#spriteLeftItem').addEventListener('change', event => {
  state.items.left = event.currentTarget.value;
});
document.querySelector('#spriteWetness').addEventListener('input', event => {
  state.wetness = Number(event.currentTarget.value) / 100;
  updateStatus();
});
document.querySelector('#spriteDrying').addEventListener('change', event => {
  state.drying = event.currentTarget.checked;
});

function setStyle(value) {
  state.style = value;
  for (const button of styleButtons) button.setAttribute('aria-pressed', String(button.dataset.style === value));
}

for (const button of styleButtons) button.addEventListener('click', () => setStyle(button.dataset.style));

setMotion(state.motion);
setDirection(state.direction);
setStyle(state.style);
updateStatus();
if ('ResizeObserver' in window) new ResizeObserver(prepareCanvas).observe(canvas);
requestAnimationFrame(render);
