/**
 * tools/hero-rig-export.js — риг героя для ЖИВОГО three.js-рендера в игре.
 *
 * Прежний путь: `tools/hero-bake.js` снимает позы с настоящего скелета Quaternius,
 * сам растеризует их в палитру и пишет шесть листов по ~600 КБ. Претензии владельца
 * к этому пути (блоки 78–79) — не к модели, а к растру:
 *   • «пиксели разбиваются и перекрашиваются в разные цвета» — квантование палитры;
 *   • «smooth + женщина = мужская фигура» — один лист на все образы, силуэт не меняется;
 *   • «сквозь одежду видна задница» — порядок слоёв там, где нужен буфер глубины.
 * Здесь модель отдаётся как есть: кости, веса, клипы, яркость из текстуры. Свет,
 * глубина и цвет считаются в браузере (three.js), поэтому палитры нет, слоёв нет,
 * и «женщина» — это женская геометрия, а не перекраженный мужской лист.
 *
 *   node tools/hero-rig-export.js            # → js/render/herorig.js
 *   node tools/hero-rig-export.js --check     # свести проекцию кисти с якорями листа
 *
 * Фрейминг (CELL, pxPerUnit, footPad, pitch, yaw, свет) повторяет `tools/hero-bake.js`
 * цифра в цифру: `--check` сравнивает спроецированную кисть этого пакета с запечённым
 * якорем того же кадра и требует расхождение ≤ 2 px. Сдвинет пекарь сетку — упадёт здесь,
 * а не в кадре.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGlb, readGltf, GltfRig, readMesh, materialInfo, sampleClip, readAccessor } from "./gltf-rig.js";
import { loadPngFile, decodePng } from "./png-decode.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ASSETS = path.join(ROOT, "dev", "character-style-lab", "assets", "quaternius");
const TEXDIR = path.join(ROOT, "dev", "character-style-lab", ".bake", "tex");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};

const OUT = opt("out", "js/render/herorig.js");
const CHECK = flag("check");

/* ---------------------- та же сетка и та же камера, что в игре ---------------------- */
const PX_PER_UNIT = Number(opt("pxPerUnit", 2.4));
const BODY_UNITS = 42;                    // рост героя в единицах мира (charspec BODY.total)
const MODEL_HEIGHT = 1.86;                // макушка в метрах модели
const CELL_U = { w: 42, h: 47 };
const CELL = { w: Math.round(CELL_U.w * PX_PER_UNIT), h: Math.round(CELL_U.h * PX_PER_UNIT) };
const FOOT = Math.round(3 * PX_PER_UNIT);
const PITCH = Number(opt("pitch", 0.2));
const TARGET = [0, 0.93, 0];
const DISTANCE = 8;
const UNIT = PX_PER_UNIT * (BODY_UNITS / MODEL_HEIGHT);      // пикселей ячейки на метр модели
const DIRS = [
    { name: "down", yaw: 0 },
    { name: "left", yaw: Math.PI / 2 },
    { name: "right", yaw: -Math.PI / 2 },
    { name: "up", yaw: Math.PI }
];
/** Свет — тот же, что у пекаря: косой ключ + небесная полусфера. */
const LIGHT = {
    dir: [-0.36, 0.72, -0.58],
    color: [1.0, 0.97, 0.9],
    intensity: 0.86,
    sky: [0.46, 0.52, 0.6],
    ground: [0.34, 0.28, 0.22],
    ambient: 0.22
};
const UNDERSUIT = { shrink: 0.97, inset: 0.02 };
const HAIR_FIT = { width: 1.06, lift: 0.012 };
const HEAD_BONES = /^(head|neck_01)$/i;
/** Причёска образа → мешок пака. «Косы» в паке нет: braid/ponytail/bun — это Buns. */
const HAIR_BY_STYLE = {
    long: { male: "Hair_Long", female: "Hair_Long" },
    short: { male: "Hair_SimpleParted", female: "Hair_SimpleParted" },
    bun: { male: "Hair_Buns", female: "Hair_Buns" },
    braid: { male: "Hair_Buns", female: "Hair_Buns" },
    ponytail: { male: "Hair_Buns", female: "Hair_Buns" },
    buzz: { male: "Hair_Buzzed", female: "Hair_BuzzedFemale" },
    bald: null
};
const LOOKS = {
    male: { body: "Superhero_Male_FullBody.gltf", outfit: "Male_Peasant.glb" },
    female: { body: "Superhero_Female_FullBody.gltf", outfit: "Female_Peasant.glb" }
};
const POSES = (opt("poses", "idle:Idle_Loop:4:6,walk:Walk_Loop:8:11,run:Jog_Fwd_Loop:6:14,"
    + "sprint:Sprint_Loop:6:16,attack:Sword_Attack:6:13,chop:TreeChopping_Loop:6:10,"
    + "mine:OverhandThrow:5:11,gather:Farm_Harvest:4:8,torch:Idle_Torch_Loop:4:5"))
    .split(",").map(entry => {
        const [label, clip, frames, fps] = entry.split(":");
        return { label, clip, frames: Number(frames), fps: Number(fps) };
    });

