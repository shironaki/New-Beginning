/**
 * tools/gltf-rig.js — чтение glTF/GLB, скелет, проигрывание клипов и скиннинг.
 *
 * Это не «ещё один 3D-движок», а узкий инструмент для запекки: нам нужно взять
 * Quaternius-риг (65 костей) + пакет анимаций и посчитать позиции вершин в момент t,
 * чтобы отрендерить кадр программно. Клипы переставляются ПО ИМЕНАМ костей — так же,
 * как это делает AnimationMixer в браузере, потому что анимации лежат в отдельном файле.
 *
 * Поддержка ограничена тем, что реально есть в паке: float/ushort-аксессоры,
 * LINEAR/STEP-сэмплеры, T/R/S или matrix у узлов, один skin на меш, baseColorTexture
 * и baseColorFactor у материала.
 */
import fs from "node:fs";
import path from "node:path";

const COMPONENTS = {
    5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2],
    5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4]
};
const ITEMS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/* ---------------------------------- матрицы --------------------------------- */

export function mat4Identity(out = new Float32Array(16)) {
    out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; return out;
}

export function mat4Multiply(a, b, out = new Float32Array(16)) {
    for (let c = 0; c < 4; c += 1) {
        for (let r = 0; r < 4; r += 1) {
            out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
                + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
    }
    return out;
}

export function mat4FromTRS(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1], out = new Float32Array(16)) {
    const [x, y, z, w] = r;
    const n = Math.hypot(x, y, z, w) || 1;
    const qx = x / n, qy = y / n, qz = z / n, qw = w / n;
    const xx = qx * qx, yy = qy * qy, zz = qz * qz;
    const xy = qx * qy, xz = qx * qz, yz = qy * qz;
    const wx = qw * qx, wy = qw * qy, wz = qw * qz;
    out[0] = (1 - 2 * (yy + zz)) * s[0]; out[1] = 2 * (xy + wz) * s[0]; out[2] = 2 * (xz - wy) * s[0]; out[3] = 0;
    out[4] = 2 * (xy - wz) * s[1]; out[5] = (1 - 2 * (xx + zz)) * s[1]; out[6] = 2 * (yz + wx) * s[1]; out[7] = 0;
    out[8] = 2 * (xz + wy) * s[2]; out[9] = 2 * (yz - wx) * s[2]; out[10] = (1 - 2 * (xx + yy)) * s[2]; out[11] = 0;
    out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
    return out;
}

