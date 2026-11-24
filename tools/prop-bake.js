/**
 * tools/prop-bake.js — запекка пропов мира из настоящих 3D-моделей (CC0).
 *
 *   node tools/prop-bake.js --sheet                 # лист: current vs 3D, .artifacts/prop-bake.png
 *   node tools/prop-bake.js --emit                  # + js/render/propsprites.js для игры
 *   node tools/prop-bake.js --emit /tmp/x.js --ppu 4.8    # путь и плотность пикселя
 *   node tools/prop-bake.js --sheet --yaw 1.57      # повернуть камеру (другой ракурс)
 *
 * Откуда модели: dev/character-style-lab/assets/kenney — Kenney «Nature Kit» через
 * Dallolz/moorfall-assets (LICENSE-CC0.txt рядом, CC0 1.0). Файлы лежат в репозитории,
 * чтобы проп можно было перепечь, а не перерисовать на глаз: 250 КБ на весь набор.
 *
 * Зачем это нужно: мир нарисован процедурно (js/render/tilesart.js, 3500 строк
 * кривых), и у каждого пропа свой силуэт, который никто не рисовал в 3D. Пока
 * герой — запечённый риг, деревья и камни выглядят чужеродно: у них другой свет,
 * другой вес и нет оснований, по которым они стоят на склоне. Пайплайн тот же,
 * что у героя: растеризатор (tools/raster3d.js) → фиксированная сетка → квантизация
 * в 16 цветов → RLE. Свет берётся из того же DEFAULT_LIGHT, что и у героя, так что
 * проп и персонаж затенены одной и той же лампой.
 *
 * Что здесь СОЗНАТЕЛЬНО не сделано:
 *   • пока нет 4 ракурсов на проп — в игре пропы billboarding'ом (см. paintProp),
 *     лист показывает один; ракурсы включаются `--dirs` и дают ×4 к объёму;
 *   • состояние «обрубили» (hits) — это отдельный меш (пень от дерева), его в
 *     таблице ещё нет: для него нужны model_felled/model_stump-пары из пака;
 *   • зима/снег и ветер не пекутся: их красит рантайм (оттенок + наклон), как и
 *     у героя — иначе каждый сезон означал бы перепечку всего мира.
 */
import fs from "node:fs";
import path from "node:path";
import { readGlb, readMesh, materialInfo } from "./gltf-rig.js";
import { makeFrame, cameraBasis, renderFrame } from "./raster3d.js";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
import { paintProp, setSun, propHeight } from "../js/render/tilesart.js";

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return dflt;
    const v = argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
};
const num = (name, dflt) => {
    const v = flag(name, null);
    return v === null || v === true ? dflt : Number(v);
};
const ASSETS = path.resolve("dev/character-style-lab/assets/kenney");
const PX_PER_UNIT = num("ppu", 2.4);                                   // как у героя
const PITCH = num("pitch", 0.2);
const YAW = num("yaw", 0);
const COLORS = num("colors", 15);
const OUT = String(flag("sheet", null) === null ? ".artifacts/prop-bake.png" : (flag("out") || ".artifacts/prop-bake.png"));

/**
 * kind пропа → файл модели и высота в единицах мира. Высоты взяты не с потолка:
 * `propHeight(kind, 1)` в tilesart уже задаёт, насколько пропа быть, и печём ровно
 * под него — иначе проп встанет в другую сетку коллизий и «утонет» в земле.
 */
const PROP_MODEL = {
    rock: "rock_largeA.glb",
    ore_rock: "rock_tallB.glb",
    scree: "stone_tallD.glb",
    beach_pebbles: "stone_tallB.glb",
    log: "log.glb",
    driftwood: "log_large.glb",
    firewood: "log.glb",
    burnt_stump: "stump_old.glb",
    bush: "plant_bushDetailed.glb",
    mushroom_patch: "mushroom_redGroup.glb",
    pine: "tree_pineTallA.glb",
    spruce: "tree_pineTallB.glb",
    tree_pine: "tree_pineTallD.glb",
    dead_tree: "tree_thin_dark.glb",
    ancient_oak: "tree_simple_dark.glb"
};
const KINDS = String(flag("kinds", null) || Object.keys(PROP_MODEL)).split(",");

/* ----------------------------- растеризация ----------------------------- */

