/**
 * tools/hero-bake.js — запекка 3D-героя Quaternius в спрайт-кадры игры.
 *
 *   node tools/hero-bake.js --preview          # ракурсы крупным планом, просто посмотреть
 *   node tools/hero-bake.js --poses            # листы 1:1 и 2:1 в .artifacts/hero-bake
 *   node tools/hero-bake.js --emit             # то же + js/render/heroframes.js для игры
 *
 * Схема: настоящий риг из dev/character-style-lab/assets/quaternius (65 костей) +
 * настоящий пакет анимаций, скиннинг и свет считаются программно (tools/raster3d.js),
 * кадр режется фиксированной рамкой (не по габаритам силуэта — иначе герой дрожит на
 * месте вместо шага), квантуется в палитру и получает обводку — тем же модулем, что и
 * стенд (dev/character-style-lab/layers/photopix.js). На выходе кадры, которые игра
 * рисует без three.js и без WebGL.
 */
import fs from "node:fs";
import path from "node:path";
import { readGltf, readGlb, GltfRig, readMesh, materialInfo, sampleClip, readAccessor } from "./gltf-rig.js";
import { loadPngFile, decodePng } from "./png-decode.js";
import { makeFrame, clearFrame, cameraBasis, renderFrame } from "./raster3d.js";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
import { spriteFromPixels, buildPalette } from "../dev/character-style-lab/layers/photopix.js";
import { palette as labPalette } from "../dev/character-style-lab/layers/palette.js";
import { RAMPS, shadeHex } from "../js/render/charspec.js";

const LAB = "dev/character-style-lab";
const ASSETS = path.join(LAB, "assets", "quaternius");
const TEXDIR = path.join(LAB, ".bake", "tex");
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = (name, value) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? value : argv[i + 1];
};

const WHO = opt("who", "male") === "female" ? "Female" : "Male";
// Куда писать лист. По умолчанию — игровой модуль, но женская (или любая
// экспериментальная) пачка обязана иметь свой путь: иначе `--emit` поверх
// js/render/heroframes.js тихо затирает то, чем играет весь мир.
const EMIT_FILE = String(opt("emit-file", "js/render/heroframes.js"));
const SS = Number(opt("ss", 4));              // супер-сэмплинг относительно пикселя спрайта
const BODY_UNITS = Number(opt("bodyUnits", 42));    // рост героя в единицах мира (charspec BODY.total)
// Пикселей спрайта на единицу мира. 2.4 — это UI.baseZoom, то есть на экране
// герой из запекки приходит 1:1: без мерцания на шаге и без мыла. Если игра
// откроется на другом зуме, меняется только это число — перепекаемся за секунды.
//
// Ширина 1700+ получает density 2 (js/main.js), то есть зум 4.8: там спрайт
// рисуется апскейлом 2× ближайшим соседом — крупные, но ровные пиксели, без мыла.
// Ответвление «запечь 4.8» проверено: 1.2 МБ вместо 493 КБ и мыло на телефонах,
// где плотность 1 и герой как раз должен быть читаемым. Оставляем 1× и nearest.
const PX_PER_UNIT = Number(opt("pxPerUnit", 2.4));
const MODEL_HEIGHT = 1.86;                     // макушка в метрах модели (измерено по сетке)
// Ячейка в единицах мира: 48 на 52 — с плечом по горизонтали и зазором под стопы.
// Ячейка в единицах мира. 42×47 и 3 под стопы — это не на глаз: их подобрал
// `--fit`, который прогоняет все запечённые позы и берёт максимальный габарит.
// Прежние 48×52 были от T-позы, поэтому в них не хватало места под выпад, зато
// было слишком много пустого по бокам (каждый лишний ряд — это байты на кадр).
const CELL_U = { w: Number(opt("cellwu", 42)), h: Number(opt("cellhu", 47)) };
const CELL = { w: Math.round(CELL_U.w * PX_PER_UNIT), h: Math.round(CELL_U.h * PX_PER_UNIT) };
const FOOT = Math.round(Number(opt("footu", 3)) * PX_PER_UNIT);   // пикселей под линию стоп
const PITCH = Number(opt("pitch", 0.2));
const OUT = path.resolve(opt("out", ".artifacts/hero-bake"));
// Свет в игре плоский и пепельный: фигура с оригинальной яркостью 3D-рендера
// выглядит приклеенной. До квантизации саживаем сатурацию почти в ноль миру и
// чуть поднимаем яркость — так остаются три тональные полосы (свет/база/тень),
// а не фото-грязь. Dither минимальный: на 115-пиксельной фигуре он уже шумы,
// а не переходы.
// Цвета образа (js/render/character.js DEFAULT_LOOK): спрайт красится под них,
// иначе герой в игре никак не связан с тем, что выбран в панели внешности.
const LOOK = {
    skin: opt("skin", "#e0b594"),
    // Ключ --hair задаёт и имя мешка, и цвет — отсюда путаница в пробах:
    // «--hair Hair_Long» красил волосы в строку «Hair_Long». Цветом считается
    // только то, что похоже на hex; haircolor перебивает всегда.
    hair: opt("haircolor", /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(opt("hair", "")))
        ? String(opt("hair")) : "#302b29"),
    coat: opt("coat", "#446d68"),
    pants: opt("pants", "#48473e")
};
// «Без пиксельного грейда»: тот же рендер, но квантованный в 20 тонов на дорожку,
// без дизеринга и без обводки. Нужен, чтобы честно сравнить 3D-риг с пиксельной
// сборкой — silhouette, свет и одежда те же, меняется только шаг квантизации.
const SMOOTH = flag("smooth");
const SMOOTH_STEPS = Number(opt("steps", 20));
const SMOOTH_POSES = String(opt("smoothposes", "idle,walk,run,chop,mine,gather,attack,torch")).split(",");
const SMOOTH_FILE = String(opt("emit-smooth", ""));
const OUTFIT = flag("no-outfit") ? null : String(opt("outfit", "Male_Peasant"));
const HAIR = flag("no-hair") ? null : String(opt("hair", "Hair_Long"));

const GRADE = {
    sat: Number(opt("sat", 0.62)),
    mul: Number(opt("mul", 1.02)),
    lift: Number(opt("lift", 4)),
    cool: Number(opt("cool", 0.1))
};

// Ракурс = поворот КАМЕРЫ вокруг модели (модель всегда смотрит в +Z). При yaw 0
// глаз камеры в +Z, то есть мы видим лицо — это «идёт на нас» = dir down. Камера на
// +X (yaw +π/2) видит левый бок, а фронт модели уходит на левый край экрана —
// значит это профиль «идёт влево». Раньше эти два были переставлены, и в игре
// герой шагал «задом наперёд».
const DIRS = [
    { name: "down", yaw: 0 },
    { name: "left", yaw: Math.PI / 2 },
    { name: "right", yaw: -Math.PI / 2 },
    { name: "up", yaw: Math.PI }
];

// `ship: true` — поза попадает в js/render/heroframes.js. Остальные запекаются в
// листы (их видно на sheet-*.png), но в игру не едут: 60 KB на связку, раздувать
// модуль ради кадров, которые движок пока не просит, незачем.
const POSES = [
    { label: "idle", clip: "Idle_Loop", frames: 4, fps: 6, ship: true },
    { label: "walk", clip: "Walk_Loop", frames: 8, fps: 11, ship: true },
    { label: "run", clip: "Jog_Fwd_Loop", frames: 6, fps: 14, ship: true },
    { label: "sprint", clip: "Sprint_Loop", frames: 6, fps: 16 },
    { label: "attack", clip: "Sword_Attack", frames: 6, fps: 13, ship: true },
    { label: "chop", clip: "TreeChopping_Loop", frames: 6, fps: 10, ship: true },
    // Кирка — это удар сверху, а не хук: Melee_Hook разводил руку на ±32 единицы,
    // и кулак с инструментом выходил за ячейку (обрезался). OverhandThrow — та же
    // дуга через голову, но в ±19.7, плюс читается как «замах», а не как драка.
    { label: "mine", clip: "OverhandThrow", frames: 5, fps: 11, ship: true },
    { label: "gather", clip: "Farm_Harvest", frames: 4, fps: 8, ship: true },
    { label: "carry", clip: "Walk_Carry_Loop", frames: 6, fps: 11 },
    { label: "block", clip: "Sword_Block", frames: 4, fps: 6 },
    { label: "eat", clip: "Consume", frames: 5, fps: 9 },
    { label: "torch", clip: "Idle_Torch_Loop", frames: 4, fps: 5, ship: true },
    { label: "crouch", clip: "Crouch_Idle_Loop", frames: 4, fps: 6 },
    { label: "sit", clip: "Sitting_Idle_Loop", frames: 4, fps: 5 },
    { label: "interact", clip: "Interact", frames: 5, fps: 10 },
    { label: "hit", clip: "Hit_Chest", frames: 4, fps: 12 },
    { label: "death", clip: "Death01", frames: 8, fps: 10 },
    // Кандидаты на подбор: --fit --all показывает, влезает ли клип в ячейку.
    { label: "fix", clip: "Fixing_Kneeling", frames: 6, fps: 8 },
    { label: "dig", clip: "Farm_Watering", frames: 5, fps: 9 },
    { label: "pickup", clip: "PickUp_Table", frames: 5, fps: 9 }
];

