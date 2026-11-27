import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPixelRenderer } from './layers/pixelpass.js';
import { palette } from './layers/palette.js';
import { spriteFromPixels, buildPalette } from './layers/photopix.js';

const ASSETS = './assets/quaternius';
const CHARMS = { male: 'Superhero_Male_FullBody', female: 'Superhero_Female_FullBody' };
const status = document.getElementById('status');
const say = (msg, isError = false) => { status.textContent = msg; status.classList.toggle('err', isError); };

const host = document.getElementById('glHost');
const pixCanvas = document.getElementById('pixCanvas');
const gameCanvas = document.getElementById('gameCanvas');
const gameCtx = gameCanvas ? gameCanvas.getContext('2d') : null;
const sheetCanvas = document.getElementById('sheetCanvas');
const refCanvas = document.getElementById('refCanvas');
const clipPick = document.getElementById('clipPick');
const speedPick = document.getElementById('speedPick');
const framePick = document.getElementById('framePick');
const yawPick = document.getElementById('yawPick');
const gridPick = document.getElementById('gridPick');
const quantPick = document.getElementById('quantPick');
const ditherPick = document.getElementById('ditherPick');
const outlineBtn = document.getElementById('outlineBtn');
const playBtn = document.getElementById('playBtn');
const resetBtn = document.getElementById('resetBtn');
const sheetBtn = document.getElementById('sheetBtn');
const saveBtn = document.getElementById('saveBtn');

let renderer, scene, camera, controls, mixer, action, model, clock;
let playing = false;
let clips = [];
const models = new Map();
const groundGroup = new THREE.Group();

const PALETTE_RGB = buildPalette(palette);
const INK = [28, 22, 16];

function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(host.clientWidth || 420, host.clientHeight || 560, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 3 / 4, 0.1, 40);
  camera.position.set(1.35, 1.42, 2.35);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.94, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.9;
  controls.maxDistance = 6;
  controls.maxPolarAngle = Math.PI * 0.55;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3227, 1.15));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.5);
  key.position.set(2.2, 3.1, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 12;
  key.shadow.camera.left = -1.6; key.shadow.camera.right = 1.6;
  key.shadow.camera.top = 2.4; key.shadow.camera.bottom = -0.4;
  key.shadow.bias = -0.0012;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb169, 0.85);
  rim.position.set(-2.4, 1.6, -2.2);
  scene.add(rim);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.25, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b2a1c, roughness: 0.96, metalness: 0 })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.receiveShadow = true;
  groundGroup.add(disc);
  scene.add(groundGroup);
  clock = new THREE.Clock();
}

function loadGltf(url) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, resolve, undefined, reject);
  });
}

async function ensureModel(which) {
  if (models.has(which)) return models.get(which);
  const gltf = await loadGltf(`${ASSETS}/char/${CHARMS[which]}.gltf`);
  const root = gltf.scene;
  root.traverse(obj => {
    if (obj.isMesh || obj.isSkinnedMesh) {
      obj.castShadow = true;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
      const mat = obj.material;
      if (mat && mat.isMeshStandardMaterial) {
        mat.roughness = Math.min(1, (mat.roughness ?? 1) * 0.92);
        mat.envMapIntensity = 0.7;
      }
    }
  });
  const entry = { root, bones: new Set() };
  root.traverse(obj => { if (obj.name) entry.bones.add(obj.name); });
  models.set(which, entry);
  return entry;
}

async function ensureClips() {
  if (clips.length) return clips;
  const gltf = await loadGltf(`${ASSETS}/anims.glb`);
  const order = ['A_TPose', 'Idle_Loop', 'Idle_Talking_Loop', 'Idle_Torch_Loop', 'Walk_Loop', 'Walk_Formal_Loop',
    'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Sitting_Idle_Loop', 'Sword_Idle', 'Sword_Attack',
    'Punch_Jab', 'Punch_Cross', 'Interact', 'PickUp_Table', 'Fixing_Kneeling', 'Hit_Head', 'Hit_Chest',
    'Death01', 'Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down', 'Pistol_Shoot',
    'Pistol_Reload', 'Push_Loop', 'Driving_Loop'];
  const byName = new Map(gltf.animations.map(c => [c.name, c]));
  clips = [...order].filter(n => byName.has(n)).concat(gltf.animations.map(c => c.name).filter(n => !order.includes(n)))
    .map(n => byName.get(n)).filter(Boolean);
  return clips;
}

