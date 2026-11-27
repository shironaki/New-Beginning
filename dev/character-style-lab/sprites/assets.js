export const SPRITE_W = 48;
export const SPRITE_H = 64;
export const DIRECTIONS = ['down', 'left', 'up', 'right'];
export const FRAME_COUNT = 4;

const PALETTES = {
  trail: {
    ink: '#292923', skin: '#bd825e', skinLight: '#d39a70', skinShade: '#915d46',
    hair: '#302923', hairLight: '#594434', linen: '#c5ad84', linenLight: '#dfcca2',
    trousers: '#53625c', trouserLight: '#748075', coat: '#80523c', coatLight: '#aa7650',
    scarf: '#d8c9a6', scarfShade: '#a49678', boots: '#684631', bootsLight: '#94714c',
    leather: '#76563a', leatherLight: '#a17b4a', metal: '#bac2b8', metalLight: '#e0dfc8',
    cloak: '#405646', cloakLight: '#637956', flame: '#f4bd54', flameCore: '#fff1a7'
  },
  rain: {
    ink: '#252c2a', skin: '#b77d62', skinLight: '#d09370', skinShade: '#835949',
    hair: '#302c2b', hairLight: '#57504a', linen: '#8b9a89', linenLight: '#b1b99d',
    trousers: '#3f5357', trouserLight: '#607579', coat: '#465b4c', coatLight: '#718168',
    scarf: '#687e78', scarfShade: '#4b605c', boots: '#483c35', bootsLight: '#79614b',
    leather: '#514b39', leatherLight: '#83714d', metal: '#acb8b1', metalLight: '#d4ddd0',
    cloak: '#314b43', cloakLight: '#527367', flame: '#e9a94b', flameCore: '#ffedaa'
  }
};

const assetCache = new Map();
const atlasCache = new Map();
const phaseTable = [0, 1, 0, -1];