// Герой собирается из частей одного и того же Universal Rig: тело из пака
// базовых персонажей, одежда — из Modular Character Outfits (CC0), волосы —
// отдельным мешом. У каждой части свой файл и свой скелет, но ИМЕНА костей
// общие, поэтому один и тот же клип сэмплируется в каждую часть независимо —
// никакого ретаргета не нужно.
// От базового тела берём ГОЛОВУ: «FullBody» несёт ещё и торс с руками, и они
// шире куртки из пака, поэтому одежда тонула в теле и выглядела налипшим пятном.
// Пак Modular Outfits и собран как тело: у Peasant_Male есть свои руки, торс,
// штаны и ботинки (v2.0: «all models work with just the head from the Base
// Characters»), а кожа рук его собственной текстуры теперь всё равно красится
// дорожкой образа — прежний конфликт оттенков решает палитра в рантайме.
// Тело базового персонажа нужно ЦЕЛИКОМ, а не только головой. Раньше от него
// брали голову (торс и руки «шире куртки», и одежда тонула в теле) — и платой
// были дырки: у комплекта Male_Peasant есть раскрытые швы на рукавах, а за ними
// ничего не было, кроме неба. Теперь тело — подкладка: оно чуть утянуто к оси
// (shrink), отодвинуто назад (отрицательный bias) и красится дорожкой кожи, так
// что прореха в рукаве показывает руку, а не землю. Силиэт при этом не жиреет:
// 0.93 по X/Z держит тело внутри одежды.
const UNDERSUIT = flag("no-undersuit") ? null : {
    shrink: Number(opt("shrink", 0.97)),
    // Сдвиг ВДОЛЬ нормали, а не только сужение к оси: плечи и запястья тела
    // торчали из рукавов («кожа поверх куртки»), а ось на них не работает.
    inset: Number(opt("inset", 0.02)),
    bias: -0.006
};
const PARTS = [
    UNDERSUIT
        ? { file: () => path.join(ASSETS, "char", `Superhero_${WHO}_FullBody.gltf`), role: "body", bias: UNDERSUIT.bias, undersuit: UNDERSUIT }
        : { file: () => path.join(ASSETS, "char", `Superhero_${WHO}_FullBody.gltf`), role: "body", bias: 0, headOnly: true },
    { file: () => (OUTFIT ? path.join(ASSETS, "outfits", `${OUTFIT}.glb`) : null), role: "clothes", bias: 0.002 },
    // Волосы садятся на голову НЕ как есть: пак рисует их под собственную
    // модель головы, и без подгонки причёсда превращается в шлем, под которым
    // лица не видно (ровно на это пожаловался владелец). HAIR_FIT подгоняет
    // ширину по габариту головы и поднимает край над бровями; faceCut дополнительно
    // вырезает пряди, которые всё ещё лежат ПЕРЕД лицом.
    { file: () => (HAIR ? path.join(ASSETS, "hair", `${HAIR}.glb`) : null), role: "hair", bias: 0.006,
      fit: flag("no-hairfit") ? null : { width: Number(opt("hairwidth", 1.06)), lift: Number(opt("hairlift", 0.012)), faceCut: !flag("no-facecut") } }
];
/** Глаза/брови — по имени мешка, а не по имени конкретного пола. */
const FEATURE_MESH = { "Face.001": "eyes", Eyes: "eyes", Face: "brows", Eyebrows: "brows" };
const HEAD_BONES = /^(head|neck_01)$/i;
// Клипы ищутся по всем подключённым библиотекам: базовый пак даёт походку,
// Universal Animation Library 2 — рубку дерева, сбор урожая, блок щитом.
const ANIM_FILES = ["anims.glb", "animations/UAL2.glb"]
    .map(rel => path.join(ASSETS, rel))
    .filter(file => fs.existsSync(file));

const PALETTE = buildPalette(labPalette);
const INK = [28, 22, 16];
/*
 * Цветовые дорожки. Растеризатор помнит, ЧЕЙ материал попал в пиксель (track),
 * и для этих пикселей запекка не квантует цвет в общую палитру, а выбирает тон
 * из дорожки: 5 тонов куртки, 4 тона кожи, 3 тона волос — по яркости уже
 * затенённого пикселя. Свет и узор текстуры сохраняются, а сами тона в игре
 * пересобираются из цвета образа — один запёк, любые цвета куртки.
 */
const RAMP_KEYS = ["cloth", "skin", "hair", "pants"];
/** Имена записей палитры запекки — по ним лицо отличает «кожу» от «ткани». */
const PALETTE_NAMES = (typeof PALETTE !== "undefined" && PALETTE.length)
    ? PALETTE.map(entry => (Array.isArray(entry) ? entry[0] : entry.name || "")) : [];
const TRACK_OF = { cloth: 1, skin: 2, hair: 3, pants: 4 };
const TRACK_NAME = ["", "cloth", "skin", "hair", "pants"];
const rampSteps = key => RAMPS[key].offsets.length;
const rampHexes = (key, base) => RAMPS[key].offsets.map(off => shadeHex(base, off));
const RAMP_AT = (() => {
    const at = {};
    let i = PALETTE.length + 1;             // +1 — слот обводки идёт перед дорожками
    for (const key of RAMP_KEYS) { at[key] = i; i += rampSteps(key); }
    return at;
})();
const INK_AT = PALETTE.length;
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const BAYER2 = [[0, 2], [3, 1]];
const textureCache = new Map();

function resolveTexture(uri) {
    const base = path.basename(String(uri)).replace(/\.[a-z]+$/i, "");
    const png = path.join(TEXDIR, `${base}.png`);
    return fs.existsSync(png) ? png : null;
}

const hexRgb = hex => {
    const c = String(hex).replace("#", "");
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
};

function decodeTexture(texture) {
    const key = `buffer:${texture.name}`;
    if (!textureCache.has(key)) textureCache.set(key, decodePng(texture.buffer));
    return textureCache.get(key);
}

function loadTexture(file) {
    if (!textureCache.has(file)) textureCache.set(file, loadPngFile(file));
    return textureCache.get(file);
}

/**
 * Какой дорожкой красить примитив. Куртка и штаны — разные цвета образа, поэтому
 * одежду делим по мешам, а не по материалу: у пака на весь комплект один MI_Peasant.
 * Собственная кожа комплекта (материал regular) и тело идут дорожкой кожи; брови с
 * глазами остаются в общей палитре — их цвет не про одежду.
 */
function trackOf(role, matName, meshName) {
    const name = String(matName || "");
    const mesh = String(meshName || "");
    if (role === "hair") return TRACK_OF.hair;
    // Подкладка: всё, что не глаза и не брови, красится кожей. Тканевый
    // костюм супергероя из этой же модели в прорехах смотреться не должен.
    if (role === "body" && UNDERSUIT) return /eye|brow|teeth/i.test(`${name} ${mesh}`) ? 0 : TRACK_OF.skin;
    if (role === "clothes") {
        if (/regular|skin/i.test(name)) return TRACK_OF.skin;
        // Обувь — не цвет одежды: её тон и так сидит в общей палитре (boot/leather),
        // дорожкой красить нечего, зато границы подошвы остаются чистыми.
        if (/feet|shoe|boot/i.test(mesh)) return 0;
        return /leg|trouser|pant/i.test(mesh) ? TRACK_OF.pants : TRACK_OF.cloth;
    }
    return /superhero|skin/i.test(name) ? TRACK_OF.skin : 0;
}

/** Индекс кости → её имя: по именам режем меши на части тела. */
function boneNames(rig) {
    const skin = rig.skin(0);
    return (skin?.joints || []).map(i => rig.json.nodes[i]?.name || "");
}

/**
 * Оставить в примитиве только треугольники головы — те, у которых главная кость
 * (максимальный вес) Head или neck_01. Режем по треугольникам, а не по вершинам:
 * иначе на границе шеи остались бы дыры.
 */
function keepHeadOnly(prim, names) {
    if (!prim.joints || !prim.weights) return { ...prim, count: 0 };
    const keep = new Uint8Array(prim.count);
    for (let v = 0; v < prim.count; v += 1) {
        let best = prim.joints[v * 4], bw = -1;
        for (let k = 0; k < 4; k += 1) {
            const w = prim.weights[v * 4 + k];
            if (w > bw) { bw = w; best = prim.joints[v * 4 + k]; }
        }
        keep[v] = HEAD_BONES.test(names[best] || "") ? 1 : 0;
    }
    const out = [];
    const tri = prim.indices ? prim.indices.length / 3 : prim.count / 3;
    for (let t = 0; t < tri; t += 1) {
        const i0 = prim.indices ? prim.indices[t * 3] : t * 3;
        const i1 = prim.indices ? prim.indices[t * 3 + 1] : t * 3 + 1;
        const i2 = prim.indices ? prim.indices[t * 3 + 2] : t * 3 + 2;
        if (keep[i0] && keep[i1] && keep[i2]) out.push(i0, i1, i2);
    }
    return { ...prim, indices: Uint32Array.from(out), count: out.length };
}

function loadPart(spec) {
    const file = spec.file();
    if (!file || !fs.existsSync(file)) return null;
    const gltf = file.endsWith(".glb") ? readGlb(file) : readGltf(file);
    const rig = new GltfRig(gltf);
    return { spec, file, gltf, rig, skin: rig.skin(0), boneNames: boneNames(rig), drawables: [] };
}

function buildScene() {
    const parts = PARTS.map(loadPart).filter(Boolean);
    const scene = { parts, rig: parts[0].rig, skin: parts[0].skin, drawables: [] };
    // Причёска подгоняется по голове, поэтому габарит головы нужен заранее.
    const body = parts.find(x => x.spec.role === "body");
    if (body) body.headBox = headBoxOf(body);
    for (const part of parts) collectDrawables(part, scene);
    return scene;
}

/**
 * Причёска → по голове. Полоса отсечения лица: всё, что попадает в ящик лица
 * (лоб → подбородок, от спинки носа вперёд), вырезается из волос, иначе косая
 * прядь ложится поверх глаз и лицо исчезает.
 */
function fitHairToHead(prim, head, fit) {
    let hx0 = Infinity, hx1 = -Infinity, hz0 = Infinity, hz1 = -Infinity, hy0 = Infinity, hy1 = -Infinity;
    for (let v = 0; v < prim.count; v += 1) {
        const x = prim.positions[v * 3], y = prim.positions[v * 3 + 1], z = prim.positions[v * 3 + 2];
        if (x < hx0) hx0 = x; if (x > hx1) hx1 = x;
        if (z < hz0) hz0 = z; if (z > hz1) hz1 = z;
        if (y < hy0) hy0 = y; if (y > hy1) hy1 = y;
    }
    const k = Math.min(1.2, ((head.x1 - head.x0) * fit.width) / Math.max(1e-4, hx1 - hx0));
    const cx = (hx0 + hx1) / 2, cz = (hz0 + hz1) / 2;
    const dy = (head.y1 + fit.lift) - hy1;                      // верх волос — чуть выше макушки
    const positions = new Float32Array(prim.count * 3);
    for (let v = 0; v < prim.count; v += 1) {
        positions[v * 3] = cx + (prim.positions[v * 3] - cx) * k;
        positions[v * 3 + 1] = prim.positions[v * 3 + 1] + dy;
        positions[v * 3 + 2] = cz + (prim.positions[v * 3 + 2] - cz) * k;
    }
    let normals = prim.normals ? new Float32Array(prim.normals) : null;
    if (normals && k !== 1) {
        for (let v = 0; v < normals.length; v += 3) { normals[v] /= k; normals[v + 2] /= k; }
    }
    if (!fit.faceCut) return { positions, normals, indices: prim.indices, count: prim.count, indicesDelta: 0 };
    // Ящик лица: по ширине головы, от линии бровей вниз до подбородка, наружу.
    const fx = (head.x1 - head.x0) * 0.62, fy0 = head.y0 + (head.y1 - head.y0) * 0.55, fy1 = head.y1 - (head.y1 - head.y0) * 0.02;
    const fz0 = head.z0 + (head.z1 - head.z0) * 0.62;
    const inside = (i) => {
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        return Math.abs(x - cx) < fx && y > fy0 && y < fy1 && z > fz0;
    };
    const src = prim.indices;
    if (!src) return { positions, normals, indices: src, count: prim.count, indicesDelta: 0 };
    const out = [];
    let cut = 0;
    for (let t = 0; t + 2 < src.length; t += 3) {
        if (inside(src[t]) && inside(src[t + 1]) && inside(src[t + 2])) { cut += 1; continue; }
        out.push(src[t], src[t + 1], src[t + 2]);
    }
    return { positions, normals, indices: Uint32Array.from(out), count: out.length, indicesDelta: cut };
}

