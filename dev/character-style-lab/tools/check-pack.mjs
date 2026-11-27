// Проверка локальной распаковки itch-пака (тот, что в gandalf-refs/pack/) — без зависимостей и без PIL:
// читает manifest.json, проверяет, что каждый лист на месте и что его IHDR-размер
// совпадает с ожидаемой сеткой рядов. Запуск: node dev/character-style-lab/tools/check-pack.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const labRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packDir = path.resolve(process.argv[2] || path.join(labRoot, 'gandalf-refs', 'pack'));
const manifestPath = path.join(packDir, 'manifest.json');

function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

if (!fs.existsSync(manifestPath)) {
  console.error(`Нет ${path.relative(process.cwd(), manifestPath)}. Распакуйте пак:
  git cat-file blob $(git rev-list --objects --all | awk '/\\.zip$/{print $1}' | head -1) > /tmp/pack.zip
  node dev/character-style-lab/tools/unpack-gandalf.mjs /tmp/pack.zip`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const cell = manifest.cell || { w: 80, h: 64 };
const expectedW = cell.w * (manifest.cols || 10);
const expectedH = cell.h * (manifest.framesPerRow || []).length;
const problems = [];
let ok = 0;
const kinds = {};

for (const asset of manifest.assets || []) {
  const file = path.join(packDir, asset.path);
  kinds[asset.kind] = (kinds[asset.kind] || 0) + 1;
  if (!fs.existsSync(file)) { problems.push(`${asset.path}: файла нет`); continue; }
  if (asset.kind === 'other') problems.push(`${asset.path}: не распознан слой`);
  const size = pngSize(file);
  if (!size) { problems.push(`${asset.path}: не PNG`); continue; }
  if (size.w !== expectedW || size.h !== expectedH) {
    problems.push(`${asset.path}: ${size.w}×${size.h} ≠ ожидаемая сетка ${expectedW}×${expectedH}`);
  }
  if (size.bytes < 512) problems.push(`${asset.path}: подозрительно маленький (${size.bytes} B)`);
  if (size.bytes !== asset.bytes) problems.push(`${asset.path}: размер ${size.bytes} ≠ манифест ${asset.bytes}`);
  ok += 1;
}

if (!kinds.base) problems.push('нет ни одного листа тела (base)');
const rows = (manifest.framesPerRow || []);
if (rows.length !== 7 || rows.join() !== [5, 8, 8, 4, 4, 6, 10].join()) {
  problems.push(`framesPerRow = ${rows.join('/')} — ожидали 5/8/8/4/4/6/10`);
}

if (problems.length) {
  console.error(`PACK FAIL: ${ok} листов ok, проблем ${problems.length}\n- ${problems.slice(0, 12).join('\n- ')}`);
  process.exit(1);
}
console.log(`PACK OK: ${ok} листов ${expectedW}×${expectedH} (сетка ${cell.w}×${cell.h}, ряды ${rows.join('/')}), слои: ${Object.entries(kinds).map(([k, v]) => `${k}=${v}`).join(', ')}`);