/**
 * Пак Kenney перекрашивается на рантайме: в GLB «grass» = бирюза (0.17,0.85,0.72),
 * «woodBarkDark» = лосось. Это не бапк — это заготовка под краску, и в moorfall
 * цвета подставляет движок. Мы делаем то же самое, только один раз при запекке:
 * имя материала → цвет мира. Множитель по яркости сохраняет разницу между
 * «тёмной хвоё» и «светлой листвой», которая в паке сидит в baseColorFactor.
 */
const MATERIAL_TINT = [
    [/leaf|needle|pine|bush|grass|foliage|plant|reed|fern/i, "#4c6b45"],
    [/moss|lichen/i, "#5f6f43"],
    [/bark|wood|trunk|branch|stump|log|root/i, "#6a4e33"],
    [/stone|rock|boulder|cliff|pebble|flint|ore|metal/i, "#7e7c76"],
    [/snow|ice/i, "#cfd8da"],
    [/red|berry|mushroom|toadstool|cap/i, "#9c5140"],
    [/tan|sand|dirt|soil|ground|stem|_default/i, "#a3937a"]
];
const lumOf = (rgb) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
function tintFactor(name, factor) {
    const hit = MATERIAL_TINT.find(([re]) => re.test(name || ""));
    const l = Math.max(0.35, Math.min(1.25, lumOf(factor) / 0.62));
    if (!hit) return [factor[0] * l, factor[1] * l, factor[2] * l, factor[3] ?? 1];
    const hex = hit[1].replace("#", "");
    const base = [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];
    return [base[0] * l, base[1] * l, base[2] * l, factor[3] ?? 1];
}

/**
 * Модель → один кадр. Нормалей у low-poly пака нет (или они сглаженные), а нам
 * нужен именно гранёный свет: нормаль считаем по грани и пишем каждому из трёх
 * вершин, индексацию разворачиваем — растеризатор тогда не интерполирует shading
 * между гранями и низкая полигонажность остаётся видимой.
 */
function bakeKind(kind) {
    const file = PROP_MODEL[kind];
    if (!file) throw new Error(`для «${kind}» нет модели в PROP_MODEL`);
    const full = path.join(ASSETS, file);
    if (!fs.existsSync(full)) throw new Error(`нет файла ${full} — распакуйте пак (см. README в assets/kenney)`);
    const rig = readGlb(full);
    const meshes = [];
    for (let m = 0; m < (rig.json.meshes?.length || 0); m += 1) {
        for (const prim of readMesh(rig, m)) meshes.push(prim);
    }
    if (!meshes.length) throw new Error(`${file}: ни одного примитива`);
    const height = propHeight(kind, 1) || 8;                      // единиц мира
    const drawables = meshes.map((prim) => {
        const count = prim.count;
        let positions = prim.positions, normals = prim.normals, used = count;
        const index = prim.indices;
        if (index) {                                              // разворачиваем индексы
            positions = new Float32Array(index.length * 3);
            for (let i = 0; i < index.length; i += 1) {
                const v = index[i] * 3;
                positions[i * 3] = prim.positions[v]; positions[i * 3 + 1] = prim.positions[v + 1]; positions[i * 3 + 2] = prim.positions[v + 2];
            }
            used = index.length;
        }
        normals = new Float32Array(used * 3);                     // плоские нормали по граням
        for (let t = 0; t + 2 < used; t += 3) {
            const a = t * 3, b = a + 3, c = a + 6;
            const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
            const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const ln = Math.hypot(nx, ny, nz) || 1;
            nx /= ln; ny /= ln; nz /= ln;
            for (const o of [a, b, c]) { normals[o] = nx; normals[o + 1] = ny; normals[o + 2] = nz; }
        }
        const mat = materialInfo(rig, prim.material, path.dirname(full), () => null);
        const factor = tintFactor(mat.name, mat.factor);
        // Модель в метрах: приводим к нужной высоте в единицах мира и ставим ногами в 0.
        let minY = Infinity, maxY = -Infinity;
        for (let i = 1; i < used * 3; i += 3) { minY = Math.min(minY, positions[i]); maxY = Math.max(maxY, positions[i]); }
        const scale = height / Math.max(1e-4, maxY - minY);
        const pos = new Float32Array(used * 3);
        for (let i = 0; i < used; i += 1) {
            pos[i * 3] = positions[i * 3] * scale;
            pos[i * 3 + 1] = (positions[i * 3 + 1] - minY) * scale;
            pos[i * 3 + 2] = positions[i * 3 + 2] * scale;
        }
        return { positions: pos, normals, uv: prim.uv, count: used, indices: null, factor, texture: mat.texture, doubleSided: mat.doubleSided };
    });
    const w = Math.ceil(height * PX_PER_UNIT * 2) + 8;            // ширина с запасом на тень и уклон
    const h = Math.ceil(height * PX_PER_UNIT) + 10;
    const frame = makeFrame(w, h);
    const basis = cameraBasis({ yaw: YAW, pitch: PITCH, target: [0, height * 0.45, 0], distance: height * 3.2 });
    renderFrame(frame, { basis }, drawables, { pxPerUnit: PX_PER_UNIT });
    if (flag("debug")) {
        let lit = 0, maxA = 0;
        for (let i = 3; i < frame.data.length; i += 4) { if (frame.data[i] > 0) { lit += 1; maxA = Math.max(maxA, frame.data[i]); } }
        console.log(`   [dbg] ${kind} frame ${frame.width}×${frame.height} px=${frame.data.length / 4} lit=${lit} maxA=${maxA} h=${height}`);
    }
    // Кадр фиксирован, но проп в нём не отцентрован: режем по альфа-габариту и
    // помним, где центр основания — игра ставит проп по ноге, а не по пупку.
    let x0 = frame.width, y0 = frame.height, x1 = -1, y1 = -1;
    for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
        if (frame.data[(y * frame.width + x) * 4 + 3] < 40) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < x0) throw new Error(`${file}: модель не попала в кадр — проверьте distance/pxPerUnit`);
    return { kind, file, height, frame, w: frame.width, h: frame.height, bbox: { x0, y0, x1, y1 } };
}