/** Габарит головы по весам: вершины, у которых главная кость — Head/neck_01. */
function headBoxOf(part) {
    const names = part.boneNames;
    let b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    for (let m = 0; m < (part.gltf.json.meshes?.length || 0); m += 1) {
        for (const prim of readMesh(part.rig, m)) {
            if (!prim.joints || !prim.weights) continue;
            for (let v = 0; v < prim.count; v += 1) {
                let best = prim.joints[v * 4], bw = -1;
                for (let k = 0; k < 4; k += 1) {
                    const w = prim.weights[v * 4 + k];
                    if (w > bw) { bw = w; best = prim.joints[v * 4 + k]; }
                }
                if (!HEAD_BONES.test(names[best] || "")) continue;
                const x = prim.positions[v * 3], y = prim.positions[v * 3 + 1], z = prim.positions[v * 3 + 2];
                if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
                if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
                if (z < b.z0) b.z0 = z; if (z > b.z1) b.z1 = z;
            }
        }
    }
    return Number.isFinite(b.x0) ? b : null;
}

function collectDrawables(part, scene) {
    const { gltf, rig, spec } = part;
    gltf.json.meshes.forEach((mesh, meshIndex) => {
        readMesh(rig, meshIndex).forEach((basePrim, pi) => {
            const prim = spec.headOnly ? keepHeadOnly(basePrim, part.boneNames) : basePrim;
            if (!prim.count) return;
            const mat = materialInfo(rig, prim.material, gltf.dir, uri => resolveTexture(uri) || path.resolve(gltf.dir, uri));
            const isHair = /hair/i.test(mat.name || "");
            let factor = mat.factor ? Array.from(mat.factor) : [1, 1, 1, 1];
            let textureFile = mat.texture?.file && fs.existsSync(mat.texture.file) ? mat.texture.file : null;
            // У материала волос в gltf нет текстуры (экспортёр Blender её потерял), но UV на месте —
            // берём карту волос по имени, иначе голова выходит однотонным тёмным пятном.
            if (isHair && !textureFile) textureFile = resolveTexture(`T_Hair_${WHO === "Female" ? 2 : 1}_BaseColor.png`);
            if (isHair && !textureFile) factor = [0.28, 0.18, 0.12, 1];
            let positions = prim.positions, normals = prim.normals;
            if (spec.undersuit) {
                const { shrink: k, inset } = spec.undersuit;
                positions = new Float32Array(prim.positions);
                const nrm = prim.normals;
                for (let v = 0; v < positions.length; v += 3) {
                    positions[v] *= k; positions[v + 2] *= k;
                    if (nrm && inset) {
                        const nx = nrm[v], ny = nrm[v + 1], nz = nrm[v + 2];
                        const l = Math.hypot(nx, ny, nz) || 1;
                        positions[v] -= (nx / l) * inset;
                        positions[v + 1] -= (ny / l) * inset;
                        positions[v + 2] -= (nz / l) * inset;
                    }
                }
                if (normals && k !== 1) {
                    normals = new Float32Array(prim.normals);
                    for (let v = 0; v < normals.length; v += 3) { normals[v] /= k; normals[v + 2] /= k; }
                }
            }
            if (spec.fit && part.headBox) {
                const fit = fitHairToHead(prim, part.headBox, spec.fit);
                positions = fit.positions; normals = fit.normals;
                if (fit.indicesDelta) console.log(`   [hair] face-cut: убрано граней ${fit.indicesDelta}`);
            }
            part.drawables.push({
                name: `${mesh.name}#${pi}`,
                positions, normals, uv: prim.uv,
                joints: prim.joints, weights: prim.weights, indices: prim.indices, count: prim.count,
                factor,
                depthBias: spec.bias,
                // Глаза и брови рисуются НЕ квантизацией, а отдельным штампом
                // (см. stampFeatures): в источнике это 0.03 ед. высоты, т. е.
                // меньше пикселя спрайта.
                // Имена мешков лица у полов РАЗНЫЕ: мужская база зовёт их
                // «Face»/«Face.001», женская — «Eyebrows»/«Eyes». Прежняя
                // сверка по двум строкам молча лишала женщин штампа: лист
                // пропекался с пустым овалом вместо лица (претензия п.4).
                feature: spec.role === "body" ? FEATURE_MESH[mesh.name] || null : null,
                track: trackOf(spec.role, mat.name, mesh.name),
                texture: flag("no-tex") ? null : (mat.texture?.buffer ? decodeTexture(mat.texture)
                    : textureFile ? loadTexture(textureFile) : null)
            });
        });
    });
    scene.drawables.push(...part.drawables);
}

function who() { return WHO.toLowerCase(); }

function loadAnimLibs() {
    return ANIM_FILES.map(file => readGlb(file));
}

/** Найти клип по имени в любой подключённой библиотеке. */
function findClip(animLibs, clipName) {
    for (const lib of animLibs) {
        const clip = lib.json.animations?.find(c => c.name === clipName);
        if (clip) return { lib, clip };
    }
    throw new Error(`клип ${clipName} не найден ни в одной библиотеке анимаций`);
}

function clipDuration(animLibs, clipName) {
    const { lib, clip } = findClip(animLibs, clipName);
    const times = clip?.samplers?.[0]?.input;
    if (times === undefined) return 1;
    const acc = readAccessor(lib.json, lib.bin, times);
    return acc.count ? acc.array[acc.array.length - 1] : 1;
}

const BIG = { w: Math.round((CELL.w + 40) * SS), h: Math.round((CELL.h + 40) * SS) };

/**
 * Свет для запекки — В ПРОСТРАНСТВЕ КАМЕРЫ и смотрит на персонажа (z < 0), а не
 * от него. Дефолт растеризатора подсвечивает то, что повёрнуто ОТ наблюдателя:
 * затылок светлый, лицо в тени, и на 100-пиксельном спрайте лицо превращается в
 * тёмное пятно («где лицо?»). Камерный свет поворачивается вместе с ракурсом,
 * поэтому лицо читается в каждом из четырёх, а не только в front-view.
 * Направление света при этом косое и холодным небом сверху, чтобы складки ткани
 * не превратились в плоскую заливку.
 */
const HERO_LIGHT = {
    dir: [-0.36, 0.72, -0.58],
    color: [1.0, 0.97, 0.9],
    intensity: 0.86,
    sky: [0.46, 0.52, 0.6],
    ground: [0.34, 0.28, 0.22],
    ambient: 0.22
};

function renderRaw(scene, anim, { yaw, time = null, clip = null }) {
    const unit = PX_PER_UNIT * (BODY_UNITS / MODEL_HEIGHT) * SS;
    const frame = makeFrame(BIG.w, BIG.h);
    const found = clip ? findClip(anim, clip) : null;
    const drawables = [];
    for (const part of scene.parts) {
        // Одна и та же анимация, разные скелеты: треки сопоставляются по именам костей.
        const overrides = found ? sampleClip(part.rig, found.lib.json, found.lib.bin, found.clip, time) : null;
        const jointWorld = part.rig.jointMatrices(part.skin, overrides);
        for (const d of part.drawables) { d.jointWorld = jointWorld; drawables.push(d); }
    }
    const basis = cameraBasis({ yaw, pitch: PITCH, target: [0, 0.93, 0], distance: 8 });
    clearFrame(frame);
    renderFrame(frame, { basis }, drawables, { pxPerUnit: unit, light: HERO_LIGHT });
    frame._basis = basis;
    frame._unit = unit;
    // Смещение кадра: макушка и стопы должны влезть, поэтому считаем box по T-позе один раз.
    return frame;
}

let BOX = null;
const UNIT = PX_PER_UNIT * (BODY_UNITS / MODEL_HEIGHT) * SS;   // пикселей большого кадра на метр модели