export function mat4TransformPoint(m, v, out = [0, 0, 0]) {
    out[0] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
    out[1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
    out[2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
    return out;
}

export function mat4TransformDir(m, v, out = [0, 0, 0]) {
    out[0] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2];
    out[1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2];
    out[2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
    return out;
}

/* ------------------------------- чтение файлов ------------------------------ */

export function readGltf(file) {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const dir = path.dirname(file);
    const buffers = (json.buffers || []).map(b => (b.uri
        ? fs.readFileSync(path.resolve(dir, b.uri))
        : Buffer.alloc(0)));
    return { json, bin: buffers[0] || Buffer.alloc(0), dir };
}

export function readGlb(file) {
    const buf = fs.readFileSync(file);
    const bodyLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.toString("utf8", 20, 20 + bodyLen));
    let bin = Buffer.alloc(0);
    let off = 20 + bodyLen + ((bodyLen % 4) ? 4 - (bodyLen % 4) : 0);
    if (off + 8 <= buf.length) {
        const chunkLen = buf.readUInt32LE(off);
        bin = buf.subarray(off + 8, off + 8 + chunkLen);
    }
    return { json, bin, dir: path.dirname(file), glb: true };
}

function accessorView(json, bin, index) {
    const acc = json.accessors[index];
    if (!acc) throw new Error(`аксессор ${index} не найден`);
    const [Ctor, compBytes] = COMPONENTS[acc.componentType];
    const items = ITEMS[acc.type];
    const view = acc.bufferView !== undefined ? json.bufferViews[acc.bufferView] : null;
    const base = (view ? view.byteOffset || 0 : 0) + (acc.byteOffset || 0);
    const stride = view && view.byteStride ? view.byteStride : compBytes * items;
    return { acc, Ctor, items, compBytes, bin, base, stride, count: acc.count };
}

/** Плоский массив значений аксессора (межстрочная разбивка учитывается). */
export function readAccessor(json, bin, index) {
    const { acc, Ctor, items, compBytes, stride, count, base } = accessorView(json, bin, index);
    const out = new Ctor(count * items);
    if (stride === compBytes * items) {
        out.set(new Ctor(bin.buffer, bin.byteOffset + base, count * items));
        return { array: out, count, items, type: acc.type };
    }
    for (let i = 0; i < count; i += 1) {
        const src = base + i * stride;
        for (let k = 0; k < items; k += 1) out[i * items + k] = new Ctor(bin.buffer, bin.byteOffset + src + k * compBytes, 1)[0];
    }
    return { array: out, count, items, type: acc.type };
}

/* ---------------------------------- риг ------------------------------------- */

export class GltfRig {
    constructor({ json, bin }) {
        this.json = json;
        this.bin = bin;
        this.nodes = json.nodes || [];
        this.nameToNode = new Map();
        this.nodes.forEach((n, i) => { if (n.name && !this.nameToNode.has(n.name)) this.nameToNode.set(n.name, i); });
        this.order = this._flatOrder();
        this.world = this.nodes.map(() => new Float32Array(16));
        this.jointWorld = null;
    }

    /** Обход сцены сверху вниз: мир каждой кости считается после родителя. */
    _flatOrder() {
        const scene = this.json.scenes?.[this.json.defaultScene ?? 0] || this.json.scene;
        const hasParent = new Set();
        for (const node of this.nodes) for (const child of node.children || []) hasParent.add(child);
        const roots = scene?.nodes?.length
            ? scene.nodes
            : this.nodes.map((_, i) => i).filter(i => !hasParent.has(i));
        const order = [];
        const seen = new Set();
        const walk = index => {
            if (seen.has(index)) return;
            seen.add(index);
            order.push(index);
            for (const child of this.nodes[index].children || []) walk(child);
        };
        for (const r of roots) walk(r);
        for (let i = 0; i < this.nodes.length; i += 1) if (!seen.has(i)) { seen.add(i); order.push(i); }
        return order;
    }

    restMatrix(nodeIndex, out = new Float32Array(16)) {
        const node = this.nodes[nodeIndex];
        if (node.matrix) return Float32Array.from(node.matrix.slice ? node.matrix : node.matrix);
        return mat4FromTRS(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1], out);
    }

    skin(index = 0) {
        const skin = this.json.skins[index];
        if (!skin) throw new Error("в файле нет skin");
        const inv = skin.inverseBindMatrices !== undefined
            ? readAccessor(this.json, this.bin, skin.inverseBindMatrices).array
            : null;
        return {
            joints: skin.joints.slice(),
            inverseBind: skin.joints.map((_, i) => {
                if (!inv) return mat4Identity();
                return Float32Array.from(inv.subarray(i * 16, i * 16 + 16));
            }),
            skeletonRoot: skin.skeleton
        };
    }

    /** Локальные матрицы узлов с учётом поз из клипа (overrides: Map nodeIndex → {t,r,s}). */
    updateWorld(overrides) {
        for (const index of this.order) {
            const node = this.nodes[index];
            const parent = this._parentOf(index);
            const local = overrides?.has(index) ? localFromOverride(overrides.get(index)) : this.restMatrix(index);
            const world = this.world[index];
            if (parent === -1) world.set(local);
            else mat4Multiply(this.world[parent], local, world);
        }
    }

    _parentOf(index) {
        if (!this._parents) {
            this._parents = new Int32Array(this.nodes.length).fill(-1);
            for (let i = 0; i < this.nodes.length; i += 1) {
                for (const child of this.nodes[i].children || []) this._parents[child] = i;
            }
        }
        return this._parents[index];
    }

    jointMatrices(skin, overrides) {
        this.updateWorld(overrides);
        const out = skin.joints.map((nodeIndex, i) =>
            mat4Multiply(this.world[nodeIndex], skin.inverseBind[i], new Float32Array(16)));
        this.jointWorld = out;
        return out;
    }
}

function localFromOverride({ t, r, s }) {
    return mat4FromTRS(t || [0, 0, 0], r || [0, 0, 0, 1], s || [1, 1, 1]);
}

/* --------------------------------- анимация --------------------------------- */

