// Проверка целостности 3D-ассетов стенда без браузера и без WebGL:
// обходит gltf/glb, проверяет, что все uri существуют на диске, что bin/glb-чанки
// соответствуют заголовкам, и что имена костей анимаций пересекаются со скелетом модели.
// Запуск: node dev/character-style-lab/tools/verify-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const labRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(labRoot, 'assets', 'quaternius');
const problems = [];
let checked = 0;

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function resolveUri(base, uri) {
  if (!uri) return null;
  if (uri.startsWith('data:')) return 'inline';
  return path.resolve(base, uri);
}

function accessorsValid(json, bufLen, label) {
  const views = json.bufferViews || [];
  for (const [i, acc] of (json.accessors || []).entries()) {
    const view = views[acc.bufferView];
    if (!view) { problems.push(`${label}: accessor ${i} без bufferView`); continue; }
    const size = (acc.count || 0) * itemSize(acc) * componentBytes(acc);
    const need = (view.byteOffset || 0) + (acc.byteOffset || 0) + size;
    if (need > bufLen) problems.push(`${label}: accessor ${i} вылезает за буфер (${need} > ${bufLen})`);
    checked += 1;
  }
}
function itemSize(acc) {
  return { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type] || 1;
}
function componentBytes(acc) {
  return { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType] || 4;
}

let bones = new Set();
for (const who of ['Male', 'Female']) {
  const name = `Superhero_${who}_FullBody`;
  const file = path.join(dir, 'char', `${name}.gltf`);
  if (!fs.existsSync(file)) { problems.push(`нет файла ${file}`); continue; }
  const json = readJson(file);
  const bufUri = (json.buffers || [])[0]?.uri;
  const bufPath = resolveUri(path.dirname(file), bufUri);
  if (bufUri && !fs.existsSync(bufPath)) problems.push(`${name}: нет буфера ${bufUri}`);
  const bufLen = bufUri && fs.existsSync(bufPath) ? fs.statSync(bufPath).size : (json.buffers[0].byteLength || 0);
  if (bufUri && fs.statSync(bufPath).size !== json.buffers[0].byteLength) {
    problems.push(`${name}: размер буфера ${fs.statSync(bufPath).size} ≠ заявленный ${json.buffers[0].byteLength}`);
  }
  accessorsValid(json, bufLen, name);
  for (const img of json.images || []) {
    const p = resolveUri(path.dirname(file), img.uri);
    if (!p || !fs.existsSync(p)) problems.push(`${name}: отсутствует текстура ${img.uri}`);
    else if (fs.statSync(p).size < 512) problems.push(`${name}: текстура ${img.uri} подозрительно маленькая`);
    checked += 1;
  }
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives) {
      // Индекс аксессора может быть 0 — проверять именно на undefined.
      if (prim.attributes?.POSITION === undefined) problems.push(`${name}: примитив «${mesh.name}» без POSITION`);
      if (prim.attributes?.TEXCOORD_0 === undefined) problems.push(`${name}: примитив «${mesh.name}» без UV`);
      if (prim.attributes?.JOINTS_0 === undefined && prim.attributes?.NORMAL !== undefined && json.skins?.length) {
        problems.push(`${name}: примитив «${mesh.name}» без весов костей при наличии скелета`);
      }
      checked += 1;
    }
  }
  const skin = (json.skins || [])[0];
  if (!skin) problems.push(`${name}: нет skin`);
  else {
    const joints = skin.joints.map(i => json.nodes[i]?.name).filter(Boolean);
    if (joints.length !== skin.joints.length) problems.push(`${name}: у части костей нет имён — ретаргет по имени невозможен`);
    if (new Set(joints).size !== joints.length) problems.push(`${name}: дубли имён костей`);
    if (who === 'Male') bones = new Set(joints);
  }
}

const animFile = path.join(dir, 'anims.glb');
if (!fs.existsSync(animFile)) problems.push('нет anims.glb');
else {
  const buf = fs.readFileSync(animFile);
  const [magic, version, length] = Array.from(new Uint32Array(buf.buffer, buf.byteOffset, 3));
  if (magic !== 0x46546c67) problems.push('anims.glb: плохая сигнатура glTF');
  if (version !== 2) problems.push(`anims.glb: версия ${version}`);
  if (length !== buf.length) problems.push(`anims.glb: длина чанка ${length} ≠ файл ${buf.length}`);
  let off = 12;
  let json = null;
  let binLen = 0;
  while (off + 8 <= buf.length) {
    const chunkLen = buf.readUInt32LE(off);
    const chunkType = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + chunkLen);
    if (chunkType === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else if (chunkType === 0x004e4942) binLen = chunkLen;
    off += 8 + chunkLen;
  }
  if (!json) problems.push('anims.glb: нет JSON-чанка');
  else {
    if (json.buffers?.[0]?.byteLength !== binLen) problems.push(`anims.glb: буфер ${json.buffers?.[0]?.byteLength} ≠ чанк ${binLen}`);
    accessorsValid(json, binLen, 'anims.glb');
    const names = (json.animations || []).map(c => c.name);
    if (names.length < 20) problems.push(`anims.glb: всего ${names.length} клипов`);
    const targets = new Set();
    for (const clip of json.animations) {
      for (const ch of clip.channels) targets.add(json.nodes[ch.target.node]?.name);
      if (!clip.samplers?.length) problems.push(`anims.glb: клип «${clip.name}» без сэмплеров`);
      checked += 1;
    }
    const missing = [...targets].filter(n => n && !bones.has(n));
    if (missing.length) problems.push(`anims.glb: ${missing.length} костей клипов нет в скелете: ${missing.slice(0, 6).join(', ')}`);
    console.log(`клипы: ${names.length}, костей в треках: ${targets.size}, все присутствуют в скелете: ${missing.length === 0}`);
  }
}

const total = (function size(d) {
  return fs.readdirSync(d, { withFileTypes: true }).reduce((sum, e) => {
    const p = path.join(d, e.name);
    return sum + (e.isDirectory() ? size(p) : fs.statSync(p).size);
  }, 0);
})(dir);

if (problems.length) {
  console.error(`ASSETS FAIL (${checked} проверок):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`ASSETS OK: ${checked} проверок, ${(total / 1048576).toFixed(2)} MB в assets/quaternius, CC0`);