/** Альфа-габарит большого кадра, в пикселях большого кадра. */
function frameBox(frame) {
    let x0 = frame.width, y0 = frame.height, x1 = -1, y1 = -1;
    for (let y = 0; y < frame.height; y += 1) {
        for (let x = 0; x < frame.width; x += 1) {
            if (frame.data[(y * frame.width + x) * 4 + 3] > 96) {
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
    }
    return { x0, y0, x1, y1 };
}

/**
 * `--fit` — честный размер ячейки. Раньше она считалась по T-позе, а широкий хук
 * киркой и нога в выпаде выходят за неё: пиксели обрезались по границе, а якорь
 * кисти уезжал за край (это и ловил тест на якорях). Режим прогонит все кадры всех
 * поз и напечатает CELL_U/FOOT, под которые попадает всё.
 */
function measureFit(scene, anim) {
    const t = frameBox(renderRaw(scene, anim, { yaw: 0, time: 0, clip: "A_TPose" }));
    const cx = (t.x0 + t.x1) / 2, feet = t.y1 + 1;
    // Игра получает только ship:true — меряем по ним, иначе размер диктует труп
    // из несобранной позы. --all считает всё, что есть в листе.
    const list = flag("all") ? POSES : POSES.filter(p => p.ship);
    const U = PX_PER_UNIT * SS;
    const per = new Map();
    let half = 0, above = feet - t.y0, below = 0;
    for (const pose of list) per.set(pose.label, { half: 0, above: 0, below: 0 });
    for (const dir of DIRS) {
        for (const pose of list) {
            const duration = clipDuration(anim, pose.clip) || 1;
            for (let i = 0; i < pose.frames; i += 1) {
                const b = frameBox(renderRaw(scene, anim, { yaw: dir.yaw, time: (i / pose.frames) * duration * 0.98, clip: pose.clip }));
                const p = per.get(pose.label);
                p.half = Math.max(p.half, cx - b.x0, b.x1 - cx);
                p.above = Math.max(p.above, feet - b.y0);
                p.below = Math.max(p.below, b.y1 - feet + 1);
                half = Math.max(half, p.half);
                above = Math.max(above, p.above);
                below = Math.max(below, p.below);
            }
        }
    }
    const pad = Number(opt("outline", 2)) / PX_PER_UNIT;
    for (const [label, p] of per) {
        console.log(`     ${label.padEnd(7)} вбок ±${(p.half / U).toFixed(1)}  вверх ${(p.above / U).toFixed(1)}  вниз ${(p.below / U).toFixed(1)}`);
    }
    const w = Math.ceil(2 * (half / U) + 2 * pad);
    const footU = Math.max(FOOT / PX_PER_UNIT, Math.ceil(below / U) + 1);
    const h = Math.ceil(above / U + footU + pad);
    console.log(`FIT  CELL_U = { w: ${w}, h: ${h} }, FOOT = ${footU}      (было w=${CELL_U.w}, h=${CELL_U.h}, foot=${(FOOT / PX_PER_UNIT).toFixed(0)})`);
    console.log(`     вбок ±${(half / U).toFixed(1)} ед., над стопами ${(above / U).toFixed(1)}, под стопами ${(below / U).toFixed(1)}`);
    console.log(`     BIG = ${BIG.w}×${BIG.h} px большого кадра — если ячейка не влезает — подними BIG`);
}

function anchorBoxFrom(frame) {
    // Габариты T-позы: левый/правый край, нижняя строка (стопы) — дальше они не меняются.
    const { x0, y0, x1, y1 } = frameBox(frame);
    const cx = Math.round((x0 + x1) / 2);
    const feet = y1 + 1;
    return {
        x: clamp(cx - (CELL.w * SS) / 2, 0, frame.width - CELL.w * SS),
        y: clamp(feet - (CELL.h - FOOT) * SS, 0, frame.height - CELL.h * SS),
        w: CELL.w * SS, h: CELL.h * SS
    };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * Проекция мировой точки (x, y, z) в пиксели большого кадра; y растёт вниз, как
 * в canvas. Принимает именно координаты, а не матрицу: кулак — середина между
 * двумя костями, то есть точка, которой матрицы нет.
 */
function project(scene, frame, px, py, pz) {
    const basis = frame._basis, unit = frame._unit;
    const dot = (v) => ((px - basis.eye[0]) * v[0] + (py - basis.eye[1]) * v[1] + (pz - basis.eye[2]) * v[2]) * unit;
    return { x: frame.width / 2 + dot(basis.right), y: frame.height / 2 - dot(basis.up) };
}

/**
 * Точка хвата в пикселях ячейки. Середина между запястьем и первой фалангой
 * среднего пальца — это центр кулака; конец кости даёт предмет на предплечье.
 *
 * Вместе с точкой отдаём `ang` — экранное направление предплечя (локоть → кулак).
 * Предмет в руке поворачивается по нему, а не по векторной имитации замаха:
 * иначе клинок лежит поперёк предплечья, а в ударе смотрит в сторону от кисти.
 * Анимация уже содержит дугу — угол берётся из того же кадра.
 */
function handPoint(scene, frame, side) {
    const rig = scene.rig;
    const bone = name => rig.world[rig.nameToNode.get(name)];
    const wrist = bone(`hand_${side}`), knuckle = bone(`middle_01_${side}`), elbow = bone(`lowerarm_${side}`);
    const fist = [(wrist[12] + knuckle[12]) / 2, (wrist[13] + knuckle[13]) / 2, (wrist[14] + knuckle[14]) / 2];
    const f = project(scene, frame, ...fist), e = project(scene, frame, elbow[12], elbow[13], elbow[14]);
    // Насколько кисть ушла от камеры вдоль оси взгляда: больше = дальше. Это
    // единственный честный ответ на вопрос «какая рука ближняя» в данном кадре:
    // в анимации они меняются местами, а векторная имитация ракурса этого не знает.
    const b = frame._basis;
    const depth = (fist[0] - b.eye[0]) * b.fwd[0] + (fist[1] - b.eye[1]) * b.fwd[1] + (fist[2] - b.eye[2]) * b.fwd[2];
    // Открыта ли кисть наблюдателю. Буфер глубины растеризатора лежит в тех же
    // мировых единицах (view z = −глубина + depthBias), поэтому сравниваем «что
    // видно в пикселе кулака» с «насколько далеко сама кисть»: если видимая
    // поверхность ближе — кисть под телом, и предмет этого кадра обязан уйти ЗА
    // спрайт. Раньше порядок решал булев флаг `far` (векторная имитация ракурса),
    // и именно поэтому спереди предмет прятался за спиной, а сзади вылезал.
    return {
        x: (f.x - BOX.x) / SS,
        y: (f.y - BOX.y) / SS,
        ang: Math.atan2(f.x - e.x, e.y - f.y),
        depth: +depth.toFixed(3),
        hidden: handHidden(frame, f, e, depth)
    };
}

/**
 * Проверка «кисть под телом». Пробуем два пикселя: саму кисть и точку на 14 px
 * ближе центра тела вдоль предплечья — внутренний край предмета. Скрытой кисть
 * считается только когда закрыты оба: тогда предмет целиком по ту сторону
 * силуэта и рисовать его поверх спрайта нельзя. Частично прикрытая кисть
 * остаётся «спереди»: клинок, упирающийся в грудь, всё равно виден целиком.
 */
function handHidden(frame, f, e, depth) {
    const own = -depth;
    const ux = f.x - e.x, uy = f.y - e.y;
    const ul = Math.hypot(ux, uy) || 1;
    const at = (sx, sy) => {
        const x = Math.round(sx), y = Math.round(sy);
        if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return -Infinity;
        let best = -Infinity;
        for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
                const q = frame.depth[(y + dy) * frame.width + x + dx];
                if (q > best) best = q;
            }
        }
        return best;
    };
    const fist = at(f.x, f.y);
    const inner = at(f.x - (ux / ul) * 14, f.y - (uy / ul) * 14);
    // Порог = половина толщины кисти (проекция даёт ЦЕНТР ладони, а видимой
    // поверхностью всегда оказывается тыльная сторона той же ладони: 3–5 см).
    // Меньше 0.09 — и «скрыта» становится любая рука; больше 0.15 — перестают
    // видно прятаться кисти за спиной в боковых ракурсах.
    const MARGIN = 0.09;
    return (fist > own + MARGIN && inner > own + MARGIN) ? 1 : 0;
}

/**
 * Заполняющий свет на лицо. На 100-пиксельном герое лицо — это 12 px, и если оно
 * попадает в тень (а в этом паке брови, ноздри и теневой альбедо-слой дают почти
 * сплошную тёмную маску), то на экране остаётся чёрное пятно вместо лица — ровно
 * «где лицо?». Решение не косметическое, а светотехническое: пиксели кожи в радиусе
 * головы, яркость которых ниже среднего, поднимаются к светлой середине тона.
 * Волосы (дорожка hair) и глаза (свой материал, вне дорожек) не трогаем — иначе
 * лицо потеряло бы брови и стало бы плоским пятном.
 */
function headPoint(scene, frame) {
    const rig = scene.rig;
    const node = rig.nameToNode.get("Head");
    if (node === undefined) return null;
    const m = rig.world[node];
    const p = project(scene, frame, m[12], m[13], m[14]);
    return { x: p.x, y: p.y, r: 0.135 * UNIT };
}

const FACE_SKIN_FLOOR = 0.92;           // доля собственного тона кожи, которую лицо обязано показать
// Ниже этой доли яркости от цели — уже не тень, а черта лица; её не трогаем.
const FACE_FEATURE_FLOOR = 0.3;
function faceFill(frame, head) {
    if (!head) return;
    const r2 = head.r * head.r;
    const skin = TRACK_OF.skin;
    const base = hexRgb(LOOK.skin);
    const target = lum(base[0], base[1], base[2]) * FACE_SKIN_FLOOR;
    const x0 = Math.max(0, Math.floor(head.x - head.r)), x1 = Math.min(frame.width - 1, Math.ceil(head.x + head.r));
    const y0 = Math.max(0, Math.floor(head.y - head.r)), y1 = Math.min(frame.height - 1, Math.ceil(head.y + head.r));
    for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
            const dx = x - head.x, dy = (y - head.y) * 1.15;   // лицо чуть выше центра головы
            if (dx * dx + dy * dy > r2) continue;
            const i = y * frame.width + x;
            if (frame.track[i] !== skin) continue;
            const o = i * 4;
            if (frame.data[o + 3] < 40) continue;
            const L = frame.data[o] * 0.3 + frame.data[o + 1] * 0.59 + frame.data[o + 2] * 0.11;
            if (L >= target) continue;
            // Иные тёмные пиксели лица — это ЧЕРТЫ (брови, ресницы, ноздри, линия
            // рта), а не тень. Поднимать их нельзя: проверено, лицо становится
            // белым ovalом без глаз — то есть «лица нет», только светлого цвета.
            if (L < target * FACE_FEATURE_FLOOR) continue;
            // Подмешиваем тон кожи пропорционально недобору: тень на лице
            // остаётся тенью, но не чёрной. Полного замещения нет — иначе лицо
            // стало бы наклейкой и потеряло объём на развороте.
            const t = Math.min(0.42, (target - L) / Math.max(1, target) * 0.75);
            for (let c = 0; c < 3; c += 1) {
                frame.data[o + c] = frame.data[o + c] * (1 - t) + base[c] * t;
            }
        }
    }
}

