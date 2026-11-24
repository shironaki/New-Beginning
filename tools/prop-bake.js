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
import { readGlb, readGltf, readMesh, materialInfo } from "./gltf-rig.js";
import { loadPngFile, decodePng } from "./png-decode.js";
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
/** Каталог пака; PACKS объявлен ниже, поэтому резолвим лениво. */
const packDir = (name) => path.resolve((PACKS[name] || PACKS.kenney));
const PX_PER_UNIT = num("ppu", 2.4);                                   // как у героя
const PITCH = num("pitch", 0.2);
// 0.7 рад, а не «в анфас»: мир виден под three-quarter, и проп с этого же
// ракурса садится в кадр, тогда как фронтальный wagon выглядит табуреткой.
const YAW = num("yaw", 0.7);
const COLORS = num("colors", 15);
const OUT = String(flag("sheet", null) === null ? ".artifacts/prop-bake.png" : (flag("out") || ".artifacts/prop-bake.png"));

/**
 * kind пропа → модель, пак и размер. Высоты взяты не с потолка: `propHeight(kind, 1)`
 * в tilesart уже задаёт, насколько пропа быть, и печём ровно под него — иначе проп
 * встанет в другую сетку коллизий и «утонет» в земле.
 *
 * Поля записи: `file` — модель, `pack` — откуда брать (см. PACKS), `px` — размер в
 * пикселях экрана (по умолчанию propHeight), `fit` — по какой оси подгонять:
 * `y` (дерево: рост = Y) или `max` (бревно, ящик, крыша: длинная ось лежит на земле,
 * и подгонка по Y раздула бы её вдесятеро).
 */