function makeCanvas(width = SPRITE_W, height = SPRITE_H) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function block(ctx, x, y, width, height, color, outline = '#282a24') {
  ctx.fillStyle = outline;
  ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function pixelLine(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function colors(preset) { return PALETTES[preset] ?? PALETTES.trail; }

function phaseFor(frame, motion) {
  if (motion === 'idle') return 0;
  return phaseTable[frame % FRAME_COUNT] * (motion === 'run' ? 2 : 1);
}

function facing(ctx, direction, draw) {
  ctx.save();
  if (direction === 'left' || direction === 'right') {
    ctx.translate(24, 0); ctx.scale(0.78, 1); ctx.translate(-24, 0);
  }
  if (direction === 'right') { ctx.translate(SPRITE_W, 0); ctx.scale(-1, 1); }
  draw();
  ctx.restore();
}

function bodyParts(ctx, p, direction, motion, frame, leadHand = 'right') {
  const back = direction === 'up';
  const side = direction === 'left' || direction === 'right';
  const phase = phaseFor(frame, motion);
  const bob = motion === 'idle' ? 0 : (frame === 1 || frame === 3 ? 1 : 0);
  const leftLegX = 18 - phase;
  const rightLegX = 26 + phase;
  const leftLegY = 37 + (phase < 0 ? Math.min(1, -phase) : 0);
  const rightLegY = 37 + (phase > 0 ? Math.min(1, phase) : 0);
  const rightArmSwing = phase * (leadHand === 'right' ? 1.4 : 0.7);
  const leftArmSwing = -phase * (leadHand === 'left' ? 1.4 : 0.7);
  const viewerLeftSwing = back ? leftArmSwing : rightArmSwing;
  const viewerRightSwing = back ? rightArmSwing : leftArmSwing;

  block(ctx, leftLegX, leftLegY, 5, 16, p.skin);
  block(ctx, rightLegX, rightLegY, 5, 16, p.skin);
  block(ctx, 18, 33 + bob, 12, 5, p.skinShade);
  block(ctx, 17, 34 + bob, 14, 3, p.skin);
  block(ctx, 15, 20 + bob, 18, 16, p.skin);
  block(ctx, 12, 21 + bob + viewerLeftSwing, 5, 14, p.skin);
  block(ctx, 31, 21 + bob + viewerRightSwing, 5, 14, p.skin);
  block(ctx, 13, 34 + bob + viewerLeftSwing, 4, 4, p.skinLight);
  block(ctx, 31, 34 + bob + viewerRightSwing, 4, 4, p.skinLight);
  block(ctx, 16, 18 + bob, 16, 4, p.skinLight);
  block(ctx, 21, 15 + bob, 6, 6, p.skinShade);

  if (side) {
    pixelLine(ctx, 16, 39, 15, 2, '#9d6a50');
    pixelLine(ctx, 20, 25 + bob, 8, 1, '#d6a07a');
  } else {
    pixelLine(ctx, 18, 23 + bob, 4, 1, '#daa27a');
    pixelLine(ctx, 27, 23 + bob, 3, 1, '#daa27a');
    pixelLine(ctx, 21, 29 + bob, 6, 1, '#9e6b50');
  }

  if (back) {
    block(ctx, 17, 3, 14, 15, p.hair);
    pixelLine(ctx, 19, 5, 9, 2, p.hairLight);
    pixelLine(ctx, 19, 13, 1, 3, '#594536');
    pixelLine(ctx, 28, 13, 1, 3, '#594536');
  } else {
    block(ctx, 18, 4, 13, 13, p.skin);
    pixelLine(ctx, 17, 3, 15, 6, p.hair);
    pixelLine(ctx, 18, 8, 3, 3, p.hair);
    pixelLine(ctx, 29, 8, 3, 3, p.hair);
    pixelLine(ctx, 16, 9, 2, 3, p.skinShade);
    pixelLine(ctx, 31, 9, 2, 3, p.skinShade);
    pixelLine(ctx, 20, 10, 2, 1, p.ink);
    pixelLine(ctx, 27, 10, 2, 1, p.ink);
    pixelLine(ctx, 24, 11, 1, 2, p.skinShade);
    pixelLine(ctx, 22, 14, 5, 1, '#79513c');
  }
}

function trouserParts(ctx, p, motion, frame) {
  const phase = phaseFor(frame, motion);
  block(ctx, 17, 34, 14, 5, p.trousers);
  block(ctx, 17 - phase, 37, 7, 16, p.trousers);
  block(ctx, 25 + phase, 37, 7, 16, p.trousers);
  pixelLine(ctx, 18 - phase, 43, 4, 1, p.trouserLight);
  pixelLine(ctx, 26 + phase, 43, 4, 1, p.trouserLight);
  pixelLine(ctx, 23, 36, 1, 9, '#343c38');
  pixelLine(ctx, 18, 35, 12, 1, '#9d8a62');
}

function shirtParts(ctx, p, motion, frame) {
  const phase = phaseFor(frame, motion);
  block(ctx, 14, 20, 20, 16, p.linen);
  block(ctx, 11, 21 + phase, 7, 13, p.linen);
  block(ctx, 30, 21 - phase, 7, 13, p.linen);
  pixelLine(ctx, 21, 21, 6, 2, p.linenLight);
  pixelLine(ctx, 23, 23, 2, 11, '#9c8968');
  pixelLine(ctx, 24, 25, 1, 7, p.ink);
  pixelLine(ctx, 20, 20, 8, 1, '#eee0bd');
}

function coatParts(ctx, p, motion, frame) {
  const phase = phaseFor(frame, motion);
  block(ctx, 13, 20, 22, 17, p.coat);
  block(ctx, 10, 21 + phase, 8, 13, p.coat);
  block(ctx, 30, 21 - phase, 8, 13, p.coat);
  pixelLine(ctx, 15, 23, 3, 7, p.coatLight);
  pixelLine(ctx, 31, 23, 3, 7, p.coatLight);
  pixelLine(ctx, 23, 23, 2, 13, '#c4a16c');
  pixelLine(ctx, 21, 21, 3, 3, p.coatLight);
  pixelLine(ctx, 26, 21, 3, 3, '#392f28');
  for (const y of [26, 29, 32]) pixelLine(ctx, 26, y, 1, 1, '#ebd58e');
}

function scarfParts(ctx, p) {
  block(ctx, 20, 17, 9, 4, p.scarf);
  pixelLine(ctx, 21, 18, 7, 1, '#f1e5c8');
  block(ctx, 27, 20, 3, 8, p.scarf);
  pixelLine(ctx, 28, 23, 1, 4, p.scarfShade);
}

function cloakParts(ctx, p, back) {
  if (back) {
    block(ctx, 14, 19, 20, 30, p.cloak);
    pixelLine(ctx, 16, 46, 16, 2, p.cloakLight);
    pixelLine(ctx, 23, 21, 1, 25, p.cloakLight);
  } else {
    block(ctx, 12, 22, 5, 25, p.cloak);
    block(ctx, 31, 22, 5, 25, p.cloak);
    pixelLine(ctx, 13, 45, 5, 2, p.cloakLight);
    pixelLine(ctx, 31, 45, 5, 2, p.cloakLight);
  }
}

function packParts(ctx, p, direction, front) {
  const back = direction === 'up';
  if (front && back) return;
  if (front) {
    pixelLine(ctx, 17, 20, 2, 13, p.leatherLight);
    pixelLine(ctx, 29, 20, 2, 13, p.leatherLight);
    pixelLine(ctx, 17, 24, 3, 2, '#dec28a');
    pixelLine(ctx, 28, 24, 3, 2, '#dec28a');
    return;
  }
  if (back) {
    block(ctx, 17, 19, 14, 16, p.leather);
    pixelLine(ctx, 19, 22, 10, 2, p.leatherLight);
    pixelLine(ctx, 19, 29, 10, 1, '#b49560');
    block(ctx, 22, 27, 4, 3, '#c5a971');
    pixelLine(ctx, 18, 20, 12, 2, '#9c784e');
  } else if (direction === 'left' || direction === 'right') {
    block(ctx, 29, 23, 9, 14, p.leather);
    pixelLine(ctx, 30, 26, 7, 2, p.leatherLight);
    pixelLine(ctx, 31, 33, 5, 1, '#b49560');
  } else {
    block(ctx, 19, 22, 10, 12, p.leather);
    pixelLine(ctx, 20, 24, 8, 2, p.leatherLight);
  }
}

function bootParts(ctx, p, motion, frame) {
  const phase = phaseFor(frame, motion);
  block(ctx, 15 - phase, 51, 10, 7, p.boots);
  block(ctx, 24 + phase, 51, 11, 7, p.boots);
  pixelLine(ctx, 16 - phase, 53, 7, 1, p.bootsLight);
  pixelLine(ctx, 25 + phase, 53, 8, 1, p.bootsLight);
  pixelLine(ctx, 15 - phase, 57, 11, 1, '#302b24');
  pixelLine(ctx, 24 + phase, 57, 12, 1, '#302b24');
}

function heldParts(ctx, p, direction, frame, state) {
  const back = direction === 'up';
  const phase = phaseFor(frame, state.motion);
  const handAt = {
    right: { x: back ? 34 : 14, y: 37 + phase },
    left: { x: back ? 14 : 34, y: 37 - phase }
  };
  for (const role of ['right', 'left']) {
    const item = state.items?.[role] ?? 'none';
    if (!item || item === 'none') continue;
    const { x, y } = handAt[role];
    if (item === 'axe') {
      pixelLine(ctx, x, y - 10, 2, 13, '#76502f');
      pixelLine(ctx, x - 3, y - 11, 8, 3, p.metal);
      pixelLine(ctx, x - 3, y - 11, 2, 3, p.metalLight);
    } else if (item === 'torch') {
      pixelLine(ctx, x, y - 9, 2, 12, '#8f633a');
      pixelLine(ctx, x - 1, y - 13, 4, 4, p.flame);
      pixelLine(ctx, x, y - 12, 2, 2, p.flameCore);
    }
    block(ctx, x - 1, y - 1, 4, 4, p.skinLight);
  }
}

const PAINTERS = {
  body: bodyParts,
  trousers: trouserParts,
  shirt: shirtParts,
  coat: coatParts,
  scarf: scarfParts,
  cloak: cloakParts,
  boots: bootParts,
  packBack: packParts,
  packFront: packParts,
  held: heldParts
};

export function getLayerSprite(layer, direction, frame, state, preset = 'trail') {
  const key = `${layer}|${direction}|${frame}|${state.motion}|${state.leadHand}|${preset}|${state.items?.right}|${state.items?.left}`;
  if (assetCache.has(key)) return assetCache.get(key);
  const sprite = makeCanvas();
  const ctx = sprite.getContext('2d');
  const painter = PAINTERS[layer];
  if (painter) {
    facing(ctx, direction, () => {
      const p = colors(preset);
      if (layer === 'body') painter(ctx, p, direction, state.motion, frame, state.leadHand);
      else if (layer === 'trousers' || layer === 'boots' || layer === 'shirt' || layer === 'coat') painter(ctx, p, state.motion, frame);
      else if (layer === 'cloak') painter(ctx, p, direction === 'up');
      else if (layer === 'packBack') painter(ctx, p, direction, false);
      else if (layer === 'packFront') painter(ctx, p, direction, true);
      else if (layer === 'held') painter(ctx, p, direction, frame, state);
      else painter(ctx, p);
    });
  }
  assetCache.set(key, sprite);
  return sprite;
}

export function drawSpriteLayers(ctx, state, frame, direction, preset = 'trail') {
  const order = direction === 'up'
    ? ['body', 'trousers', 'boots', 'shirt', 'coat', 'scarf', 'cloak', 'packBack', 'held']
    : ['cloak', 'packBack', 'body', 'trousers', 'boots', 'shirt', 'coat', 'scarf', 'packFront', 'held'];
  for (const layer of order) {
    const visible = layer === 'body' || layer === 'held'
      ? layer === 'body' || Boolean(state.items?.right !== 'none' || state.items?.left !== 'none')
      : layer === 'cloak' ? Boolean(state.garments.cloak)
      : layer === 'packBack' || layer === 'packFront' ? Boolean(state.garments.pack)
      : layer === 'trousers' || layer === 'shirt' || layer === 'coat' || layer === 'scarf' || layer === 'boots'
        ? Boolean(state.garments[layer])
        : false;
    if (visible) ctx.drawImage(getLayerSprite(layer, direction, frame, state, preset), 0, 0);
  }
}

export function getAtlas(preset) {
  if (atlasCache.has(preset)) return atlasCache.get(preset);
  const atlas = makeCanvas(SPRITE_W * FRAME_COUNT, SPRITE_H * DIRECTIONS.length);
  const ctx = atlas.getContext('2d');
  const presetState = preset === 'rain'
    ? { motion: 'walk', garments: { shirt: true, trousers: true, coat: false, scarf: true, boots: true, cloak: true, pack: true }, items: { right: 'axe', left: 'torch' } }
    : { motion: 'walk', garments: { shirt: true, trousers: true, coat: true, scarf: true, boots: true, cloak: false, pack: true }, items: { right: 'axe', left: 'torch' } };
  DIRECTIONS.forEach((direction, row) => {
    for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
      ctx.save(); ctx.translate(frame * SPRITE_W, row * SPRITE_H);
      drawSpriteLayers(ctx, presetState, frame, direction, preset);
      ctx.restore();
    }
  });
  atlasCache.set(preset, atlas);
  return atlas;
}

export function presetLabel(preset) {
  return preset === 'rain' ? 'дождевой' : 'дорожный';
}

export function drawWetMarks(ctx, wetness, garments, direction) {
  if (wetness < 0.08) return;
  facing(ctx, direction, () => {
    ctx.save();
    ctx.globalAlpha = Math.min(0.36, wetness * 0.4);
    ctx.fillStyle = '#77b7c6';
    if (garments.shirt || garments.coat) {
      ctx.fillRect(21, 24, 1, 6); ctx.fillRect(28, 26, 1, 5);
      ctx.fillStyle = '#d3f0e9'; ctx.fillRect(23, 28, 1, 3);
    }
    if (garments.trousers) {
      ctx.fillStyle = '#6a9faf'; ctx.fillRect(19, 41, 1, 6); ctx.fillRect(27, 44, 1, 5);
    }
    if (garments.cloak) {
      ctx.fillStyle = '#8ec5cb'; ctx.fillRect(15, 32, 1, 7); ctx.fillRect(32, 36, 1, 6);
    }
    ctx.restore();
  });
}

// Small opaque pixel parts used by the cutout rig. The outfit tint is baked
// into each segment asset; joints only choose and rotate the relevant sprite.
const partCache = new Map();
export function getCutoutPart(kind, preset = 'trail') {
  const key = `${kind}|${preset}`;
  if (partCache.has(key)) return partCache.get(key);
  const p = colors(preset);
  const definitions = {
    armSkin: { width: 7, height: 12, fill: p.skin, light: p.skinLight },
    armShirt: { width: 8, height: 12, fill: p.linen, light: p.linenLight },
    armCoat: { width: 9, height: 12, fill: p.coat, light: p.coatLight },
    legSkin: { width: 8, height: 15, fill: p.skin, light: p.skinLight },
    legPants: { width: 9, height: 15, fill: p.trousers, light: p.trouserLight },
    boot: { width: 12, height: 8, fill: p.boots, light: p.bootsLight }
  };
  const def = definitions[kind];
  if (!def) return null;
  const asset = makeCanvas(def.width, def.height);
  const ctx = asset.getContext('2d');
  block(ctx, 2, 1, def.width - 4, def.height - 2, def.fill);
  pixelLine(ctx, 3, 3, 1, Math.max(3, def.height - 6), def.light);
  pixelLine(ctx, 2, def.height - 2, def.width - 4, 1, '#33332b');
  partCache.set(key, asset);
  return asset;
}

export function getPalette(preset = 'trail') { return colors(preset); }
