/**
 * tools/pack-import.js — импорт CC0-паков в репозиторий без мегабайт мусора.
 *
 *   node tools/pack-import.js --src /tmp/mvk/glTF --size 64 \
 *        --out dev/character-style-lab/assets/quaternius/village \
 *        --models Overhang_Plaster_Long,Roof_RoundTiles_6x6,Prop_Chimney \
 *        --note "Quaternius, Medieval Village MegaKit (CC0), glTF-зеркало J-Ponzo/gltf-medieval-village-megakit"
 *
 * Зачем: песочница не имеет выхода в Dropbox/itch.io (исходящий трафик закрыт кроме
 * github/npm/pypi), поэтому паки приходят либо зеркалом с GitHub, либо руками
 * владельца. Дальше важны два факта:
 *   • в GitHub файл >25 МБ через веб-морду не грузится, >100 МБ не грузится никак;
 *   • для запекки спрайта нужна только baseColor-текстура, и та — размером с проп,
 *     а не 2048². Проп в игре 40–60 пикселей, поэтому 64×64 хватает с запасом.
 * Скрипт берёт из распакованного пака перечисленные модели, тащит .gltf+.bin и
 * урезает baseColor-текстуры до --size, усредняя блоки пикселей. Normal/ORM не
 * копируются: растеризатор (tools/raster3d.js) их не читает, а весят они больше
 * всего. На выходе — каталог, который можно закоммитить.
 */
import fs from "node:fs";
import path from "node:path";
import { loadPngFile } from "./png-decode.js";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return dflt;
    const v = argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
};

const SRC = String(flag("src", ""));
const OUT = String(flag("out", ""));
const SIZE = Number(flag("size", 64));
const MODELS = String(flag("models", "")).split(",").map(s => s.trim()).filter(Boolean);
const NOTE = String(flag("note", ""));
if (!SRC || !OUT || !MODELS.length) {
    console.error("нужны --src, --out и --models (список через запятую)");
    process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });

/** baseColor-текстуры, на которые ссылается материал модели (без normal/ORM). */
function baseColorImages(json) {
    const out = new Set();
    for (const mat of json.materials || []) {
        const idx = mat.pbrMetallicRoughness?.baseColorTexture?.index;
        if (idx === undefined) continue;
        const src = json.textures?.[idx]?.source;
        const uri = json.images?.[src]?.uri;
        if (uri) out.add(uri);
    }
    return [...out];
}

/** Понизить текстуру усреднением блоков: nearest-сэмплинг оставил бы «дырки». */
function shrinkPng(file, dst, size) {
    const img = loadPngFile(file);
    const sx = Math.max(1, Math.floor(img.width / size));
    const sy = Math.max(1, Math.floor(img.height / size));
    const w = Math.max(1, Math.round(img.width / sx)), h = Math.max(1, Math.round(img.height / sy));
    const cv = new ShimCanvas(w, h);
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            for (let j = 0; j < sy; j += 1) {
                for (let i = 0; i < sx; i += 1) {
                    const px = Math.min(img.width - 1, x * sx + i), py = Math.min(img.height - 1, y * sy + j);
                    const o = (py * img.width + px) * 4;
                    r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; a += img.data[o + 3]; n += 1;
                }
            }
            const o = (y * w + x) * 4;
            cv.data[o] = r / n; cv.data[o + 1] = g / n; cv.data[o + 2] = b / n; cv.data[o + 3] = a / n;
        }
    }
    fs.writeFileSync(dst, encodePNG(cv, [0, 0, 0]));
    return { from: `${img.width}×${img.height}`, to: `${w}×${h}`, bytes: fs.statSync(dst).size };
}

let copied = 0, textureBytes = 0, modelBytes = 0;
for (const name of MODELS) {
    const gltfFile = path.join(SRC, `${name}.gltf`);
    if (!fs.existsSync(gltfFile)) { console.log(`   (${name}: нет ${gltfFile} — пропуск)`); continue; }
    const json = JSON.parse(fs.readFileSync(gltfFile, "utf8"));
    fs.copyFileSync(gltfFile, path.join(OUT, `${name}.gltf`));
    const bin = json.buffers?.[0]?.uri || `${name}.bin`;
    if (fs.existsSync(path.join(SRC, bin))) {
        fs.copyFileSync(path.join(SRC, bin), path.join(OUT, bin));
        modelBytes += fs.statSync(path.join(OUT, bin)).size;
    }
    // URI с пробелами/слэшами из паков режем до имени файла: каталог плоский.
    for (const uri of baseColorImages(json)) {
        const stem = path.basename(decodeURIComponent(uri));
        if (/(Normal|Roughness|ORM)\.png$/i.test(stem)) continue;   // не читаем, не тащим
        const from = path.join(SRC, stem);
        if (!fs.existsSync(from)) continue;
        const res = shrinkPng(from, path.join(OUT, stem), SIZE);
        textureBytes += res.bytes;
        console.log(`   ${name}: ${stem} ${res.from} → ${res.to} (${(res.bytes / 1024).toFixed(0)} КБ)`);
    }
    copied += 1;
}

if (NOTE) {
    fs.writeFileSync(path.join(OUT, "README.md"), `# ${path.basename(OUT)} — импорт из пака\n\n`
        + `Источник: ${NOTE}\n\n`
        + `Скопировано \`node tools/pack-import.js\`: ${copied} моделей, `
        + `текстуры урезаны до ${SIZE}×${SIZE} (baseColor; normal/ORM не нужны растеризатору).\n\n`
        + `Формат: \`.gltf\` + \`.bin\` (не GLB) — \`tools/gltf-rig.js#readGltf\` читает его как есть.\n`);
    fs.writeFileSync(path.join(OUT, "LICENSE-CC0.txt"),
        "Creative Commons CC0 1.0 Universal (Public Domain Dedication).\n\n"
        + `${NOTE}\n\nПолный текст: https://creativecommons.org/publicdomain/zero/1.0/legalcode\n`);
}

console.log(`IMPORT: ${copied} моделей → ${OUT} · модели ${(modelBytes / 1048576).toFixed(2)} МБ, текстуры ${(textureBytes / 1048576).toFixed(2)} МБ`);
if (modelBytes + textureBytes > 6 * 1048576) console.log("   ⚠ больше 6 МБ — в GitHub такие ассеты кладывать не стоит, оставьте их внешними");