const PACKS = {
    kenney: "dev/character-style-lab/assets/kenney",
    village: "dev/character-style-lab/assets/quaternius/village"
};
const PROP_MODEL = {
    rock: "rock_largeA.glb",
    ore_rock: "rock_tallB.glb",
    // У плоских деталей px — это ШИРИНА кадра (fit: "max"), а не высота: без
  // явного числа осыпь пеклась в 2×4 пикселя одного тона и исчезала на земле
  // (ревизию показывает `node tools/props-audit.js`).
    scree: { file: "stone_tallD.glb", fit: "max", px: 15 },
    beach_pebbles: { file: "stone_tallB.glb", fit: "max", px: 9 },
    log: { file: "log.glb", fit: "max", px: 16 },
    driftwood: { file: "log_large.glb", fit: "max", px: 20 },
    firewood: { file: "log.glb", fit: "max", px: 12 },
    // Пень: брали низкий stump_old — на кадре он читался как блин, и владелец
    // прав был: «вообще не похож на пень». Высокая версия + подгонка по Y даёт
    // обрубок, а не площадку; тёмная обугленная кора — из общей рамки контраста.
    // Пень: брали низкий stump_old — на кадре он читался как блин, и владелец
    // прав: «вообще не похож на пень». Высокая версия + подгонка по длинной оси
    // дают обрубок 16 px в поперечнике; по Y пень сжимался в щепку (7 px).
    burnt_stump: { file: "stump_oldTall.glb", fit: "max", px: 16 },
    bush: "plant_bushDetailed.glb",
    mushroom_patch: { file: "mushroom_redGroup.glb", fit: "max", px: 12 },
    pine: "tree_pineTallA.glb",
    spruce: "tree_pineTallB.glb",
    dead_tree: "tree_thin_dark.glb",
    ancient_oak: "tree_simple_dark.glb",
    /* Деревня: Quaternius «Medieval Village MegaKit» (CC0), glTF-модули.
       Это НЕ «дом целиком» — это детали конструктора, из которых дом собирается
       на сетке: стена + крыша + труба дают reading, которого у процедурного
       «треугольника с полосками» нет никогда. */
    // Стена — это стена, а не навес. Раньше обе детали брались из
    // Overhang_Plaster_Long, и в кадре получалась «полка на ножках»: игрок
    // читал это как предмет, висящий в воздухе. Wall_Plaster_Straight — глухая
    // панель от пола до потолка, её высота и есть то, на что садится крыша.
    // Кадр стены обязан быть ВЫШЕ тайла, иначе «дом» выглядит ящиком, а крыше
    // не на что опираться. 70 px — то же число, что в PROP_HEIGHT и в lift крыши.
    // Одиночная панель Wall_Plaster_Straight на тайле looked обелиском: у неё
    // аспект 1:2.7. Long-версия (модуль на два тайла) даёт ширину порядка тайла,
    // и «стена + крыша» начинают читаться как сарай, а не как щит на палке.
    hut_wall: { file: "Wall_Plaster_Straight_L.gltf", pack: "village", fit: "x", px: 44 },
    // Обломок стены в руинах — неровный кирпич: у пака есть деталь, которая
    // выглядит разваленой, значит не надо врать масштабом.
    // Обломок = неровный кирпич (у модуля рваный верх — это и есть «развалено»,
    // врать масштабом не надо). Wall_BottomCover пробовали: это дощатая опалубка
    // 20×6, на тайле она читается доской, а не остатком стены. По высоте режем
    // до 24 px: цоколь тонет в контактной тени, сверху остаётся рваная кладка.
    // Две попытки уже были: длинный кирпич (56×34) расползался по кадру в
    // «бордюр», а Wall_BottomCover — дощатая опалубка 20×6. Осталась нижняя
    // часть стены с проёмом: у неё аспект близок к 1, и обломок читается
    // остатком комнаты, а не дорогой.
    ruin_wall: { file: "Wall_BottomCover.gltf", pack: "village", fit: "x", px: 44 },
    // Крыша садится НА стену, поэтому её cap меньше высоты стены (70): иначе
    // кадр залезает за карниз и снова читается как навес в воздухе.
    // 6x6 из пака — это крыща сарая на шесть тайлов: на одном тайле она
    // выглядела красным зонтом. Roof_RoundTiles_2x1 ровно по размеру хижины.
    hut_roof: { file: "Roof_RoundTile_2x1.gltf", pack: "village", fit: "max", px: 52 },
    chimney: { file: "Prop_Chimney.gltf", pack: "village", fit: "y", px: 30 },
    // Забор — тот же случай: секция обязана дотягиваться до соседа, иначе
    // «плетень» превращается в гребёнку колышков.
    fence: { file: "Prop_WoodenFence_Single.gltf", pack: "village", fit: "x", px: 40 },
    crate: { file: "Prop_Crate.gltf", pack: "village", fit: "max", px: 16 },
    wagon: { file: "Prop_Wagon.gltf", pack: "village", fit: "max", px: 40 }
};
/** Запись таблицы → нормализованный вид. Строка — это просто файл. */
function modelOf(kind) {
    const raw = PROP_MODEL[kind];
    if (!raw) return null;
    const spec = typeof raw === "string" ? { file: raw } : raw;
    return { file: spec.file, pack: spec.pack || "kenney", fit: spec.fit || "y", px: spec.px || null };
}
const KINDS = String(flag("kinds", null) || Object.keys(PROP_MODEL)).split(",");

/* ----------------------------- растеризация ----------------------------- */

const TEX_CACHE = new Map();
/** PNG читается один раз на каталог: 6 моделей дергают одну T_WoodTrim. */
function loadPng(file) {
    if (!TEX_CACHE.has(file)) TEX_CACHE.set(file, loadPngFile(file));
    return TEX_CACHE.get(file);
}

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
/**
 * Каменные пропы пака выкрашены «землёй» и «мхом» — salmon-дирт даёт белую
 * булку вместо валуна. Для каменной семьи переопределяем роль материала.
 */