function clipFor(clip, boneNames) {
  const tracks = clip.tracks.filter(t => boneNames.has(String(t.name).split('.')[0]));
  const out = clip.clone();
  out.tracks = tracks.length ? tracks : clip.tracks;
  out.name = clip.name;
  return out;
}

async function setCharacter(which) {
  say(`загружаю ${which}…`);
  const [entry] = await Promise.all([ensureModel(which), ensureClips()]);
  if (model) scene.remove(model);
  model = entry.root;
  scene.add(model);
  mixer = new THREE.AnimationMixer(model);
  populateClips(entry.bones);
  applyClip();
  say(`готово: ${CHARMS[which]} · 65 костей · ${clips.length} клипов`);
}

function populateClips(boneNames) {
  const label = {
    A_TPose: 'T-pose (bind)', Idle_Loop: 'Покой', Idle_Talking_Loop: 'Покой + разговор',
    Idle_Torch_Loop: 'Покой с факелом', Walk_Loop: 'Шаг', Walk_Formal_Loop: 'Шаг парадный',
    Jog_Fwd_Loop: 'Бег', Sprint_Loop: 'Спринт', Crouch_Idle_Loop: 'Присев', Sitting_Idle_Loop: 'Сидя',
    Sword_Idle: 'Меч: стойка', Sword_Attack: 'Меч: удар', Punch_Jab: 'Удар рукой', Punch_Cross: 'Хук',
    Interact: 'Взять предмет', PickUp_Table: 'Поднять', Fixing_Kneeling: 'Чинить на коленях',
    Hit_Head: 'Попадание в голову', Hit_Chest: 'Попадание в тело', Death01: 'Смерть',
    Pistol_Idle_Loop: 'Пистолет: стойка', Pistol_Aim_Neutral: 'Пистолет: прицел',
    Pistol_Aim_Up: 'Пистолет: вверх', Pistol_Aim_Down: 'Пистолет: вниз',
    Pistol_Shoot: 'Пистолет: выстрел', Pistol_Reload: 'Пистолет: перезарядка', Push_Loop: 'Толкать', Driving_Loop: 'Руль'
  };
  clipPick.innerHTML = '';
  for (const clip of clips) {
    if (!clip.tracks.length) continue;
    const opt = document.createElement('option');
    opt.value = clip.name;
    opt.textContent = `${label[clip.name] || clip.name} · ${clip.name}`;
    clipPick.appendChild(opt);
  }
  clipPick.dataset.ready = '1';
  clipPick._bones = boneNames;
  if (action) action.stop();
}

function currentClip() {
  const boneNames = clipPick._bones || new Set();
  const raw = clips.find(c => c.name === clipPick.value) || clips[0];
  return raw ? clipFor(raw, boneNames) : null;
}