/* ------------------------------ квантизация ------------------------------ */

/**
 * Палитра из самого рендера: 4096 корзин 4-битного RGB, берём самые частые.
 * Для пропа в 20–40 пикселей этого хватает, и главное — палитра получается
 * «внутренней» для модели, а не притянутой из палитры земли.
 */
function quantize(frame, colors) {
    const bins = new Map();
    const d = frame.data;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 40) continue;
        const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
        const bin = bins.get(key) || [0, 0, 0, 0];
        bin[0] += d[i]; bin[1] += d[i + 1]; bin[2] += d[i + 2]; bin[3] += 1;
        bins.set(key, bin);
    }
    const pal = [...bins.values()].sort((a, b) => b[3] - a[3]).slice(0, colors)
        .map(bin => [Math.round(bin[0] / bin[3]), Math.round(bin[1] / bin[3]), Math.round(bin[2] / bin[3])]);
    if (!pal.length) throw new Error("пустой кадр — нечего квантовать");
    const index = new Uint8Array(frame.width * frame.height);
    for (let i = 0, p = 0; i < d.length; i += 4, p += 1) {
        if (d[i + 3] < 40) { index[p] = 0; continue; }
        let best = 0, dist = Infinity;
        for (let c = 0; c < pal.length; c += 1) {
            const dr = pal[c][0] - d[i], dg = pal[c][1] - d[i + 1], db = pal[c][2] - d[i + 2];
            const s = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
            if (s < dist) { dist = s; best = c; }
        }
        index[p] = best + 1;                                       // 0 = пусто
    }
    return { pal, index };
}

/* --------------------------------- вывод --------------------------------- */

function cellOf(entry, ctx, ox, oy, scale) {
    const q = entry.q, b = entry.bbox;
    for (let y = b.y0; y <= b.y1; y += 1) {
        for (let x = b.x0; x <= b.x1; x += 1) {
            const v = q.index[y * entry.w + x];
            if (!v) continue;
            const c = q.pal[v - 1];
            ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
            ctx.fillRect(ox + (x - b.x0) * scale, oy + (y - b.y0) * scale, scale, scale);
        }
    }
}

function bakeAll() {
    setSun(12, 1);
    const out = [];
    for (const kind of KINDS) {
        try {
            const entry = bakeKind(kind);
            entry.q = quantize(entry.frame, COLORS);
            out.push(entry);
        } catch (err) {
            console.log(`   (${kind}: ${err.message})`);
        }
    }
    return out;
}

