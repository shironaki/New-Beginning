// Распаковка itch-пака персонажей в локальный (gitignored) каталог стенда + manifest для /gandalf-pack.html.
// Только node-встроенные модули: zip читается руками (store + deflate),依赖 нет.
// Запуск: node dev/character-style-lab/tools/unpack-gandalf.mjs <путь-к-zip> [каталог-назначения]
// Пример для текущего репозитория:
//   git cat-file blob $(git rev-list --objects --all | awk '/\.zip$/{print $1}' | head -1) > /tmp/pack.zip
//   node dev/character-style-lab/tools/unpack-gandalf.mjs /tmp/pack.zip
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const labRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = process.argv[2];
const outRoot = path.resolve(process.argv[3] || path.join(labRoot, 'gandalf-refs', 'pack'));
if (!zipPath || !fs.existsSync(zipPath)) {
  console.error('укажите путь к zip: node dev/character-style-lab/tools/unpack-gandalf.mjs <zip> [out]');
  process.exit(1);
}

const buf = fs.readFileSync(zipPath);
const CENTRAL = 0x02014b50;
const EOCCD = 0x06054b50;
let eocd = -1;
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i -= 1) {
  if (buf.readUInt32LE(i) === EOCCD) { eocd = i; break; }
}
if (eocd < 0) { console.error('не найден центральный каталог zip'); process.exit(1); }
const entries = buf.readUInt16LE(eocd + 10);
let off = buf.readUInt32LE(eocd + 16);

const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const rows = ['Idle', 'Walk', 'Run', 'Jump', 'Fall', 'Use/Attack', 'Death'];
const CELL = { w: 80, h: 64 };
const written = [];
const skipped = [];

for (let n = 0; n < entries; n += 1) {
  if (buf.readUInt32LE(off) !== CENTRAL) break;
  const method = buf.readUInt16LE(off + 10);
  const compSize = buf.readUInt32LE(off + 20);
  const nameLen = buf.readUInt16LE(off + 28);
  const extraLen = buf.readUInt16LE(off + 30);
  const commentLen = buf.readUInt16LE(off + 32);
  const localOff = buf.readUInt32LE(off + 42);
  const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
  off += 46 + nameLen + extraLen + commentLen;
  if (name.endsWith('/') || !/\.(png|txt)$/i.test(name)) continue;

  const lNameLen = buf.readUInt16LE(localOff + 26);
  const lExtraLen = buf.readUInt16LE(localOff + 28);
  const dataStart = localOff + 30 + lNameLen + lExtraLen;
  const raw = buf.subarray(dataStart, dataStart + compSize);
  let data;
  if (method === 0) data = raw;
  else if (method === 8) data = zlib.inflateRawSync(raw);
  else { skipped.push(`${name}: метод ${method}`); continue; }

  const rel = name.split('Pack/').pop();
  const parts = rel.split('/').filter(Boolean);
  const folder = parts.length > 1 ? parts[0] : '';
  const fileBase = path.basename(parts[parts.length - 1], path.extname(parts[parts.length - 1]));
  if (path.extname(rel).toLowerCase() === '.txt') {
    fs.mkdirSync(outRoot, { recursive: true });
    fs.writeFileSync(path.join(outRoot, 'READ ME.txt'), data);
    continue;
  }
  const lower = `${folder}/${parts[parts.length - 1]}`.toLowerCase();
  const kind = /skin color/.test(lower) ? 'base' : /clothing/.test(lower) ? 'clothing' : /hair/.test(lower) ? 'hair' : /hand/.test(lower) ? 'hand' : 'other';
  const leaf = path.basename(parts[parts.length - 1]).toLowerCase();
  const sex = /^female/.test(leaf) || /female/.test(folder.toLowerCase()) ? 'female' : 'male';
  const dir = path.join(outRoot, kind, sex);
  fs.mkdirSync(dir, { recursive: true });
  const outName = `${slug(fileBase)}.png`;
  fs.writeFileSync(path.join(dir, outName), data);
  written.push({
    kind, sex,
    name: fileBase.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    path: path.join(kind, sex, outName).split(path.sep).join('/'),
    bytes: data.length
  });
}

const manifest = {
  cell: CELL, cols: Math.round(800 / CELL.w), rows,
  framesPerRow: [5, 8, 8, 4, 4, 6, 10],
  fpsPerRow: [6, 10, 14, 9, 9, 12, 7],
  generatedBy: 'dev/character-style-lab/tools/unpack-gandalf.mjs',
  assets: written.sort((a, b) => (a.kind + a.sex + a.path).localeCompare(b.kind + b.sex + b.path))
};
fs.writeFileSync(path.join(outRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`РАСПАКОВАНО: ${written.length} листов → ${path.relative(process.cwd(), outRoot)}/, манифест ${manifest.assets.length} записей`);
if (skipped.length) console.log(`пропущено: ${skipped.length} (${skipped.slice(0, 3).join('; ')})`);