/**
 * Глаза и брови — отдельным штампом поверх готового спрайта.
 *
 * Почему не через обычный пайплайн: меш глаз в источнике занимает 0.03 ед. высоты при
 * росте 1.81 ед., то есть ~1.7 px в большом кадре и меньше ОДНОГО пикселя
 * спрайта (ячейка 101×113). boxAverage размывает их в тот же тон, что и кожа,
 * и в игре лицо превращается в пустой овал — ровно «где лицо?». Поэтому
 * треугольники глаз/бровей растеризуются в сетку спрайта напрямую: пиксель,
 * которого касается черта, становится тёмным. Проверка глубины та же, что и для
 * кисти: если в этой точке спрайта видна поверхность ЗАМЕТНО ближе глаза, черта
 * скрыта (затылок, вид сзади) и рисовать её нельзя.
 */
/**
 * Кожа ли под пикселем? Именованные записи — это ещё половина ответа: у лица
 * в грейд-листе тон кожи лежит в ДОРОЖКЕ skin (её значения считает RAMP_AT), и
 * проверка только по именам отбрасывала нос с ртом на ровном месте — «лица нет»,
 * хотя штамп вызывался.
 */
function isFaceSkin(value) {
    if (!value || value === 255) return false;
    if (/skin/i.test(PALETTE_NAMES[value - 1] || "")) return true;
    const at = RAMP_AT.skin, steps = rampSteps("skin");
    return at !== undefined && value >= at && value < at + steps;
}

function stampFeatures(scene, frame, sprite) {
    const basis = frame._basis;
    const pos = SMOOTH ? SMOOTH_AT.hair : PALETTE.length;      // черта = самый тёмный тон
    const rgb = SMOOTH ? hexRgb(SMOOTH_HEX.hair[0]) : INK;
    const depthOf = (x, y, z) => -((x - basis.eye[0]) * basis.fwd[0] + (y - basis.eye[1]) * basis.fwd[1] + (z - basis.eye[2]) * basis.fwd[2]);
    const nodes = { eyes: [], brows: [] };
    for (const d of scene.drawables) {
        if (!d.feature || !d.jointWorld) continue;
        const m = d.jointWorld;
        for (let v = 0; v < d.count; v += 1) {
            let x = 0, y = 0, z = 0;
            for (let k = 0; k < 4; k += 1) {
                const w = d.weights ? d.weights[v * 4 + k] : 1;
                if (!w) continue;
                const mm = m[d.joints ? d.joints[v * 4 + k] : 0];
                if (!mm) continue;
                const ox = d.positions[v * 3], oy = d.positions[v * 3 + 1], oz = d.positions[v * 3 + 2];
                x += w * (mm[0] * ox + mm[4] * oy + mm[8] * oz + mm[12]);
                y += w * (mm[1] * ox + mm[5] * oy + mm[9] * oz + mm[13]);
                z += w * (mm[2] * ox + mm[6] * oy + mm[10] * oz + mm[14]);
            }
            const p = project(scene, frame, x, y, z);
            const bx = Math.round(p.x), by = Math.round(p.y);
            if (bx < 0 || by < 0 || bx >= frame.width || by >= frame.height) continue;
            if (frame.depth[by * frame.width + bx] > depthOf(x, y, z) + 0.03) continue;   // вершина скрыта телом
            nodes[d.feature].push({ x: (p.x - BOX.x) / SS, y: (p.y - BOX.y) / SS });
        }
    }
    /**
     * Штамп ПЯТНОМ, а не точкой. Прежняя версия ставила на глаз один пиксель —
     * при голове в 24 пикселя это две соринки, и лицо читалось пустым овалом
     * («нет лица» — владелец повторял это трижды). 2×1 на глаз + бровь 2×1
     * дают взгляд, который переживает и даунсэмплинг, и квантование палитры.
     */
    const SOFT = 2;                                               // inkSoft — тень, а не дыра
    const rgbSoft = hexRgb(PALETTE_NAMES[1]);
    const stamp = (x, y, w = 1, h = 1, color = null, index = null) => {
        const x0 = Math.round(x - (w - 1) / 2), y0 = Math.round(y - (h - 1) / 2);
        const col = color || rgb, at0 = index === null ? pos : index;
        for (let dy = 0; dy < h; dy += 1) {
            for (let dx = 0; dx < w; dx += 1) {
                const px = x0 + dx, py = y0 + dy;
                if (px < 0 || py < 0 || px >= CELL.w || py >= CELL.h) continue;
                const at = py * CELL.w + px;
                if (sprite.index[at] === 255) continue;             // в фон не рисуем
                // Бровь и глаз важнее «случайного» блика кожи, а вот нос и рот
                // только тогда, когда под ними всё ещё кожа: иначе улыбка
                // переползает в волосы и в профиль превращается в грязь.
                if (at0 === SOFT && !isFaceSkin(sprite.index[at])) continue;
                sprite.index[at] = at0;
                const o = at * 4;
                sprite.data[o] = col[0]; sprite.data[o + 1] = col[1]; sprite.data[o + 2] = col[2]; sprite.data[o + 3] = 255;
            }
        }
    };
    // По две точки: левая и правая сторона лица. Разделяем по центру головы — в
    // профиль обе группы слипаются в одну, и тогда ставится одна точка (это
    // правильно: второй глаз в профиль не виден).
    const head = headPoint(scene, frame);
    const cx = head ? (head.x - BOX.x) / SS : CELL.w / 2;
    const clusters = (list) => {
        if (!list.length) return [];
        const left = list.filter(p => p.x < cx), right = list.filter(p => p.x >= cx);
        return [left, right].filter(g => g.length).map(g => ({
            x: g.reduce((a, p) => a + p.x, 0) / g.length,
            y: g.reduce((a, p) => a + p.y, 0) / g.length
        }));
    };
    const eyeC = clusters(nodes.eyes), browC = clusters(nodes.brows);
    for (const e of eyeC) stamp(e.x, e.y, 2, 1);
    // Брови — на строку ВЫШЕ своего центра, но не ниже уровня глаз: иначе в
    // наклоне головы они сливаются с глазами в одну полосу (первая версия
    // именно так и делала — лицо выглядело повязкой).
    for (const b of browC) stamp(b.x, Math.min(b.y - 1, (eyeC[0] ? eyeC[0].y : b.y) - 2), 2, 1);
    // Нос и рот — только в анфас и 3/4 (оба глаза видны раздельно). В профиль
    // они легли бы на щёку. Рот — тенью на 2 пикселя шире центра глаз.
    if (eyeC.length === 2) {
        const nx = (eyeC[0].x + eyeC[1].x) / 2, ny = (eyeC[0].y + eyeC[1].y) / 2;
        stamp(nx, ny + 2, 1, 1, rgbSoft, SOFT);                    // кончик носа
        stamp(nx, ny + 4, 3, 1, rgbSoft, SOFT);                    // рот
    }
    return eyeC.length + browC.length;
}
/** Пиксель ячейки → игровые единицы: 2 px спрайта = 1 единица, ноль — линия стоп. */
function toUnits(px, py) {
    return { x: (px - CELL.w / 2) / PX_PER_UNIT, y: (py - (CELL.h - FOOT)) / PX_PER_UNIT };
}

/**
 * Кулак поверх рукояти. Патч — это прямоугольник в пикселях ячейки: всё, что
 * спрайт имеет вокруг кисти. Рантайм возвращает этот кусок на место ПОСЛЕ того,
 * как нарисовал предмет, и тогда пальцы лежат на рукояти, а не предмет поверх
 * пальцев (именно так нож годами выглядел наклеенным на тыльную сторону ладони).
 * Берём только непрозрачные пиксели: в фон патч не должен тянуть ничего.
 */