const STONE_KINDS = /rock|stone|scree|pebble|ore|flint/i;
const STONE_TINT = {
    grass: "#5c6a4f", dirt: "#82807a", stone: "#8d8a83", moss: "#66744f",
    snow: "#cfd8da", tan: "#8a857c", _default: "#82807a"
};
function stoneRole(name) {
    const key = Object.keys(STONE_TINT).find(k => k !== "_default" && new RegExp(k, "i").test(name || ""));
    return STONE_TINT[key || "_default"];
}
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
    const spec = modelOf(kind);
    if (!spec) throw new Error(`для «${kind}» нет модели в PROP_MODEL`);
    const { file, pack, fit, px } = spec;
    const dir = packDir(pack);
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) throw new Error(`нет файла ${full} — импортируйте пак (tools/pack-import.js, см. README пака)`);
    const rig = full.endsWith(".glb") ? readGlb(full) : readGltf(full);
    const meshes = [];
    for (let m = 0; m < (rig.json.meshes?.length || 0); m += 1) {
        for (const prim of readMesh(rig, m)) meshes.push(prim);
    }
    if (!meshes.length) throw new Error(`${file}: ни одного примитива`);
    const height = px || propHeight(kind, 1) || 8;                // пикселей экрана при зуме 1
    const basis = cameraBasis({ yaw: YAW, pitch: PITCH, target: [0, height * 0.45, 0], distance: height * 3.2 });
    const fwd = basis.fwd;
    const drawables = meshes.map((prim) => {
        const count = prim.count;
        let positions = prim.positions, normals = prim.normals, used = count;
        let uv = prim.uv;
        const index = prim.indices;
        if (index) {                                              // разворачиваем индексы
            positions = new Float32Array(index.length * 3);
            if (uv) uv = new Float32Array(index.length * 2);
            for (let i = 0; i < index.length; i += 1) {
                const v = index[i] * 3;
                positions[i * 3] = prim.positions[v]; positions[i * 3 + 1] = prim.positions[v + 1]; positions[i * 3 + 2] = prim.positions[v + 2];
                // UV обязан развернуться вместе с позициями: после разворота
                // вершин их стало втрое больше, и старый массив на новый индекс
                // просто не тянет — растеризатор читает undefined, получает NaN
                // и вместо камня рисует чёрную дыру.
                if (uv) { const t = index[i] * 2; uv[i * 2] = prim.uv[t]; uv[i * 2 + 1] = prim.uv[t + 1]; }
            }
            used = index.length;
        }
        normals = new Float32Array(used * 3);                     // плоские нормали по граням
        let ctr = [0, 0, 0];
        for (let i = 0; i < used * 3; i += 3) { ctr[0] += positions[i]; ctr[1] += positions[i + 1]; ctr[2] += positions[i + 2]; }
        ctr = ctr.map(v => v / Math.max(1, used));
        for (let t = 0; t + 2 < used; t += 3) {
            const a = t * 3, b = a + 3, c = a + 6;
            const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
            const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const ln = Math.hypot(nx, ny, nz) || 1;
            nx /= ln; ny /= ln; nz /= ln;
            // Грань разворачиваем «наружу» от центра примитива: у деталей
            // конструктора (стена, крыша, труба) половина треугольников смотрит
            // от камеры, и без этого они выходят абсолютно чёрными — растеризатор
            // не отбрасывает задние грани, а света для них он не считает.
            const cxm = (positions[a] + positions[b] + positions[c]) / 3 - ctr[0];
            const cym = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3 - ctr[1];
            const czm = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3 - ctr[2];
            if (nx * cxm + ny * cym + nz * czm < 0) { nx = -nx; ny = -ny; nz = -nz; }
            // …и добиваем разворотом к камере: проп — билборд, задняя грань стены
            // или внутренняя скат крышы не должны оставаться неосвещёнными,
            // иначе в листе они чёрным пятном (у конструктора грани тонкие).
            // …но только у конструктора: у Kenney-моделей задняя грань и должна
            // оставаться тёмной, иначе крона дерева выцветает в плоское пятно.
            if (pack === "village" && nx * fwd[0] + ny * fwd[1] + nz * fwd[2] > 0) { nx = -nx; ny = -ny; nz = -nz; }
            for (const o of [a, b, c]) { normals[o] = nx; normals[o + 1] = ny; normals[o + 2] = nz; }
        }
        const mat = materialInfo(rig, prim.material, dir, (uri) => path.join(dir, path.basename(decodeURIComponent(uri))));
        const texFile = mat.texture?.file && fs.existsSync(mat.texture.file) ? mat.texture.file : null;
        const texture = texFile ? loadPng(texFile) : (mat.texture?.buffer ? decodePng(mat.texture.buffer) : null);
        // Текстура сама несёт цвет — красить её поверх фактора пака значит получить
        // кашу: для текстурных материалов factor остаётся как есть.
        let factor = texture ? (mat.factor || [1, 1, 1, 1]) : tintFactor(mat.name, mat.factor);
        if (!texture && STONE_KINDS.test(kind)) {
            const hex = stoneRole(mat.name).replace("#", "");
            const base = [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];
            const l = Math.max(0.5, Math.min(1.15, lumOf(mat.factor) / 0.62));
            factor = [base[0] * l, base[1] * l, base[2] * l, 1];
        }
        // Модель в метрах: приводим к нужному размеру и ставим ногами в 0.
        // «y» — рост по вертикали (дерево), «max» — самая длинная ось (бревно,
        // крыша, ящик): у лежащей детали Y — это толщина, и подгонка по ней
        // раздула бы проп во столько раз, во сколько он длинный.
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < used * 3; i += 3) {
            minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
            minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
            minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
        }
        const spanY = Math.max(1e-4, maxY - minY);
        const spanFoot = Math.max(1e-4, maxX - minX, maxZ - minZ);
        // fit:"x" — подгонка по ШИРИНЕ следа. Нужна для того, что стоит рядом:
        // у стены, забора и фундамента важна непрерывность вдоль тайла, а не
        // высота. Подогнанный по вертикали модуль даёт 20 px при тайле 44 — и
        // «ряд одинаковых pillars» вместо стены (это и был обвал в руинах).
        const span = fit === "max" ? Math.max(spanY, spanFoot) : fit === "x" ? spanFoot : spanY;
        const scale = height / span;
        const pos = new Float32Array(used * 3);
        for (let i = 0; i < used; i += 1) {
            pos[i * 3] = positions[i * 3] * scale;
            pos[i * 3 + 1] = (positions[i * 3 + 1] - minY) * scale;
            pos[i * 3 + 2] = positions[i * 3 + 2] * scale;
        }
        // Плита «под моделью»: паки стелют под проп горизонтальную подложку
        // (мох/земля), и в билборде она разрастается в бледный щит поверх тайлов.
        // Режем треугольники, которые лежат на земле и смотрят строго вверх.
        const keep = [];
        for (let t = 0; t + 2 < used; t += 3) {
            const a = t * 3, b = a + 3, c = a + 6;
            const ny = (normals[a + 1] + normals[b + 1] + normals[c + 1]) / 3;
            const yMax = Math.max(pos[a + 1], pos[b + 1], pos[c + 1]);
            if (Math.abs(ny) > 0.92 && yMax < height * 0.03) continue;
            keep.push(t, t + 1, t + 2);
        }
        if (keep.length !== used) {
            const kp = new Float32Array(keep.length * 3), kn = new Float32Array(keep.length * 3);
            const ku = texture ? new Float32Array(keep.length * 2) : null;
            keep.forEach((v, i) => {
                kp[i * 3] = pos[v * 3]; kp[i * 3 + 1] = pos[v * 3 + 1]; kp[i * 3 + 2] = pos[v * 3 + 2];
                kn[i * 3] = normals[v * 3]; kn[i * 3 + 1] = normals[v * 3 + 1]; kn[i * 3 + 2] = normals[v * 3 + 2];
                if (ku) { ku[i * 2] = uv[v * 2]; ku[i * 2 + 1] = uv[v * 2 + 1]; }
            });
            return { positions: kp, normals: kn, uv: ku, count: keep.length, indices: null, factor, texture,
                 doubleSided: true };
        }
        return { positions: pos, normals, uv: texture ? uv : null, count: used, indices: null, factor, texture,
                 doubleSided: true };
    });
    const w = Math.ceil(height * PX_PER_UNIT * 2) + 8;            // ширина с запасом на тень и уклон
    const h = Math.ceil(height * PX_PER_UNIT) + 10;
    const frame = makeFrame(w, h);
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
    const bbox = { x0, y0, x1, y1 };
    if (flag("debug")) {
        // Доля пикселей по сторонам света: если «верх» (3) почти не набрал, кадр
        // смотрит на модель ребром и солнце на пропе будет не видно.
        const fs = faceStats(frame, bbox), tot = fs.reduce((a, c) => a + c, 0) || 1;
        console.log(`   [dbg] ${kind} face ` + fs.slice(1)
            .map((c, i) => `${FACE_LABEL[i]}:${Math.round((c / tot) * 100)}%`).join(" "));
    }
    return { kind, file, height, frame, w: frame.width, h: frame.height, bbox };
}