function applyClip() {
  if (!mixer) return;
  const clip = currentClip();
  if (!clip) { say('нет ни одного подходящего клипа', true); return; }
  if (action) action.stop();
  action = mixer.clipAction(clip);
  action.clampWhenFinished = true;
  action.setLoop(clip.name === 'Death01' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  action.reset().play();
  action.timeScale = Number(speedPick.value) / 100;
  const frames = estimateFrames(clip);
  framePick.max = String(Math.max(1, frames - 1));
  framePick.value = '0';
  if (!playing) { action.time = frames > 1 ? (0 / frames) * clip.duration : 0; mixer.update(0); }
}

function estimateFrames(clip) {
  const track = clip.tracks[0];
  if (!track || !track.times) return 8;
  return Math.max(2, Math.round((track.times.length - 1) * (clip.duration / Math.max(0.0001, track.times[track.times.length - 1]))));
}

const pixCtx = pixCanvas.getContext('2d', { willReadFrequently: true });
const sheetCtx = sheetCanvas.getContext('2d', { willReadFrequently: true });
const refCtx = refCanvas.getContext('2d', { willReadFrequently: true });
const tmp = document.createElement('canvas');
const tmpCtx = tmp.getContext('2d', { willReadFrequently: true });
const cell = document.createElement('canvas');
const cellCtx = cell.getContext('2d', { willReadFrequently: true });

function gridSize() {
  const [w, h] = gridPick.value.split('x').map(Number);
  const opt = gridPick.selectedOptions[0];
  return { w, h, fill: Number(opt?.dataset?.fill || 0.94) };
}

const renderPixel = createPixelRenderer((w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h; return c;
});

function renderReference(time, motion) {
  refCtx.fillStyle = '#16241c';
  refCtx.fillRect(0, 0, refCanvas.width, refCanvas.height);
  const yaw = Number(yawPick.value);
  const a = ((yaw % 360) + 360) % 360;
  const direction = a < 45 || a > 315 ? 'down' : a < 135 ? 'left' : a < 225 ? 'up' : 'right';
  renderPixel(refCtx, refCanvas.width, refCanvas.height, {
    style: 'pixel', motion, direction, leadHand: 'right', wetness: 0,
    garments: { shirt: true, trousers: true, coat: true, scarf: true, boots: true, cloak: false, pack: true },
    items: { right: 'axe', left: 'torch' }
  }, time);
}

function captureCell(skipGround = true) {
  const { w, h } = gridSize();
  const groundWas = groundGroup.visible;
  if (skipGround) groundGroup.visible = false;
  renderer.render(scene, camera);
  if (skipGround) groundGroup.visible = groundWas;

  const sw = w * 4; const sh = h * 4;
  if (tmp.width !== sw) { tmp.width = sw; tmp.height = sh; }
  tmpCtx.clearRect(0, 0, sw, sh);
  tmpCtx.imageSmoothingEnabled = true;
  tmpCtx.drawImage(renderer.domElement, 0, 0, sw, sh);
  const sprite = spriteFromPixels(
    { data: tmpCtx.getImageData(0, 0, sw, sh).data, w: sw, h: sh },
    {
      grid: { w, h },
      fill: gridSize().fill,
      mode: quantPick.value,
      palette: PALETTE_RGB,
      ink: INK,
      dither: Number(ditherPick.value),
      outline: outlineBtn.getAttribute('aria-pressed') === 'true'
    }
  );
  if (!sprite) return null;
  cell.width = sprite.w; cell.height = sprite.h;
  cellCtx.putImageData(new ImageData(sprite.data, sprite.w, sprite.h), 0, 0);
  return sprite;
}

function blitGame() {
  if (!gameCtx || !cell.width) return;
  const zoom = 2;
  const w = cell.width * zoom;
  const h = cell.height * zoom;
  if (gameCanvas.width !== w || gameCanvas.height !== h) { gameCanvas.width = w; gameCanvas.height = h; }
  gameCtx.imageSmoothingEnabled = false;
  gameCtx.fillStyle = '#2a3a24';
  gameCtx.fillRect(0, 0, w, h);
  gameCtx.fillStyle = '#31432a';
  for (let i = 0; i < 26; i += 1) {
    const gx = (i * 61) % w;
    const gy = h - ((i * 37) % Math.round(h * 0.45)) - 6;
    gameCtx.fillRect(gx, gy, 4, 2);
  }
  gameCtx.fillStyle = 'rgba(8,12,8,.42)';
  gameCtx.beginPath();
  gameCtx.ellipse(w / 2, h - 8, Math.round(w * 0.16), 5, 0, 0, Math.PI * 2);
  gameCtx.fill();
  const scale = (30 * zoom) / cell.height;
  const dw = cell.width * scale;
  const dh = cell.height * scale;
  gameCtx.drawImage(cell, Math.round((w - dw) / 2), Math.round(h - 8 - dh + 4), dw, dh);
}

function blit(target, ctx, zoom) {
  if (!cell.width) return false;
  if (target.width !== cell.width * zoom) {
    target.width = cell.width * zoom;
    target.height = cell.height * zoom;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.fillStyle = '#16241c';
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.drawImage(cell, 0, 0, target.width, target.height);
  return true;
}

function redrawPixel() {
  const sprite = captureCell();
  if (sprite) {
    blit(pixCanvas, pixCtx, Math.max(2, Math.round(320 / sprite.w)));
    blitGame();
  }
  return Boolean(sprite);
}

function motionFor(name) {
  if (/Sprint|Jog/.test(name)) return 'run';
  if (/Walk/.test(name)) return 'walk';
  return 'idle';
}

let last = 0;
function loop(now) {
  const dt = clock ? clock.getDelta() : 0;
  if (mixer && playing && action) mixer.update(dt);
  if (controls) controls.update();
  if (renderer && now - last > 30) {
    last = now;
    if (redrawPixel()) {
      renderReference(playing ? now / 1000 : Number(framePick.value) / 8, motionFor(clipPick.value || 'Idle_Loop'));
    }
  }
  requestAnimationFrame(loop);
}

function stepToFrame() {
  if (!mixer || !action) return;
  const clip = action.getClip();
  const frames = Number(framePick.max) + 1;
  action.time = (Number(framePick.value) / Math.max(1, frames - 1)) * clip.duration * 0.98;
  mixer.update(0);
}

function setPlaying(next) {
  playing = next;
  playBtn.textContent = playing ? 'Пауза ❙❙' : 'Играть ▸';
  if (!playing) stepToFrame();
}

async function buildSheet() {
  const count = 6;
  const { w, h } = gridSize();
  sheetCanvas.width = w * count;
  sheetCanvas.height = h;
  sheetCtx.fillStyle = '#16241c';
  sheetCtx.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
  if (!mixer || !action) return;
  const clip = action.getClip();
  const wasPlaying = playing;
  playing = false;
  for (let i = 0; i < count; i += 1) {
    action.time = ((i + 0.5) / count) * clip.duration * 0.98;
    mixer.update(0);
    const captured = captureCell();
    if (captured) {
      sheetCtx.imageSmoothingEnabled = false;
      sheetCtx.drawImage(cell, i * w, 0, w, h);
      renderReference(((i + 0.5) / count) * (clip.duration * 0.98), motionFor(clip.name));
    }
  }
  playing = wasPlaying;
  say(`лист собран: ${count} × ${w}×${h}`);
}

function wire() {
  for (const btn of document.querySelectorAll('#charPick button')) {
    btn.addEventListener('click', async () => {
      for (const other of document.querySelectorAll('#charPick button')) other.setAttribute('aria-pressed', String(other === btn));
      await setCharacter(btn.dataset.char);
    });
  }
  clipPick.addEventListener('change', () => { applyClip(); stepToFrame(); });
  speedPick.addEventListener('input', () => { if (action) action.timeScale = Number(speedPick.value) / 100; });
  framePick.addEventListener('input', () => { setPlaying(false); stepToFrame(); });
  yawPick.addEventListener('input', () => {
    if (!model) return;
    model.rotation.y = THREE.MathUtils.degToRad(Number(yawPick.value));
    controls.target.set(0, 0.94, 0);
  });
  for (const el of [gridPick, quantPick, ditherPick]) el.addEventListener('change', redrawPixel);
  ditherPick.addEventListener('input', redrawPixel);
  outlineBtn.addEventListener('click', () => {
    outlineBtn.setAttribute('aria-pressed', outlineBtn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    redrawPixel();
  });
  playBtn.addEventListener('click', () => setPlaying(!playing));
  resetBtn.addEventListener('click', () => {
    camera.position.set(1.35, 1.42, 2.35);
    controls.target.set(0, 0.94, 0);
    controls.update();
  });
  window.addEventListener('resize', () => {
    if (!renderer) return;
    renderer.setSize(host.clientWidth || 420, host.clientHeight || 560, false);
    camera.aspect = 3 / 4;
    camera.updateProjectionMatrix();
  });
  sheetBtn.addEventListener('click', () => buildSheet());
  saveBtn.addEventListener('click', () => {
    if (!cell.width) return;
    const a = document.createElement('a');
    a.download = `quaternius-${clipPick.value || 'frame'}-${gridPick.value}.png`;
    a.href = cell.toDataURL('image/png');
    a.click();
  });
}

async function boot() {
  try {
    initThree();
  } catch (error) {
    say(`WebGL недоступен в этом браузере: ${error.message}`, true);
    return;
  }
  wire();
  try {
    await setCharacter('male');
    model.rotation.y = THREE.MathUtils.degToRad(Number(yawPick.value));
  } catch (error) {
    say(`не удалось загрузить пак: ${error.message}. Проверьте, что отдаются файлы из ${ASSETS}/`, true);
    return;
  }
  requestAnimationFrame(loop);
}

boot();