const openFile = (rel) => {
    const file = path.join(ASSETS, rel);
    if (!fs.existsSync(file)) throw new Error(`нет файла ${rel}`);
    return { file, ...file.endsWith(".glb") ? readGlb(file) : readGltf(file) };
};

/* --------------------------------- цвета/материалы --------------------------------- */
/**
 * baseColor материала → пиксельная карта. GLB хранит текстуру внутри буфера
 * (у комплекта одежды так), для .gltf берём PNG из `TEXDIR` (там уже
 * разложенные пекарем карты) или рядом с файлом. Кэш — на файл, иначе один и тот
 * же 1K PNG декодируется на каждый меш.
 */
const textureCache = new Map();
function textureOf(rig, dir, materialIndex) {
    const key = `${dir}#${materialIndex}`;
    if (textureCache.has(key)) return textureCache.get(key);
    let out = null;
    try {
        const info = materialInfo(rig, materialIndex, dir, (uri, d) => {
            const base = path.basename(String(uri)).replace(/\.[a-z]+$/i, "");
            const packed = path.join(TEXDIR, `${base}.png`);
            return fs.existsSync(packed) ? packed : path.resolve(d, uri);
        });
        if (info?.texture?.buffer) out = decodePng(info.texture.buffer);
        else if (info?.texture?.file && fs.existsSync(info.texture.file)) out = loadPngFile(info.texture.file);
    } catch { out = null; }
    textureCache.set(key, out);
    return out;
}
/**
 * Яркость пикселя текстуры в вершине. Оттенки образа (куртка, штаны, кожа,
 * волосы) задаёт look, а текстура остаётся только светотенью — так лицо и
 * складки читаются, а «белая палитра в одежде» невозможна в принципе.
 */
function luminanceAt(tex, uv, v) {
    if (!tex || !uv) return 210;
    const u = uv[v * 2], w = uv[v * 2 + 1];
    const x = Math.max(0, Math.min(tex.width - 1, Math.round(u * (tex.width - 1))));
    const y = Math.max(0, Math.min(tex.height - 1, Math.round((1 - w) * (tex.height - 1))));
    const i = (y * tex.width + x) * 4;
    return Math.round(0.299 * tex.data[i] + 0.587 * tex.data[i + 1] + 0.114 * tex.data[i + 2]);
}
/** tint = имя цвета образа; `null` — цвет свой (глаза, брови, обувь, металл). */
function tintOf(role, matName, meshName) {
    const name = String(matName || ""), mesh = String(meshName || "");
    if (role === "hair") return "hair";
    if (role === "body") {
        if (/eye/i.test(`${name} ${mesh}`)) return null;
        if (/brow/i.test(`${name} ${mesh}`)) return null;
        if (/hair/i.test(name)) return "hair";
        return "skin";
    }
    if (/regular|skin|arm/i.test(`${name} ${mesh}`)) return "skin";
    if (/feet|shoe|boot/i.test(mesh)) return null;
    if (/leg|trouser|pant/i.test(mesh)) return "pants";
    return "cloth";
}