/* ----------------------------- стороны света ----------------------------- */

/**
 * Куда смотрит грань в этом пикселе: 1..6 = +X,-X,+Y,-Y,+Z,-Z (0 = пусто).
 * Код пишет растеризатор (frame.face в tools/raster3d.js), а мы несём его во
 * второй RLE-поток. Рантайму хватает шести значений, чтобы пересчитать яркость
 * палитры под текущее солнце и погоду: нормалей в растре нет, а «эта часть
 * кроны смотрит на восток» — есть. Наслоение по 3 слоя (side/rough/ao/wear),
 * как в RAMPS героя, сюда не переносится: у пропа 10 тонов на весь лист, и
 * вторая дорожка тона просто съела бы бюджет спрайтов.
 */
const FACE_LABEL = ["east", "west", "up", "down", "back", "front"];

function faceStats(frame, bbox) {
    const seen = new Array(7).fill(0);
    for (let y = bbox.y0; y <= bbox.y1; y += 1) {
        for (let x = bbox.x0; x <= bbox.x1; x += 1) {
            const i = y * frame.width + x;
            if (frame.data[i * 4 + 3] < 40) continue;
            seen[frame.face[i]] += 1;
        }
    }
    return seen;
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
    // Контраст по яркости с точкой 0.45: flat-нормали low-poly дают «ватное»
    // освещение, и валун выглядит пенной подушкой. Поднимаем разброс вокруг
    // середины — тени становятся тенями, как это делают RAMPS у героя.
    const ramp = (v) => {
        const t = Math.max(0, Math.min(1, 1.45 * (v / 255 - 0.45) + 0.45));
        return Math.round(t * 255);
    };
    const px = (i) => [ramp(d[i]), ramp(d[i + 1]), ramp(d[i + 2])];
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 40) continue;
        const [r, g, b] = px(i);
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const bin = bins.get(key) || [0, 0, 0, 0];
        bin[0] += r; bin[1] += g; bin[2] += b; bin[3] += 1;
        bins.set(key, bin);
    }
    const pal = [...bins.values()].sort((a, b) => b[3] - a[3]).slice(0, colors)
        .map(bin => [Math.round(bin[0] / bin[3]), Math.round(bin[1] / bin[3]), Math.round(bin[2] / bin[3])]);
    if (!pal.length) throw new Error("пустой кадр — нечего квантовать");
    const index = new Uint8Array(frame.width * frame.height);
    for (let i = 0, p = 0; i < d.length; i += 4, p += 1) {
        if (d[i + 3] < 40) { index[p] = 0; continue; }
        const [r, g, b] = px(i);
        let best = 0, dist = Infinity;
        for (let c = 0; c < pal.length; c += 1) {
            const dr = pal[c][0] - r, dg = pal[c][1] - g, db = pal[c][2] - b;
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
            entry.pack = modelOf(kind).pack;
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
        const bw = e.bbox.x1 - e.bbox.x0 + 1, bh = e.bbox.y1 - e.bbox.y0 + 1;
        // Дорожка граней: та же вырезка по габоиту и те же RLE-пары, что и у
        // цвета — рантайм идёт по двум потокам параллельно и не должен разъехаться.
        const faces = [];
        {
            const arr = new Uint8Array(bw * bh);
            for (let y = 0; y < bh; y += 1) {
                const src = (e.bbox.y0 + y) * e.w + e.bbox.x0;
                for (let x = 0; x < bw; x += 1) arr[y * bw + x] = e.frame.face[src + x];
            }
            for (let i = 0; i < arr.length; i += 1) {
                const value = arr[i];
                let run = 1;
                while (i + run < arr.length && arr[i + run] === value && run < 255) run += 1;
                faces.push(run, value);
                i += run - 1;
            }
        }
        // Поток режем по габоиту, а не по кадру: в файле должно жить ровно то, что
        // рисуется. Иначе рантайму пришлось бы знать размеры кадра (w*PPU*2+8),
        // а это уже удвоение контракта между запеккой и игрой.
        const crop = new Uint8Array(bw * bh);
        for (let y = 0; y < bh; y += 1) {
            const src = (e.bbox.y0 + y) * e.w + e.bbox.x0;
            crop.set(e.q.index.subarray(src, src + bw), y * bw);
        }
        const bytes = [];
        for (let i = 0; i < crop.length; i += 1) {
            const value = crop[i];
            let run = 1;
            while (i + run < crop.length && crop[i + run] === value && run < 255) run += 1;
            bytes.push(run, value);
            i += run - 1;
        }
        const model = modelOf(e.kind);
        kinds[e.kind] = {
            pack: e.pack, source: e.file,
            // Что пекарня считало главной осью: «y» — рост (дерево), «max» — самая
            // длинная сторона (лежачее бревно, панель крыши). Ревизии без этого
            // нечем отличить «низкий пень» от «короткой крыши»: у второй высота не
            // подгоняется вовсе, и флаги сыпались на ровные места.
            fit: model.fit || "y", px: e.height,
            x0: e.bbox.x0, y0: e.bbox.y0, w: bw, h: bh,
            // смещение центра основания кадра к точке пропа, в единицах мира
            anchorX: +(-(e.bbox.x0 + bw / 2) / PX_PER_UNIT).toFixed(3),
            anchorY: 0, foot: 0, height: +e.height.toFixed(2),
            palette: e.q.pal.map(c => `#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`),
            stream: Buffer.from(bytes).toString("base64"),
            faces: Buffer.from(faces).toString("base64")
        };
    }
    const body = `/**
 * js/render/propsprites.js — ПРОПЫ, запечённые из CC0-моделей (Kenney Nature Kit
 * и Quaternius «Medieval Village MegaKit»). Генерирует \`node tools/prop-bake.js
 * --emit\`. Формат кадра тот же, что у героя: RLE-пары (длина, индекс палитры),
 * 0 = пусто, поток покрывает именно габоит (w×h), не кадр растеризатора.
 * Поля pack/source говорят, откуда модель, — чтобы перепечь можно было без\n * угадывания.
 * Не править руками.
 */
export const PROP_SPRITES = ${JSON.stringify(kinds)};
export const PROP_META = { pxPerUnit: ${PX_PER_UNIT}, pitch: ${PITCH}, yaw: ${YAW}, baked: "${new Date().toISOString().slice(0, 10)}", source: ${JSON.stringify(PACKS)} };
`;
    fs.mkdirSync(path.dirname(path.resolve(EMIT)), { recursive: true });
    fs.writeFileSync(EMIT, body);
    const kb = (fs.statSync(EMIT).size / 1024).toFixed(0);
    console.log(`EMIT: ${EMIT} — ${kb} KB, ${entries.length} пропов`);
}