const GRIP_R = 4;
function gripPatch(sprite, cell) {
    if (!cell) return null;
    // handPoint уже привёл координаты к пикселям ячейки (снял BOX и SS).
    const cx = Math.round(cell.x), cy = Math.round(cell.y);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = Math.max(0, cy - GRIP_R); y <= Math.min(CELL.h - 1, cy + GRIP_R); y += 1) {
        for (let x = Math.max(0, cx - GRIP_R); x <= Math.min(CELL.w - 1, cx + GRIP_R); x += 1) {
            if (!sprite.index[y * CELL.w + x]) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    if (x1 < x0 || y1 < y0) return null;
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

function gradeFrame(frame) {
    const { sat, mul, lift, cool } = GRADE;
    const d = frame.data;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const grey = r * 0.30 + g * 0.59 + b * 0.11;
        let rr = (grey + (r - grey) * sat) * mul + lift;
        let gg = (grey + (g - grey) * sat) * mul + lift;
        let bb = (grey + (b - grey) * sat) * mul + lift;
        // чуть холоднее в тенях: мир пепельный, тёплая кожа обязана тонуть в нём постепенно
        const shade = 1 - Math.min(1, (rr + gg + bb) / 600);
        bb += shade * cool * 40;
        gg += shade * cool * 12;
        d[i] = rr; d[i + 1] = gg; d[i + 2] = bb;
    }
    return frame;
}

/**
 * Для каждого пикселя спрайта смотрим, каким материалом он получился в 3D-кадре,
 * и заменяем цвет на ближайший по яркости тон дорожки. Голосуем по всем SS×SS
 * сэмплам ячейки: если материал не набрал большинства, пиксель остаётся в общей
 * палитре — так граница одежды и кожи не превращается в рябых призраков.
 *
 * Второй проход (растяжка) важнее, чем кажется. Яркость пикселя приходит из
 * исходной текстуры, а у неё своё освещение и свой контраст: светлые волосы
 * запечены яркими и легли бы в верхний тон дорожки целиком — то есть седыми,
 * каким бы цветом их ни выбрал игрок. Поэтому диапазон яркости каждой дорожки
 * measured по перцентилям 2/98 и растягивается на диапазон самих тонов:
 * света и тени остаются как есть, но средний пиксель попадает в базовый цвет.
 * Плоскую дорожку (разбег меньше 18 единиц) не трогаем — растягивать нечего,
 * только шум усилить.
 */
const HIST = 64;
const STRETCH_KEYS = ["hair"];
function applyRamps(sprite, frame) {
    const lums = {}, rgb = {};
    for (const key of RAMP_KEYS) {
        const hexes = rampHexes(key, LOOK[RAMPS[key].look]);
        rgb[key] = hexes.map(hexRgb);
        lums[key] = hexes.map(hex => { const c = hexRgb(hex); return lum(c[0], c[1], c[2]); });
    }
    const total = SS * SS;
    const winOf = new Uint8Array(CELL.w * CELL.h);
    const lOf = new Float32Array(CELL.w * CELL.h);
    const hist = TRACK_NAME.map(() => new Int32Array(HIST));

    for (let y = 0; y < CELL.h; y += 1) {
        for (let x = 0; x < CELL.w; x += 1) {
            const votes = TRACK_NAME.map(() => 0);
            const lsum = TRACK_NAME.map(() => 0);
            for (let dy = 0; dy < SS; dy += 1) {
                for (let dx = 0; dx < SS; dx += 1) {
                    const fi = (BOX.y + y * SS + dy) * frame.width + (BOX.x + x * SS + dx);
                    const t = frame.track[fi];
                    if (!t) continue;
                    votes[t] += 1;
                    const o = fi * 4;
                    lsum[t] += lum(frame.data[o], frame.data[o + 1], frame.data[o + 2]);
                }
            }
            // Побеждает материал с большинством, но планка не строга: тонкая прядь
            // волос или манжет на границе никогда не наберут половины сэмплов, а
            // красить их надо — иначе светлые волосы остаются тёмными по краям.
            let win = 0;
            for (let t = 1; t < TRACK_NAME.length; t += 1) if (votes[t] > total * 0.3 && votes[t] > votes[win]) win = t;
            if (!win) continue;
            const at = y * CELL.w + x;
            const L = lsum[win] / Math.max(1, votes[win]);
            winOf[at] = win;
            lOf[at] = L;
            hist[win][Math.min(HIST - 1, (L / 256 * HIST) | 0)] += 1;
        }
    }

    const range = {};
    for (let t = 1; t < TRACK_NAME.length; t += 1) {
        // Растягиваем не все дорожки: у куртки и кожи собственный мягкий свет и так
        // попадает в середину веера, а лишний контраст стоит байтов (RLE хуже
        // сжимает шашлык тонов). Волосы — другое дело: они запечены почти плоским
        // светлым пятном, и без растяжки любой выбранный цвет становится седым.
        if (!STRETCH_KEYS.includes(TRACK_NAME[t])) continue;
        const h = hist[t];
        let n = 0;
        for (let i = 0; i < HIST; i += 1) n += h[i];
        if (n < 12) continue;
        const cut = Math.max(1, Math.round(n * 0.02));
        let lo = 0, acc = 0;
        while (lo < HIST - 1 && (acc += h[lo]) < cut) lo += 1;
        let hi = HIST - 1; acc = 0;
        while (hi > 0 && (acc += h[hi]) < cut) hi -= 1;
        const span = (hi + 1 - lo) * 256 / HIST;
        if (span < 18) continue;                       // дорожка и так плоская
        range[TRACK_NAME[t]] = [lo * 256 / HIST, span];
    }

    for (let y = 0; y < CELL.h; y += 1) {
        for (let x = 0; x < CELL.w; x += 1) {
            const at = y * CELL.w + x;
            const win = winOf[at];
            if (!win) continue;
            const key = TRACK_NAME[win];
            const steps = lums[key];
            let L = lOf[at];
            const r = range[key];
            if (r) L = steps[0] + ((L - r[0]) / r[1]) * (steps[steps.length - 1] - steps[0]);
            // Дизеринг между тонами: без него кожа на предплечье ложится полосами.
            L += (BAYER2[y & 1][x & 1] / 4 - 0.5) * (255 / steps.length) * 0.9;
            let bin = 0;
            let best = Infinity;
            for (let i = 0; i < steps.length; i += 1) {
                const d = Math.abs(steps[i] - L);
                if (d < best) { best = d; bin = i; }
            }
            sprite.index[at] = RAMP_AT[key] + bin;
            const c = rgb[key][bin];
            const px = at * 4;
            sprite.data[px] = c[0]; sprite.data[px + 1] = c[1]; sprite.data[px + 2] = c[2]; sprite.data[px + 3] = 255;
        }
    }
    return sprite;
}

/* --------------------------- «гладкий» выход (без грейда) --------------------------- */

/**
 * Плавная дорожка: те же концы веера, что и у пиксельного режима, но 20 шагов
 * вместо 3–5. shadeHex двигает яркость аддитивно, поэтому люма тона = люма базы +
 * offset, и выбор шага сводится к делению отрезка — никакого поиска минимума.
 */
const SMOOTH_OFFS = {};
const SMOOTH_HEX = {};
const SMOOTH_LUM = {};
const SMOOTH_AT = {};
{
    let at = PALETTE.length;
    for (const key of RAMP_KEYS) {
        const offs = RAMPS[key].offsets;
        const lo = Math.min(...offs), hi = Math.max(...offs);
        const list = [];
        for (let i = 0; i < SMOOTH_STEPS; i += 1) list.push(lo + (hi - lo) * (i / (SMOOTH_STEPS - 1)));
        SMOOTH_OFFS[key] = list;
        const base = LOOK[RAMPS[key].look];
        SMOOTH_HEX[key] = list.map(off => shadeHex(base, off));
        SMOOTH_LUM[key] = SMOOTH_HEX[key].map(hex => { const c = hexRgb(hex); return lum(c[0], c[1], c[2]); });
        SMOOTH_AT[key] = at;
        at += SMOOTH_STEPS;
    }
}
/** Палитра гладкого выхода: общая палитра игры + плавные дорожки сверху. */
const SMOOTH_PALETTE_HEX = [
    ...Object.entries(labPalette).filter(([, v]) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)).map(([, v]) => v),
    ...RAMP_KEYS.flatMap(key => SMOOTH_HEX[key])
];

/**
 * Как applyRamps, но иначе: во-первых, percentile-растяжка по ВСЕМ дорожкам (на
 * 20 шагах полосование видно, и без растяжки куртка остаётся плоским пятном),
 * во-вторых — ни BAYER2, ни обводки. Пиксели вне дорожек (глаза, пряжка)
 * остаются в общей палитре: их цвет про одежду не рассказывает.
 */
function applySmooth(sprite, frame) {
    const total = SS * SS;
    const winOf = new Uint8Array(CELL.w * CELL.h);
    const lOf = new Float32Array(CELL.w * CELL.h);
    const hist = TRACK_NAME.map(() => new Int32Array(HIST));
    for (let y = 0; y < CELL.h; y += 1) {
        for (let x = 0; x < CELL.w; x += 1) {
            const votes = TRACK_NAME.map(() => 0);
            const lsum = TRACK_NAME.map(() => 0);
            for (let dy = 0; dy < SS; dy += 1) {
                for (let dx = 0; dx < SS; dx += 1) {
                    const fi = (BOX.y + y * SS + dy) * frame.width + (BOX.x + x * SS + dx);
                    const t = frame.track[fi];
                    if (!t) continue;
                    votes[t] += 1;
                    const o = fi * 4;
                    lsum[t] += lum(frame.data[o], frame.data[o + 1], frame.data[o + 2]);
                }
            }
            let win = 0;
            for (let t = 1; t < TRACK_NAME.length; t += 1) if (votes[t] > total * 0.3 && votes[t] > votes[win]) win = t;
            if (!win) continue;
            const at = y * CELL.w + x;
            const L = lsum[win] / Math.max(1, votes[win]);
            winOf[at] = win;
            lOf[at] = L;
            hist[win][Math.min(HIST - 1, (L / 256 * HIST) | 0)] += 1;
        }
    }
    const range = {};
    for (let t = 1; t < TRACK_NAME.length; t += 1) {
        const h = hist[t];
        let n = 0;
        for (let i = 0; i < HIST; i += 1) n += h[i];
        if (n < 12) continue;
        const cut = Math.max(1, Math.round(n * 0.01));
        let lo = 0, acc = 0;
        while (lo < HIST - 1 && (acc += h[lo]) < cut) lo += 1;
        let hi = HIST - 1; acc = 0;
        while (hi > 0 && (acc += h[hi]) < cut) hi -= 1;
        const span = (hi + 1 - lo) * 256 / HIST;
        if (span < 10) continue;
        range[TRACK_NAME[t]] = [lo * 256 / HIST, span];
    }
    for (let y = 0; y < CELL.h; y += 1) {
        for (let x = 0; x < CELL.w; x += 1) {
            const at = y * CELL.w + x;
            const win = winOf[at];
            if (!win) continue;
            const key = TRACK_NAME[win];
            const lums = SMOOTH_LUM[key];
            const base = lums[0];
            let L = lOf[at];
            const r = range[key];
            if (r) L = base + ((L - r[0]) / r[1]) * (lums[lums.length - 1] - base);
            const lo = lums[0], hi = lums[lums.length - 1];
            const t = Math.max(0, Math.min(1, (L - lo) / Math.max(1e-6, hi - lo)));
            const bin = Math.round(t * (SMOOTH_STEPS - 1));
            sprite.index[at] = SMOOTH_AT[key] + bin;
            const c = hexRgb(SMOOTH_HEX[key][bin]);
            const px = at * 4;
            sprite.data[px] = c[0]; sprite.data[px + 1] = c[1]; sprite.data[px + 2] = c[2]; sprite.data[px + 3] = 255;
        }
    }
    return sprite;
}

/**
 * Зашиваем замкнутые пустоты. Часть из — не дыры в смысле геометрии, а стыки:
 * там, где куртка примыкает к рукаву, бокс-фильтр 4×4 видит две поверхности с
 * антиалиасом и решает, что пиксель пустой. На экране это дырка в землю внутри
 * тела, и никакая утяжка подкладки её не убирает. Лечение честное: пиксель,
 * окружённый силуэтом со всех сторон, не может быть фоном — берём цвет соседа.
 * Проходов нужно несколько: цепочки дыр закрываются итеративно.
 */