function sheet(entries) {
    // Один и тот же масштаб на обе колонки: 1 единица мира = 3 пикселя экрана.
    // Иначе «3D-камень» всегда кажется крупнее нарисованного, и спорить не о чем.
    const scale = Math.max(1, Math.round(3 / PX_PER_UNIT * 100) / 100);
    const view = 3;
    const cw = 190, ch = 130;                                        // строка: current | 3D
    const perRow = Math.min(4, Math.max(1, entries.length));        // по 4 пары в ряд: лист должен влезать в просмотрщик
    const rows = Math.ceil(entries.length / perRow);
    const cv = new ShimCanvas(perRow * (cw * 2 + 16) + 8, rows * (ch + 26) + 8);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#6f7a5e";
    ctx.fillRect(0, 0, cv.width, cv.height);
    // Один проп на строку: слева текущая отрисовка, справа запечённая модель.
    entries.forEach((e, i) => {
        const x0 = 4 + (i % perRow) * (cw * 2 + 20);
        const y = 4 + Math.floor(i / perRow) * (ch + 26);
        ctx.fillStyle = "#5c6a4f";
        ctx.fillRect(x0, y, cw * 2 + 8, ch);
        ctx.save();
        ctx.translate(x0 + cw / 2, y + ch * 0.82);
        ctx.scale(view, view);
        try {
            paintProp(ctx, { kind: e.kind, size: 1, x: 0, y: 0, tx: 3 + i, ty: 7 + i * 2, variant: i % 4, hits: 0, berries: true, ore: "copper" }, 1.2, "spring");
        } catch (err) {
            console.log(`   [dbg] ${e.kind}: текущая отрисовка упала — ${err.message}`);
        }
        ctx.restore();
        const bh = e.bbox.y1 - e.bbox.y0 + 1;
        const bw = e.bbox.x1 - e.bbox.x0 + 1;
        cellOf(e, ctx, x0 + cw + 8 + Math.max(0, (cw - bw * scale) / 2), y + ch - bh * scale - 6, scale);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillRect(x0 + cw + 4, y, 1, ch);
        // «подпись» полосой: шрифта в shim нет, поэтому длина полосы = длина имени.
        ctx.fillStyle = "#e8e2d0";
        ctx.fillRect(x0, y + ch + 3, Math.max(12, e.kind.length * 7), 7);
        ctx.fillStyle = "#f0cc8c";
        ctx.fillRect(x0 + cw + 8, y + ch + 3, Math.max(12, e.file.length * 6), 7);
    });
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, encodePNG(cv, [40, 46, 38]));
    console.log(`PROP-SHEET: ${entries.length} пропов → ${OUT} (левая колонка — как сейчас, правая — 3D-модель)`);
}

const entries = bakeAll();
sheet(entries);
const EMIT = String(flag("emit", "") === true ? "js/render/propsprites.js" : (flag("emit", "") || ""));
if (EMIT) {
    const kinds = {};
    for (const e of entries) {
        const bytes = [];
        for (let i = 0; i < e.q.index.length; i += 1) {
            const value = e.q.index[i];
            let run = 1;
            while (i + run < e.q.index.length && e.q.index[i + run] === value && run < 255) run += 1;
            bytes.push(run, value);
            i += run - 1;
        }
        const bw = e.bbox.x1 - e.bbox.x0 + 1, bh = e.bbox.y1 - e.bbox.y0 + 1;
        kinds[e.kind] = {
            x0: e.bbox.x0, y0: e.bbox.y0, w: bw, h: bh,
            // смещение центра основания кадра к точке пропа, в единицах мира
            anchorX: +(-(e.bbox.x0 + bw / 2) / PX_PER_UNIT).toFixed(3),
            anchorY: 0, foot: 0, height: +e.height.toFixed(2),
            palette: e.q.pal.map(c => `#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`),
            stream: Buffer.from(bytes).toString("base64")
        };
    }
    const body = `/**
 * js/render/propsprites.js — ПРОПЫ, запечённые из CC0-моделей (Kenney Nature Kit).
 * Генерирует \`node tools/prop-bake.js --emit\`. Формат кадра тот же, что у героя:
 * RLE-пары (длина, индекс палитры), 0 = пусто. Не править руками.
 */
export const PROP_SPRITES = ${JSON.stringify(kinds)};
export const PROP_META = { pxPerUnit: ${PX_PER_UNIT}, pitch: ${PITCH}, yaw: ${YAW}, baked: "${new Date().toISOString().slice(0, 10)}", source: "dev/character-style-lab/assets/kenney (CC0)" };
`;
    fs.mkdirSync(path.dirname(path.resolve(EMIT)), { recursive: true });
    fs.writeFileSync(EMIT, body);
    const kb = (fs.statSync(EMIT).size / 1024).toFixed(0);
    console.log(`EMIT: ${EMIT} — ${kb} KB, ${entries.length} пропов`);
}
