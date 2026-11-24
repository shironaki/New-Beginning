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
    // Тот же ключ --hair задаёт и имя мешка, и цвет — отсюда путаница в пробах.
    // haircolor перебивает только цвет.
    hair: opt("haircolor", opt("hair", "#302b29")),
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
const PARTS = [
    { file: () => path.join(ASSETS, "char", `Superhero_${WHO}_FullBody.gltf`), role: "body", bias: 0, headOnly: true },
    { file: () => (OUTFIT ? path.join(ASSETS, "outfits", `${OUTFIT}.glb`) : null), role: "clothes", bias: 0.002 },
    { file: () => (HAIR ? path.join(ASSETS, "hair", `${HAIR}.glb`) : null), role: "hair", bias: 0.006 }
];
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
    for (const part of parts) collectDrawables(part, scene);
    return scene;
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
            part.drawables.push({
                name: `${mesh.name}#${pi}`,
                positions: prim.positions, normals: prim.normals, uv: prim.uv,
                joints: prim.joints, weights: prim.weights, indices: prim.indices, count: prim.count,
                factor,
                depthBias: spec.bias,
                track: trackOf(spec.role, mat.name, mesh.name),
                texture: mat.texture?.buffer ? decodeTexture(mat.texture)
                    : textureFile ? loadTexture(textureFile) : null
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
    renderFrame(frame, { basis }, drawables, { pxPerUnit: unit });
    frame._basis = basis;
    frame._unit = unit;
    // Смещение кадра: макушка и стопы должны влезть, поэтому считаем box по T-позе один раз.
    return frame;
}

let BOX = null;
const UNIT = PX_PER_UNIT * (BODY_UNITS / MODEL_HEIGHT) * SS;   // пикселей большого кадра на метр модели
const GROUND = (CELL.h - FOOT) * SS;                           // линия стоп в пикселях большого кадра

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
    return {
        x: (f.x - BOX.x) / SS,
        y: (f.y - BOX.y) / SS,
        ang: Math.atan2(f.x - e.x, e.y - f.y)
    };
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

function bakeAll() {
    const scene = buildScene();
    const anim = loadAnimLibs();
    const anchor = renderRaw(scene, anim, { yaw: 0, time: 0, clip: "A_TPose" });
    BOX = anchorBoxFrom(anchor);
    const frames = {};
    const sprites = [];
    const anchorsByPose = new Map();
    const gripsByPose = new Map();
    for (const dir of DIRS) {
        frames[dir.name] = {};
        for (const pose of POSES) {
            const duration = clipDuration(anim, pose.clip) || 1;
            const cells = [];
            const anchors = { r: [], l: [] };
            const grips = { r: [], l: [] };
            for (let i = 0; i < pose.frames; i += 1) {
                const t = (i / pose.frames) * duration * 0.98;
                const raw = gradeFrame(renderRaw(scene, anim, { yaw: dir.yaw, time: t, clip: pose.clip }));
                const sprite = spriteFromPixels(
                    { data: raw.data, w: raw.width, h: raw.height },
                    { grid: { w: CELL.w, h: CELL.h }, mode: "palette", palette: PALETTE, ink: INK,
                      dither: SMOOTH ? 0 : Number(opt('dither', 0.2)),
                      outlineWidth: SMOOTH ? 0 : Number(opt('outline', 2)),
                      outline: !SMOOTH, box: BOX }
                );
                if (!sprite) throw new Error(`пустой кадр ${dir.name}/${pose.clip}#${i}`);
                if (SMOOTH) applySmooth(sprite, raw); else applyRamps(sprite, raw);
                cells.push(sprite);
                for (const side of ["r", "l"]) {
                    const cell = handPoint(scene, raw, side);
                    const a = toUnits(cell.x, cell.y);
                    // x/y — в игровых единицах (их даёт toUnits), угол — экранный,
                    // он не зависит от масштаба: пиксели и единицы растянуты одинаково.
                    anchors[side].push([+a.x.toFixed(2), +a.y.toFixed(2), +cell.ang.toFixed(3)]);
                    grips[side].push(gripPatch(sprite, cell));
                }
                sprites.push({ dir: dir.name, pose: pose.label, index: i, sprite });
            }
            frames[dir.name][pose.label] = cells;
            anchorsByPose.set(`${dir.name}/${pose.label}`, anchors);
            gripsByPose.set(`${dir.name}/${pose.label}`, grips);
        }
        process.stdout.write(`  ${dir.name} ok\n`);
    }
    return { frames, sprites, anchors: Object.fromEntries(anchorsByPose), grips: Object.fromEntries(gripsByPose) };
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
    const streams = encodeFrames(frames);
    const meta = {
        who: who(), source: "Quaternius Universal Base Characters + Universal Animation Pack (CC0)",
        baked: new Date().toISOString().slice(0, 10), tool: "tools/hero-bake.js",
        cell: CELL, pxPerUnit: PX_PER_UNIT, footPad: FOOT, heroPx: CELL.h,
        bodyUnits: BODY_UNITS,
        poses: POSES.filter(p => p.ship).map(p => ({ label: p.label, clip: p.clip, frames: p.frames, fps: p.fps })),
        anchors,
        grips,
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
    lines.push(" * `node tools/hero-bake.js --emit` из 3D-рига Quaternius (CC0). Источник —");
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
    fs.writeFileSync("js/render/heroframes.js", `${lines.join("\n")}\n`);
    const bytes = fs.statSync("js/render/heroframes.js").size;
    const shipped = DIRS.length * shipPoses.length;
    console.log(`EMIT: js/render/heroframes.js — ${(bytes / 1024).toFixed(0)} KB, ${shipped} связок (${shipPoses.join(", ")})`);
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
    const anchors = {}, grips = {};
    for (const [key, value] of Object.entries(baked.anchors)) if (keep(key)) anchors[key] = value;
    for (const [key, value] of Object.entries(baked.grips || {})) if (keep(key)) grips[key] = value;
    const meta = {
        who: who(), smooth: true, steps: SMOOTH_STEPS,
        source: "Quaternius Universal Rig (CC0), тот же запек, но без дизеринга и обводки",
        baked: new Date().toISOString().slice(0, 10), tool: "tools/hero-bake.js --smooth --emit-smooth",
        cell: CELL, pxPerUnit: PX_PER_UNIT, footPad: FOOT, heroPx: CELL.h, bodyUnits: BODY_UNITS,
        poses: POSES.filter(p => SMOOTH_POSES.includes(p.label)).map(p => ({ label: p.label, clip: p.clip, frames: p.frames, fps: p.fps })),
        anchors, grips, dirs: DIRS.map(d => d.name),
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
} else if (flag("fit")) {
    measureFit(buildScene(), loadAnimLibs());
} else {
    console.log("режимы: --preview | --poses | --emit | --fit");
}