/**
 * Клип из отдельного файла анимаций → overrides для рига персонажа, сопоставлением
 * имён костей. Путь трека в gltf — это индекс узла, поэтому имя берём из json анимации.
 */
export function sampleClip(rig, animJson, animBin, clip, time) {
    const overrides = new Map();
    if (!clip) return overrides;
    for (const channel of clip.channels) {
        const nodeIndex = animJson.nodes[channel.target.node]?.name;
        const target = nodeIndex !== undefined ? rig.nameToNode.get(nodeIndex) : undefined;
        if (target === undefined) continue;
        const sampler = clip.samplers[channel.sampler];
        const times = readAccessor(animJson, animBin, sampler.input).array;
        const values = readAccessor(animJson, animBin, sampler.output).array;
        const items = values.length / times.length;
        let i = times.length - 1;
        for (let k = 1; k < times.length; k += 1) {
            if (times[k] > time) { i = k; break; }
        }
        const prev = Math.max(0, i - 1);
        const span = times[i] - times[prev];
        const f = sampler.interpolation === "STEP" ? 0 : (span > 0 ? Math.min(1, Math.max(0, (time - times[prev]) / span)) : 0);
        const a = values.subarray(prev * items, prev * items + items);
        const b = values.subarray(i * items, i * items + items);
        let value;
        if (channel.target.path === "rotation") {
            value = [
                a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f,
                a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f
            ];
            const n = Math.hypot(...value) || 1;
            value = value.map(v => v / n);
        } else {
            value = Array.from({ length: items }, (_, k) => a[k] + (b[k] - a[k]) * f);
        }
        const entry = overrides.get(target) || {};
        if (channel.target.path === "translation") entry.t = value;
        else if (channel.target.path === "rotation") entry.r = value;
        else if (channel.target.path === "scale") entry.s = value;
        overrides.set(target, entry);
    }
    return overrides;
}

/* ----------------------------------- меш ------------------------------------ */

export function readMesh(rig, meshIndex = 0) {
    const mesh = rig.json.meshes[meshIndex];
    if (!mesh) throw new Error(`mesh ${meshIndex} не найден`);
    return mesh.primitives.map(prim => {
        const at = name => (prim.attributes[name] === undefined ? null : readAccessor(rig.json, rig.bin, prim.attributes[name]));
        const positions = at("POSITION");
        if (!positions) throw new Error(`примитив «${mesh.name}» без POSITION`);
        return {
            name: mesh.name,
            positions: positions.array, count: positions.count,
            normals: at("NORMAL")?.array || null,
            uv: at("TEXCOORD_0")?.array || null,
            joints: at("JOINTS_0")?.array || null,
            weights: at("WEIGHTS_0")?.array || null,
            indices: prim.indices !== undefined ? readAccessor(rig.json, rig.bin, prim.indices).array : null,
            material: prim.material ?? null
        };
    });
}

export function materialInfo(rig, index, dir, resolveImage) {
    const mat = rig.json.materials?.[index];
    if (!mat) return { factor: [1, 1, 1, 1], texture: null, doubleSided: false, name: null };
    const pbr = mat.pbrMetallicRoughness || {};
    const factor = pbr.baseColorFactor || [1, 1, 1, 1];
    let texture = null;
    if (pbr.baseColorTexture?.index !== undefined) {
        const tex = rig.json.textures[pbr.baseColorTexture.index];
        const src = tex?.source;
        const img = rig.json.images?.[src];
        if (img && img.bufferView !== undefined) {
            // GLB хранит текстуру внутри буфера — декодируем прямо оттуда, без
            // промежуточных файлов (у пака одежды так лежат оба PNG).
            const view = rig.json.bufferViews[img.bufferView];
            const from = view.byteOffset || 0;
            texture = {
                buffer: Buffer.from(rig.bin.subarray(from, from + view.byteLength)),
                name: img.name || `image${src}`,
                mime: img.mimeType || "image/png"
            };
        } else if (img?.uri) {
            const file = resolveImage ? resolveImage(img.uri, dir) : path.resolve(dir, img.uri);
            texture = { file, name: img.name || img.uri };
        }
    }
    return { factor, texture, doubleSided: !!mat.doubleSided, name: mat.name || null, roughness: pbr.roughnessFactor ?? 1 };
}