/* --------------------------------- кости и веса --------------------------------- */
function boneNames(rig) {
    const skin = rig.skin(0);
    return (skin?.joints || []).map(i => rig.json.nodes[i]?.name || "");
}
/** Иерархия костей: родитель = ближайший предок-кость (нет-костные узлы сворачиваются). */
function boneTree(rig, jointNames) {
    const skin = rig.skin(0);
    const nodes = rig.nodes;
    const parents = new Int32Array(nodes.length).fill(-1);
    nodes.forEach((n, i) => { for (const c of n.children || []) parents[c] = i; });
    const isJoint = new Map();
    skin.joints.forEach((nodeIndex, j) => isJoint.set(nodeIndex, j));
    const out = [];
    for (let j = 0; j < skin.joints.length; j += 1) {
        const node = nodes[skin.joints[j]];
        let p = parents[skin.joints[j]];
        while (p !== -1 && !isJoint.has(p)) p = parents[p];
        out.push({
            name: node.name || jointNames[j] || `bone_${j}`,
            parent: p === -1 ? -1 : isJoint.get(p),
            t: node.translation || [0, 0, 0],
            r: node.rotation || [0, 0, 0, 1],
            s: node.scale || [1, 1, 1]
        });
    }
    return out;
}
function headBoxOf(rig, names) {
    let b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    for (let m = 0; m < (rig.json.meshes?.length || 0); m += 1) {
        for (const prim of readMesh(rig, m)) {
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
/** Волосы подгоняются по голове и режутся по полосе лица (тот же HAIR_FIT, что у пекаря). */
function fitHair(prim, head) {
    let hx0 = Infinity, hx1 = -Infinity, hz0 = Infinity, hz1 = -Infinity, hy1 = -Infinity;
    for (let v = 0; v < prim.count; v += 1) {
        const x = prim.positions[v * 3], y = prim.positions[v * 3 + 1], z = prim.positions[v * 3 + 2];
        if (x < hx0) hx0 = x; if (x > hx1) hx1 = x;
        if (z < hz0) hz0 = z; if (z > hz1) hz1 = z;
        if (y > hy1) hy1 = y;
    }
    const k = Math.min(1.2, ((head.x1 - head.x0) * HAIR_FIT.width) / Math.max(1e-4, hx1 - hx0));
    const cx = (hx0 + hx1) / 2, cz = (hz0 + hz1) / 2;
    const dy = (head.y1 + HAIR_FIT.lift) - hy1;
    const positions = new Float32Array(prim.positions);
    const normals = prim.normals ? new Float32Array(prim.normals) : null;
    for (let v = 0; v < prim.count; v += 1) {
        positions[v * 3] = cx + (prim.positions[v * 3] - cx) * k;
        positions[v * 3 + 1] = prim.positions[v * 3 + 1] + dy;
        positions[v * 3 + 2] = cz + (prim.positions[v * 3 + 2] - cz) * k;
        if (normals) { normals[v * 3] /= k; normals[v * 3 + 2] /= k; }
    }
    const fx = (head.x1 - head.x0) * 0.62;
    const fy0 = head.y0 + (head.y1 - head.y0) * 0.55, fy1 = head.y1 - (head.y1 - head.y0) * 0.02;
    const fz0 = head.z0 + (head.z1 - head.z0) * 0.62;
    const inside = (i) => Math.abs(positions[i * 3] - cx) < fx
        && positions[i * 3 + 1] > fy0 && positions[i * 3 + 1] < fy1 && positions[i * 3 + 2] > fz0;
    const src = prim.indices, keep = [];
    for (let t = 0; t + 2 < src.length; t += 3) {
        if (inside(src[t]) && inside(src[t + 1]) && inside(src[t + 2])) continue;
        keep.push(t / 3);
    }
    return { positions, normals, keep };
}
/** Тело — подкладка: утянуто к оси и вдоль нормалей, чтобы не торчать из одежды. */
function shrinkBody(prim) {
    const positions = new Float32Array(prim.positions);
    const n = prim.normals;
    for (let v = 0; v < positions.length; v += 3) {
        positions[v] *= UNDERSUIT.shrink; positions[v + 2] *= UNDERSUIT.shrink;
        if (n && UNDERSUIT.inset) {
            positions[v] -= n[v] * UNDERSUIT.inset;
            positions[v + 1] -= n[v + 1] * UNDERSUIT.inset;
            positions[v + 2] -= n[v + 2] * UNDERSUIT.inset;
        }
    }
    return positions;
}

/* ---------------------------------- упаковка ---------------------------------- */
const blobs = [];
function push(bytes) {
    blobs.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64"));
    return blobs.length - 1;
}
const Q16 = 32767;

/** Вершина (13 байт): pos int16×3 · nrm int8×3 · lum u8 · кость A u8 · кость B u8 · вес u8. */
function packPrim(prim, mapToCanon) {
    const count = prim.count;
    const pos = prim.positions;
    let mx = 0, my = 0, mz = 0;
    for (let v = 0; v < count; v += 1) {
        mx = Math.max(mx, Math.abs(pos[v * 3])); my = Math.max(my, Math.abs(pos[v * 3 + 1])); mz = Math.max(mz, Math.abs(pos[v * 3 + 2]));
    }
    const s = [Math.max(1e-5, mx / Q16), Math.max(1e-5, my / Q16), Math.max(1e-5, mz / Q16)];
    const bytes = Buffer.alloc(count * 13);
    let o = 0;
    for (let v = 0; v < count; v += 1) {
        bytes.writeInt16LE(Math.round(pos[v * 3] / s[0]), o); o += 2;
        bytes.writeInt16LE(Math.round(pos[v * 3 + 1] / s[1]), o); o += 2;
        bytes.writeInt16LE(Math.round(pos[v * 3 + 2] / s[2]), o); o += 2;
        if (prim.normals) {
            const l = Math.hypot(prim.normals[v * 3], prim.normals[v * 3 + 1], prim.normals[v * 3 + 2]) || 1;
            for (let i = 0; i < 3; i += 1) {
                bytes.writeInt8(Math.max(-127, Math.min(127, Math.round(prim.normals[v * 3 + i] / l * 127))), o + i);
            }
        } else { bytes.writeInt8(0, o); bytes.writeInt8(0, o + 1); bytes.writeInt8(127, o + 2); }
        o += 3;
        bytes[o] = prim.lum ? prim.lum[v] : 210; o += 1;
        let a = 0, b = 0, wa = 1;
        if (prim.joints && prim.weights) {
            let best = -1, second = -1, bw = -1, sw = -1;
            for (let k = 0; k < 4; k += 1) {
                const w = prim.weights[v * 4 + k];
                if (w > bw) { second = best; sw = bw; best = k; bw = w; }
                else if (w > sw) { second = k; sw = w; }
            }
            a = mapToCanon(prim.joints[v * 4 + best]);
            b = second >= 0 ? mapToCanon(prim.joints[v * 4 + second]) : a;
            wa = bw / Math.max(1e-6, bw + (sw > 0 ? sw : 0));
        }
        bytes[o] = a; bytes[o + 1] = b; o += 2;
        bytes[o] = Math.round(Math.max(0, Math.min(1, wa)) * 255); o += 1;
    }
    const srcIdx = prim.indices;
    const keep = prim.keep ? new Set(prim.keep) : null;
    const tris = [];
    for (let t = 0; t + 2 < srcIdx.length; t += 3) {
        if (keep && !keep.has(t / 3)) continue;
        tris.push(srcIdx[t], srcIdx[t + 1], srcIdx[t + 2]);
    }
    const indices = new Uint16Array(tris);
    return { verts: push(bytes), idx: push(indices), count, tris: indices.length / 3, scale: s.map(n => Number(n.toFixed(6))) };
}

/* ----------------------------------- сборка ----------------------------------- */
function build() {
    const base = openFile(path.join("char", LOOKS.male.body));
    const baseRig = new GltfRig(base);
    const canon = boneNames(baseRig);
    const canonIndex = new Map(canon.map((n, i) => [n, i]));
    const bones = boneTree(baseRig, canon);
    const parts = {};

    for (const who of Object.keys(LOOKS)) {
        const spec = LOOKS[who];
        const addPart = (key, role, rel) => {
            const file = openFile(rel);
            const rig = new GltfRig(file);
            const names = boneNames(rig);
            const mapToCanon = (jointIdx) => {
                const name = names[jointIdx];
                const i = name === undefined ? -1 : canonIndex.get(name);
                return i === undefined || i < 0 ? 0 : i;
            };
            const head = role === "hair" ? headBoxOf(new GltfRig(base), canon) : null;
            const meshes = [];
            for (let m = 0; m < (file.json.meshes?.length || 0); m += 1) {
                for (const basePrim of readMesh(rig, m)) {
                    if (!basePrim.indices || !basePrim.indices.length) continue;
                    const mat = materialInfo(rig, basePrim.material, file.dir, () => null) || {};
                    let prim = basePrim;
                    let keep = null;
                    if (role === "body") prim = { ...basePrim, positions: shrinkBody(basePrim) };
                    if (role === "hair" && head) {
                        const fit = fitHair(basePrim, head);
                        prim = { ...basePrim, positions: fit.positions, normals: fit.normals };
                        keep = fit.keep;
                    }
                    const tex = textureOf(rig, file.dir, basePrim.material);
                    const uv = basePrim.uv;
                    const lum = tex && uv ? Uint8Array.from({ length: basePrim.count }, (_, v) => luminanceAt(tex, uv, v)) : null;
                    prim = { ...prim, lum, keep };
                    const packed = packPrim(prim, mapToCanon);
                    meshes.push({
                        name: (file.json.meshes[m]?.name || `mesh${m}`),
                        tint: tintOf(role, mat.name, file.json.meshes[m]?.name),
                        color: mat.factor ? mat.factor.slice(0, 3).map(x => Math.round(x * 255)) : null,
                        ...packed
                    });
                }
            }
            parts[key] = { role, file: rel.split(path.sep).join("/"), meshes };
        };
        addPart(`body:${who}`, "body", path.join("char", spec.body));
        addPart(`outfit:${who}`, "clothes", path.join("outfits", spec.outfit));
        // Мешок волос — один на несколько причёсок образа (braid/ponytail/bun в
        // паке — это Hair_Buns), поэтому части кладутся ПО МЕШКУ, а look только
        // ссылается на него. Иначе одна и та же геометрия ехала бы в файл трижды.
        const bags = new Set(Object.values(HAIR_BY_STYLE).filter(Boolean).map(t => t[who]));
        for (const bag of bags) {
            if (!fs.existsSync(path.join(ASSETS, "hair", `${bag}.glb`))) continue;
            addPart(`hair:${who}:${bag}`, "hair", path.join("hair", `${bag}.glb`));
        }
    }

    /* клипы: единый скелет, поэтому треки сэмплируются один раз на канон */
    const animLibs = ["anims.glb", "animations/UAL2.glb"]
        .map(rel => path.join(ASSETS, rel)).filter(f => fs.existsSync(f)).map(f => readGlb(f));
    const findClip = (name) => {
        for (const lib of animLibs) {
            const clip = lib.json.animations?.find(c => c.name === name);
            if (clip) return { lib, clip };
        }
        return null;
    };
    const jointNodes = baseRig.json.skins[0].joints;
    const rest = jointNodes.map(i => {
        const n = baseRig.nodes[i];
        return { t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1] };
    });
    const clips = {};
    for (const pose of POSES) {
        const found = findClip(pose.clip);
        if (!found) { console.warn(`⚠️ клип «${pose.clip}» не найден — поза «${pose.label}» не экспортируется`); continue; }
        const { lib, clip } = found;
        // Длительность — ПОСЛЕДНИЙ ключевой кадр (как `clipDuration` у пекаря), а не
        // clip.duration: иначе фазы клипа разъезжаются и поза сверяется не с тем кадром.
        const input = clip?.samplers?.[0]?.input;
        const acc = input === undefined ? null : readAccessor(lib.json, lib.bin, input);
        const duration = ((acc?.count ? acc.array[acc.array.length - 1] : 1) || 1) * 0.98;
        const frames = [];
        let maxT = 1e-4;
        for (let f = 0; f < pose.frames; f += 1) {
            const t = (f / pose.frames) * duration;
            const overrides = sampleClip(baseRig, lib.json, lib.bin, clip, t);
            // Строка кадра — ПЛОСКАЯ: 7 чисел на кость (dt×3 + quat×4). `row.push([...dt,
            // ...r])` класть нельзя: тогда row[i] — массив, `row[i]/ts` = NaN, а
            // writeInt16LE(NaN) пишет 0 — молча нулевой клип и герой без анимации.
            const row = new Float64Array(jointNodes.length * 7);
            for (let j = 0; j < jointNodes.length; j += 1) {
                const ov = overrides.get(jointNodes[j]);
                const dt = ov?.t ? [ov.t[0] - rest[j].t[0], ov.t[1] - rest[j].t[1], ov.t[2] - rest[j].t[2]] : [0, 0, 0];
                const r = ov?.r || rest[j].r;
                maxT = Math.max(maxT, Math.abs(dt[0]), Math.abs(dt[1]), Math.abs(dt[2]));
                const o = j * 7;
                row[o] = dt[0]; row[o + 1] = dt[1]; row[o + 2] = dt[2];
                row[o + 3] = r[0]; row[o + 4] = r[1]; row[o + 5] = r[2]; row[o + 6] = r[3];
            }
            frames.push(row);
        }
        // Шаг квантования: смещение translation — по максимуму клипа (its own ts),
        // кватернион — фиксированный 1/32767, потому что |q| = 1 всегда.
        const ts = Math.max(1e-6, maxT / Q16);
        const data = Buffer.alloc(frames.length * jointNodes.length * 14);
        let o = 0;
        for (const row of frames) for (let i = 0; i < row.length; i += 1) {
            const v = i % 7 < 3 ? row[i] / ts : row[i] * Q16;   // dt[3] + quat[4]
            if (!Number.isFinite(v)) throw new Error(`поза «${pose.label}»: кадр содержимое не число (i=${i}, v=${v}) — упаковывать нечего`);
            data.writeInt16LE(Math.max(-Q16, Math.min(Q16, Math.round(v))), o); o += 2;
        }
        // Пустой клип молча выглядит как «герой стоит»: проверяем, что движение есть.
        let touched = 0;
        for (let i = 0; i < data.length; i += 1) if (data[i]) touched += 1;
        if (touched < jointNodes.length) throw new Error(`поза «${pose.label}» упаковалась в ${touched} ненулевых байт — анимации нет`);
        clips[pose.label] = {
            clip: pose.clip, frames: pose.frames, fps: pose.fps, tScale: Number(ts.toFixed(8)),
            data: push(data), bones: jointNodes.length
        };
    }
    // `rest` нужен сверке: упакованный кадр хранит ПРИРАЩЕНИЕ к покою, поэтому
    // восстановить из него позу можно только вместе с покоем.
    return { canon, bones, parts, clips, baseRig, jointNodes, rest };
}

/* --------------------- проекция: метры модели → пикселя ячейки --------------------- */
/**
 * Точка отсчёта — НЕ центр кадра, а линия стоп: пекарь кроит кадр так, чтобы
 * низ T-позы попал в строку CELL.h − footPad, и все якоря листа живут в этой
 * системе. Поэтому и здесь: row = footRow − (высота над стопами) × unit.
 */
export function cameraBasis(yaw) {
    const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    const eye = [Math.sin(yaw) * cp * DISTANCE + TARGET[0], sp * DISTANCE + TARGET[1], Math.cos(yaw) * cp * DISTANCE + TARGET[2]];
    const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fwd = norm([TARGET[0] - eye[0], TARGET[1] - eye[1], TARGET[2] - eye[2]]);
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    return { eye, right, up, fwd };
}
const FEET = [0, 0, 0];                        // линия стоп модели (низ T-позы)
/** Обводка кадра: пекарь кроит так, чтобы НИЖНИЙ КРАЙ ОБВОДКИ встал в строку
 *  опоры, то есть сама подошва сидит на OUTLINE_PX выше. Живой рендер обводки не
 *  имеет, поэтому его строка опоры сдвигается на ту же величину — иначе переключение
 *  «лист ↔ live» поднимало бы героя на два пикселя. */
const OUTLINE_PX = Number(opt("outline", 2));
export function frameFor(yaw) {
    const b = cameraBasis(yaw);
    const d = [FEET[0] - b.eye[0], FEET[1] - b.eye[1], FEET[2] - b.eye[2]];
    const upFeet = d[0] * b.up[0] + d[1] * b.up[1] + d[2] * b.up[2];
    return { ...b, yaw, rowFeet: (CELL.h - FOOT) + upFeet * UNIT - OUTLINE_PX };
}
export function projectPoint(f, p) {
    const d = [p[0] - f.eye[0], p[1] - f.eye[1], p[2] - f.eye[2]];
    const dot = v => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    return [CELL.w / 2 + dot(f.right) * UNIT, f.rowFeet - dot(f.up) * UNIT];
}
export const FOOT_ROW = CELL.h - FOOT;

const { canon, bones, parts, clips, baseRig, jointNodes, rest } = build();

/* ------------------------- сверка с запечённым листом игры ------------------------- */
if (CHECK) {
    const mod = await import(new URL(`../js/render/heroframes.js`, import.meta.url).href);
    const anchors = mod.META.anchors || {};
    const rig = baseRig;
    const animLibs = ["anims.glb", "animations/UAL2.glb"]
        .map(rel => path.join(ASSETS, rel)).filter(f => fs.existsSync(f)).map(f => readGlb(f));
    const find = (name) => {
        for (const lib of animLibs) {
            const c = lib.json.animations?.find(x => x.name === name);
            if (c) return { lib, clip: c };
        }
        return null;
    };
    /**
     * Кулак из УПАКОВАННОГО клипа: ровно то, что прочитает рантайм. Сверять
     * пересэмплированный gltf — значит проверить пекаря, а не пакет: так и прошляпил
     * нулевой клип (row.push([...]) → NaN → 0), когда «check» сходился до 0.1 px.
     */
    const rowOf = (label, f) => {
        const c = clips[label];
        const buf = Buffer.from(blobs[c.data], "base64");
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const out = new Float64Array(c.bones * 7);
        const base = f * c.bones * 14;
        for (let i = 0; i < c.bones * 7; i += 1) {
            out[i] = i % 7 < 3 ? view.getInt16(base + i * 2, true) * c.tScale : view.getInt16(base + i * 2, true) / Q16;
        }
        return out;
    };
    const fistOf = (label, f) => {
        const row = rowOf(label, f);
        const ov = new Map();
        for (let j = 0; j < jointNodes.length; j += 1) {
            const o = j * 7;
            ov.set(jointNodes[j], {
                t: [rest[j].t[0] + row[o], rest[j].t[1] + row[o + 1], rest[j].t[2] + row[o + 2]],
                r: [row[o + 3], row[o + 4], row[o + 5], row[o + 6]]
            });
        }
        rig.updateWorld(ov);
        const a = rig.world[rig.nameToNode.get(META_FIST.wrist)], b = rig.world[rig.nameToNode.get(META_FIST.knuckle)];
        return [(a[12] + b[12]) / 2, (a[13] + b[13]) / 2, (a[14] + b[14]) / 2];
    };
    const META_FIST = { wrist: "hand_r", knuckle: "middle_01_r", elbow: "lowerarm_r" };
    let worst = 0, tested = 0, sum = 0, sumX = 0, sumY = 0;
    for (const pose of POSES) {
        if (!clips[pose.label]) continue;
        for (const dir of DIRS) {
            const list = anchors[`${dir.name}/${pose.label}`]?.r;
            if (!list) continue;
            const b = frameFor(dir.yaw);
            for (let f = 0; f < pose.frames; f += 1) {
                const baked = list[f];
                if (!baked) continue;
                const p = fistOf(pose.label, f);
                const [px, py] = projectPoint(b, p);
                // Якорь листа — в единицах мира; обратно в пиксели по той же сетке.
                const bx = baked[0] * PX_PER_UNIT + CELL.w / 2;
                const by = baked[1] * PX_PER_UNIT + (CELL.h - FOOT);
                const d = Math.hypot(px - bx, py - by);
                worst = Math.max(worst, d); sum += d; tested += 1;
                sumX += px - bx; sumY += py - by;
            }
        }
    }
    // Кадр не должен быть «одним и тем же» для всей позы: иначе проверка
    // превращается в сверку T-позы с T-позой и зелёная даже при пустом клипе.
    let motion = 0;
    for (const pose of POSES) {
        if (!clips[pose.label] || clips[pose.label].frames < 2) continue;
        const a0 = fistOf(pose.label, 0), a1 = fistOf(pose.label, 1);
        motion = Math.max(motion, Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]));
    }
    const n = Math.max(1, tested);
    console.log(`CHECK: кадров ${tested} · среднее ${(sum / n).toFixed(2)} px · смещение x ${(sumX / n).toFixed(2)}, y ${(sumY / n).toFixed(2)} · худший ${worst.toFixed(2)} px`);
    if (!tested) { console.error("нет ни одной сверенной связки — тест ничего не проверяет"); process.exit(1); }
    console.log(`движение кулака между кадрами: ${(motion * 100).toFixed(1)} см`);
    if (motion < 0.01) { console.error("клипы упакованы нулями — анимации в пакете нет"); process.exit(1); }
    if (worst > 1) { console.error(`РАСХОЖДЕНИЕ ${worst.toFixed(2)} px > 1 px — фрейминг пакета не совпадает с листом`); process.exit(1); }
    console.log("✅ проекция кисти совпадает с запечённым якорем (≤ 1 px)");
    process.exit(0);
}