function closeHoles(sprite, passes = 3) {
    const w = CELL.w, h = CELL.h;
    for (let p = 0; p < passes; p += 1) {
        const enclosed = new Uint8Array(w * h);
        const seen = new Uint8Array(w * h);
        const stack = [];
        for (let x = 0; x < w; x += 1) stack.push(x, (h - 1) * w + x);
        for (let y = 0; y < h; y += 1) stack.push(y * w, y * w + w - 1);
        while (stack.length) {
            const q = stack.pop();
            if (q < 0 || q >= w * h || seen[q] || sprite.index[q] !== 255) continue;
            seen[q] = 1;
            const x = q % w;
            if (x > 0) stack.push(q - 1);
            if (x < w - 1) stack.push(q + 1);
            stack.push(q - w, q + w);
        }
        let fixed = 0;
        for (let i = 0; i < w * h; i += 1) {
            if (sprite.index[i] !== 255 || seen[i]) continue;
            const x = i % w, y = (i / w) | 0;
            const around = [i - 1, i + 1, i - w, i + w].filter(q => q >= 0 && q < w * h && (Math.abs(q % w - x) <= 1));
            let pick = -1;
            for (const q of around) if (sprite.index[q] !== 255) { pick = q; break; }
            if (pick < 0) { continue; }
            enclosed[i] = 1;
            sprite.index[i] = sprite.index[pick];
            const a = i * 4, b = pick * 4;
            sprite.data[a] = sprite.data[b]; sprite.data[a + 1] = sprite.data[b + 1];
            sprite.data[a + 2] = sprite.data[b + 2]; sprite.data[a + 3] = 255;
            fixed += 1;
        }
        if (!fixed) break;
    }
    return sprite;
}

/**
 * Замкнутые пустоты кадра: пиксели, до которых flood-fill пустоты с края кадра
 * не дошёл. Через них в игре видна земля — ровно то, что владелец назвал
 * «просвечивающими пикселями» на одежде, спине, волосах и ботинках. Считаем и
 * для сырого рендера, и для спрайта: если дырки уже в сырье — виноват
 * альфа-тест текстуры или отвернутые грани, если только в спрайте — квантизация.
 */
function enclosedHoles(alphaAt, w, h) {
    const empty = (i) => alphaAt(i) < 40;
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (let x = 0; x < w; x += 1) stack.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y += 1) stack.push(y * w, y * w + w - 1);
    while (stack.length) {
        const q = stack.pop();
        if (q < 0 || q >= w * h || seen[q] || !empty(q)) continue;
        seen[q] = 1;
        const x = q % w;
        if (x > 0) stack.push(q - 1);
        if (x < w - 1) stack.push(q + 1);
        stack.push(q - w, q + w);
    }
    let n = 0;
    const where = [];
    for (let i = 0; i < w * h; i += 1) {
        if (!empty(i) || seen[i]) continue;
        n += 1;
        if (where.length < 4) where.push(`${i % w},${(i / w) | 0}`);
    }
    return { n, where };
}

function measureHoles() {
    const scene = buildScene();
    const anim = loadAnimLibs();
    const anchor = renderRaw(scene, anim, { yaw: 0, time: 0, clip: "A_TPose" });
    BOX = anchorBoxFrom(anchor);
    let totalRaw = 0, totalSprite = 0, bad = [];
    for (const dir of DIRS) {
        for (const pose of POSES.filter(x => x.ship)) {
            const duration = clipDuration(anim, pose.clip) || 1;
            for (let i = 0; i < Math.min(2, pose.frames); i += 1) {
                const t = (i / pose.frames) * duration * 0.98;
                const raw = gradeFrame(renderRaw(scene, anim, { yaw: dir.yaw, time: t, clip: pose.clip }));
                const rawCut = { x: BOX.x, y: BOX.y };
                const holeRaw = enclosedHoles((cell) => {
                    const x = cell % CELL.w, y = (cell / CELL.w) | 0;
                    // на уровне большого кадра: максимум альфы внутри ячейки, иначе
                    // антиалиасованный край посчитается дыркой
                    let a = 0;
                    for (let dy = 0; dy < SS; dy += 1) for (let dx = 0; dx < SS; dx += 1) {
                        const fi = (rawCut.y + y * SS + dy) * raw.width + (rawCut.x + x * SS + dx);
                        a = Math.max(a, raw.data[fi * 4 + 3]);
                    }
                    return a;
                }, CELL.w, CELL.h);
                const sprite = spriteFromPixels(
                    { data: raw.data, w: raw.width, h: raw.height },
                    { grid: { w: CELL.w, h: CELL.h }, mode: "palette", palette: PALETTE, ink: INK, dither: Number(opt("dither", 0.2)), outlineWidth: Number(opt("outline", 2)), outline: true, box: BOX }
                );
                const holeSprite = sprite ? enclosedHoles((cell) => (sprite.index[cell] === 255 ? 0 : 255), CELL.w, CELL.h) : { n: 0, where: [] };
                if (sprite) closeHoles(sprite);
                const holeAfter = sprite ? enclosedHoles((cell) => (sprite.index[cell] === 255 ? 0 : 255), CELL.w, CELL.h) : { n: 0, where: [] };
                totalRaw += holeRaw.n; totalSprite += holeSprite.n;
                if (holeAfter.n || holeSprite.n) bad.push(`${dir.name}/${pose.label}#${i}: до зашивки ${holeSprite.n} ${holeSprite.where.join(" ")} | после ${holeAfter.n} ${holeAfter.where.join(" ")}`);
            }
        }
    }
    console.log(`HOLES: сырых дыр ${totalRaw}, спрайт до зашивки ${totalSprite}`);
    bad.sort((a, b) => parseInt(b.split("| ")[1], 10) - parseInt(a.split("| ")[1], 10));
    for (const line of bad.slice(0, 10)) console.log(`   ${line}`);
    if (!bad.length) console.log("   ✅ замкнутых пустот нет");
}

function bakeAll() {
    const scene = buildScene();
    const anim = loadAnimLibs();
    const anchor = renderRaw(scene, anim, { yaw: 0, time: 0, clip: "A_TPose" });
    BOX = anchorBoxFrom(anchor);
    const frames = {};
    const sprites = [];
    const anchorsByPose = new Map();
    const gripsByPose = new Map();
    const occlByPose = new Map();
    for (const dir of DIRS) {
        frames[dir.name] = {};
        for (const pose of POSES) {
            const duration = clipDuration(anim, pose.clip) || 1;
            const cells = [];
            const anchors = { r: [], l: [] };
            const grips = { r: [], l: [] };
            const occl = { r: [], l: [] };
            for (let i = 0; i < pose.frames; i += 1) {
                const t = (i / pose.frames) * duration * 0.98;
                const raw = gradeFrame(renderRaw(scene, anim, { yaw: dir.yaw, time: t, clip: pose.clip }));
                faceFill(raw, headPoint(scene, raw));          // свет до квантизации, иначе лицо уже не спасти
                const sprite = spriteFromPixels(
                    { data: raw.data, w: raw.width, h: raw.height },
                    { grid: { w: CELL.w, h: CELL.h }, mode: "palette", palette: PALETTE, ink: INK,
                      dither: SMOOTH ? 0 : Number(opt('dither', 0.14)),
                      outlineWidth: SMOOTH ? 0 : Number(opt('outline', 2)),
                      outline: !SMOOTH, box: BOX }
                );
                if (!sprite) throw new Error(`пустой кадр ${dir.name}/${pose.clip}#${i}`);
                if (SMOOTH) applySmooth(sprite, raw); else applyRamps(sprite, raw);
                stampFeatures(scene, raw, sprite);   // глаза и брови — поверх палитры
                closeHoles(sprite);                // стыки и антиалиас не должны дырявить тело
                cells.push(sprite);
                for (const side of ["r", "l"]) {
                    const cell = handPoint(scene, raw, side);
                    const a = toUnits(cell.x, cell.y);
                    // x/y — в игровых единицах (их даёт toUnits), угол — экранный,
                    // он не зависит от масштаба: пиксели и единицы растянуты одинаково.
                    anchors[side].push([+a.x.toFixed(2), +a.y.toFixed(2), +cell.ang.toFixed(3), cell.depth]);
                    occl[side].push(cell.hidden ? 1 : 0);
                    grips[side].push(gripPatch(sprite, cell));
                }
                sprites.push({ dir: dir.name, pose: pose.label, index: i, sprite });
            }
            frames[dir.name][pose.label] = cells;
            anchorsByPose.set(`${dir.name}/${pose.label}`, anchors);
            gripsByPose.set(`${dir.name}/${pose.label}`, grips);
            occlByPose.set(`${dir.name}/${pose.label}`, occl);
        }
        process.stdout.write(`  ${dir.name} ok\n`);
    }
    return { frames, sprites, anchors: Object.fromEntries(anchorsByPose), grips: Object.fromEntries(gripsByPose),
        occl: Object.fromEntries(occlByPose) };
}

function contactSheet(sprites, zoom) {
    const perRow = 8;
    const rows = Math.ceil(sprites.length / perRow);
    const cell = { w: CELL.w * zoom, h: CELL.h * zoom };
    const sheet = new ShimCanvas(perRow * (cell.w + 2) + 2, rows * (cell.h + 2) + 2);
    for (let i = 0; i < sheet.data.length; i += 4) {
        sheet.data[i] = 22; sheet.data[i + 1] = 30; sheet.data[i + 2] = 21; sheet.data[i + 3] = 255;
    }
    sprites.forEach((item, n) => {
        const ox = 2 + (n % perRow) * (cell.w + 2);
        const oy = 2 + Math.floor(n / perRow) * (cell.h + 2);
        const s = item.sprite;
        for (let y = 0; y < s.h; y += 1) {
            for (let x = 0; x < s.w; x += 1) {
                const si = (y * s.w + x) * 4;
                if (s.data[si + 3] < 8) continue;
                for (let oy2 = 0; oy2 < zoom; oy2 += 1) {
                    for (let ox2 = 0; ox2 < zoom; ox2 += 1) {
                        const t = ((oy + y * zoom + oy2) * sheet.width + ox + x * zoom + ox2) * 4;
                        sheet.data[t] = s.data[si]; sheet.data[t + 1] = s.data[si + 1];
                        sheet.data[t + 2] = s.data[si + 2]; sheet.data[t + 3] = 255;
                    }
                }
            }
        }
    });
    return sheet;
}