/* ------------------------------------ вывод ------------------------------------ */
const looks = {};
for (const who of Object.keys(LOOKS)) {
    for (const style of Object.keys(HAIR_BY_STYLE)) {
        const bag = HAIR_BY_STYLE[style]?.[who];
        const hairKey = bag ? `hair:${who}:${bag}` : null;
        looks[`${who}/${style}`] = {
            parts: [`body:${who}`, `outfit:${who}`, ...(hairKey && parts[hairKey] ? [hairKey] : [])]
        };
    }
}
const partOut = {};
for (const [key, part] of Object.entries(parts)) {
    partOut[key] = { role: part.role, file: part.file, meshes: part.meshes };
}
fs.mkdirSync(path.dirname(path.resolve(ROOT, OUT)), { recursive: true });
const meta = {
    source: "Quaternius Universal Rig (CC0) — тот же исходник, что у tools/hero-bake.js",
    tool: "tools/hero-rig-export.js", baked: new Date().toISOString().slice(0, 10),
    cell: CELL, pxPerUnit: PX_PER_UNIT, footPad: FOOT, heroPx: CELL.h, bodyUnits: BODY_UNITS,
    modelHeight: MODEL_HEIGHT, pitch: PITCH, target: TARGET, distance: DISTANCE, unit: UNIT,
    footRow: FOOT_ROW, frames: DIRS.map(d => frameFor(d.yaw)), light: LIGHT,
    // Чернила кадра — тот же `ink` палитры пекаря (первый тон `heroframes.META.palette`
    // и `INK` в tools/hero-bake.js = [28,22,16]): живой рендер обязан рисовать
    // обводку теми же чернилами, иначе герой выглядит приклеенным к миру, где у
    // каждого пропа обводка есть.
    ink: "#241d18", inkPx: OUTLINE_PX,
    // Позы — тот же список, что у листа: рантайм выбирает позу по label/frames/fps
    // одинаково в обоих режимах, иначе «лист ↔ live» меняло бы ещё и темп шага.
    poses: POSES.filter(x => clips[x.label]).map(x => ({
        label: x.label, clip: clips[x.label].clip, frames: clips[x.label].frames, fps: clips[x.label].fps
    })),
    palette: [],
    fist: { wrist: "hand_r", knuckle: "middle_01_r", elbow: "lowerarm_r" },
    bones, tints: ["skin", "cloth", "pants", "hair"], parts: partOut, clips, looks
};
const lines = [];
lines.push("/**");
lines.push(" * js/render/herorig.js — геометрия, кости, веса и клипы героя для живого three.js.");
lines.push(" * Собирает `node tools/hero-rig-export.js`; исходники —");
lines.push(" * dev/character-style-lab/assets/quaternius (CC0). Пикселей здесь нет намеренно:");
lines.push(" * растер+палитра были источником претензий «пиксели разбиваются/перекрашиваются» и");
lines.push(" * «женщина выглядит мужчиной»; здесь их считает браузер, а не запекка.");
lines.push(" */");
lines.push(`export const RIG_META = ${JSON.stringify(meta)};`);
lines.push("");
lines.push(`export const RIG_BLOBS = ${JSON.stringify(blobs)};`);
lines.push("");
fs.writeFileSync(path.join(ROOT, OUT), lines.join("\n") + "\n");
const kb = (n) => `${(n / 1024).toFixed(0)} КБ`;
let verts = 0, tris = 0;
for (const part of Object.values(parts)) for (const m of part.meshes) { verts += m.count; tris += m.tris; }
console.log(`HERIG: ${Object.keys(parts).length} частей · ${verts} вершин · ${tris} треугов · `
    + `${Object.keys(clips).length} клипов · ${kb(fs.statSync(path.join(ROOT, OUT)).size)} → ${OUT}`);