function preview() {
    const scene = buildScene();
    const anim = loadAnimLibs();
    const cells = [];
    for (const dir of DIRS) {
        for (const [label, clip, t] of [["T", "A_TPose", 0], ["idle", "Idle_Loop", 0.4], ["walk", "Walk_Loop", 0.25]]) {
            cells.push({ label: `${dir.name} · ${label}`, frame: renderRaw(scene, anim, { yaw: dir.yaw, time: t, clip }) });
        }
    }
    const cw = cells[0].frame.width; const ch = cells[0].frame.height;
    const cols = 3; const rows = Math.ceil(cells.length / cols); const pad = 6;
    const sheet = new ShimCanvas(cols * (cw + pad) + pad, rows * (ch + pad) + pad);
    sheet.data.fill(18);
    cells.forEach((cell, i) => {
        const ox = pad + (i % cols) * (cw + pad);
        const oy = pad + Math.floor(i / cols) * (ch + pad);
        for (let y = 0; y < ch; y += 1) {
            for (let x = 0; x < cw; x += 1) {
                const s = (y * cw + x) * 4;
                const d = ((oy + y) * sheet.width + ox + x) * 4;
                if (cell.frame.data[s + 3] < 8) continue;
                sheet.data[d] = cell.frame.data[s]; sheet.data[d + 1] = cell.frame.data[s + 1];
                sheet.data[d + 2] = cell.frame.data[s + 2]; sheet.data[d + 3] = 255;
            }
        }
    });
    fs.mkdirSync(path.resolve(".artifacts"), { recursive: true });
    const file = path.join(path.resolve(".artifacts"), "hero-bake-preview.png");
    fs.writeFileSync(file, encodePNG(sheet, [18, 18, 18]));
    console.log(`PREVIEW: ${cells.length} кадров ${cw}×${ch} → ${file}`);
}

/** Кадры → RLE-поток: (count, value), value 0 = пусто, 1..N = индекс палитры (N+1 = обводка). */
function encodeFrames(frames) {
    const streams = {};
    for (const [dir, poses] of Object.entries(frames)) {
        streams[dir] = {};
        for (const [label, cells] of Object.entries(poses)) {
            const bytes = [];
            for (const sprite of cells) {
                const total = sprite.w * sprite.h;
                let at = 0;
                while (at < total) {
                    const value = sprite.index[at];
                    let run = 1;
                    while (at + run < total && sprite.index[at + run] === value && run < 255) run += 1;
                    bytes.push(run, value === 255 ? 0 : value + 1);
                    at += run;
                }
            }
            streams[dir][label] = Buffer.from(bytes).toString("base64");
        }
    }
    return streams;
}

function emit(baked) {
    const shipPoses = POSES.filter(x => x.ship).map(x => x.label);
    const frames = {};
    for (const [dir, poses] of Object.entries(baked.frames)) {
        frames[dir] = {};
        for (const label of shipPoses) frames[dir][label] = poses[label];
    }
    const ship = (key) => shipPoses.includes(key.split("/")[1]);
    const anchors = {};
    for (const [key, value] of Object.entries(baked.anchors)) {
        if (ship(key)) anchors[key] = value;
    }
    const grips = {};
    for (const [key, value] of Object.entries(baked.grips || {})) {
        if (ship(key)) grips[key] = value;
    }
    const occl = {};
    for (const [key, value] of Object.entries(baked.occl || {})) {
        if (ship(key)) occl[key] = value;
    }
    const streams = encodeFrames(frames);
    const meta = {
        who: who(), source: "Quaternius Universal Base Characters + Universal Animation Pack (CC0)",
        baked: new Date().toISOString().slice(0, 10), tool: "tools/hero-bake.js",
        cell: CELL, pxPerUnit: PX_PER_UNIT, footPad: FOOT, heroPx: CELL.h,
        bodyUnits: BODY_UNITS,
        poses: POSES.filter(p => p.ship).map(p => ({ label: p.label, clip: p.clip, frames: p.frames, fps: p.fps })),
        anchors,
        grips,
        occl,
        ramps: RAMP_KEYS.reduce((m, k) => {
            m[k] = { at: RAMP_AT[k], steps: rampSteps(k), look: RAMPS[k].look, offsets: RAMPS[k].offsets };
            return m;
        }, {}),
        inkAt: INK_AT,
        dirs: DIRS.map(d => d.name),
        palette: Object.entries(labPalette).filter(([, v]) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)).map(([k, v]) => [k, v])
    };
    const lines = [];
    lines.push("/**");
    lines.push(" * js/render/heroframes.js — ЗАПЕЧЕННЫЕ кадры героя. Не править руками: файл собирает");
    lines.push(" * `node tools/hero-bake.js --emit [--emit-file <путь>]` из 3D-рига Quaternius (CC0). Источник —");
    lines.push(" * dev/character-style-lab/assets/quaternius; палитра — та же, что в лаборатории.");
    lines.push(" *");
    lines.push(" * Хранение: на кадр — RLE-пары (длина, значение); 0 = пусто, 1…N — индекс палитры,");
    lines.push(" * N+1 — цвет обводки. Так модуль остаётся текстовым, грузится без fetch и одинаково");
    lines.push(" * работает и в браузере, и в headless-рендере инструментов.");
    lines.push(" */");
    lines.push(`export const META = ${JSON.stringify(meta)};`);
    lines.push("");
    const hexOf = (c) => `#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`;
    const full = [...meta.palette.map(([, hex]) => hex), hexOf(INK),
        ...RAMP_KEYS.flatMap(k => rampHexes(k, LOOK[RAMPS[k].look]))];
    lines.push(`export const PALETTE_HEX = ${JSON.stringify(full)};`);
    lines.push(`export const INK_HEX = "#1c1610";`);
    lines.push("");
    lines.push("/** base64-RLE на связку (направление,пока): \"down/idle\": \"…\" */");
    lines.push(`export const STREAMS = ${JSON.stringify(encodeFlat(streams), null, 0)};`);
    lines.push("");
    fs.mkdirSync(path.dirname(path.resolve(EMIT_FILE)), { recursive: true });
    fs.writeFileSync(EMIT_FILE, `${lines.join("\n")}\n`);
    const bytes = fs.statSync(EMIT_FILE).size;
    const shipped = DIRS.length * shipPoses.length;
    console.log(`EMIT: ${EMIT_FILE} — ${(bytes / 1024).toFixed(0)} KB, ${shipped} связок (${shipPoses.join(", ")})`);
}

/** Гладкий выход — отдельный модуль: сравнивать варианты удобнее, не трогая то, что играет сейчас. */
function emitSmooth(baked) {
    const file = SMOOTH_FILE;
    const frames = {};
    for (const [dir, poses] of Object.entries(baked.frames)) {
        frames[dir] = {};
        for (const label of SMOOTH_POSES) if (poses[label]) frames[dir][label] = poses[label];
    }
    const keep = key => SMOOTH_POSES.includes(key.split("/")[1]);
    const anchors = {}, grips = {}, occl = {};
    for (const [key, value] of Object.entries(baked.anchors)) if (keep(key)) anchors[key] = value;
    for (const [key, value] of Object.entries(baked.grips || {})) if (keep(key)) grips[key] = value;
    for (const [key, value] of Object.entries(baked.occl || {})) if (keep(key)) occl[key] = value;
    const meta = {
        who: who(), smooth: true, steps: SMOOTH_STEPS,
        source: "Quaternius Universal Rig (CC0), тот же запек, но без дизеринга и обводки",
        baked: new Date().toISOString().slice(0, 10), tool: "tools/hero-bake.js --smooth --emit-smooth",
        cell: CELL, pxPerUnit: PX_PER_UNIT, footPad: FOOT, heroPx: CELL.h, bodyUnits: BODY_UNITS,
        poses: POSES.filter(p => SMOOTH_POSES.includes(p.label)).map(p => ({ label: p.label, clip: p.clip, frames: p.frames, fps: p.fps })),
        anchors, grips, occl, dirs: DIRS.map(d => d.name),
        // Дорожек нет: цвет одежды в этом режиме запечён, панель внешности на него не влияет
        // (и не должна — сравнивают-то силуэт и посадку, а не палитру).
        palette: SMOOTH_PALETTE_HEX.map(hex => [hex, hex])
    };
    const lines = [];
    lines.push("/**");
    lines.push(" * js/render/herosmooth.js — тот же 3D-риг, но БЕЗ пиксельного грейда.");
    lines.push(" * Собирает `node tools/hero-bake.js --smooth --emit-smooth`. Формат совпадает с");
    lines.push(" * heroframes.js (те же ячейка, опора, якоря кистей и патчи кулака), поэтому");
    lines.push(" * hero3d.js переключается между вариантами одной строкой, а сцена и предметы");
    lines.push(" * не сдвигаются ни на пиксель — сравнивать можно в упор.");
    lines.push(" */");
    lines.push(`export const META = ${JSON.stringify(meta)};`);
    lines.push("");
    lines.push(`export const PALETTE_HEX = ${JSON.stringify(SMOOTH_PALETTE_HEX)};`);
    lines.push(`export const INK_HEX = "${SMOOTH_PALETTE_HEX[0]}";`);
    lines.push("");
    lines.push(`export const STREAMS = ${JSON.stringify(encodeFlat(encodeFrames(frames)), null, 0)};`);
    lines.push("");
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
    const bytes = fs.statSync(file).size;
    console.log(`SMOOTH: ${file} — ${(bytes / 1024).toFixed(0)} KB, ${DIRS.length * SMOOTH_POSES.length} связок по ${SMOOTH_STEPS} тонов на дорожку, без обводки`);
}

function encodeFlat(streams) {
    const flat = {};
    for (const [dir, poses] of Object.entries(streams)) {
        for (const [label, b64] of Object.entries(poses)) flat[`${dir}/${label}`] = b64;
    }
    return flat;
}

fs.mkdirSync(OUT, { recursive: true });
if (flag("preview")) {
    preview();
} else if (SMOOTH_FILE) {
    const t0 = Date.now();
    emitSmooth(bakeAll());
    console.log(`     (${((Date.now() - t0) / 1000).toFixed(1)} с)`);
} else if (flag("poses") || flag("emit")) {
    const t0 = Date.now();
    const baked = bakeAll();
    fs.writeFileSync(path.join(OUT, "sheet-1x.png"), encodePNG(contactSheet(baked.sprites, 1), [22, 30, 21]));
    fs.writeFileSync(path.join(OUT, "sheet-2x.png"), encodePNG(contactSheet(baked.sprites, 2), [22, 30, 21]));
    console.log(`SHEET: ${baked.sprites.length} кадров → ${OUT}/sheet-1x.png, sheet-2x.png (${((Date.now() - t0) / 1000).toFixed(1)} с)`);
    if (flag("emit")) emit(baked);
} else if (flag("holes")) {
    measureHoles();
} else if (flag("fit")) {
    measureFit(buildScene(), loadAnimLibs());
} else {
    console.log("режимы: --preview | --poses | --emit | --fit");
}
