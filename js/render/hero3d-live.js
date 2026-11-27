/**
 * render/hero3d-live.js — герой как ЖИВОЙ 3D на three.js, а не запечённым листом.
 *
 * Почему это вообще появилось (претензии владельца к блоку 78, скриншоты 79):
 *   • «пиксели разбиваются и перекрашиваются в разные цвета» — собственный растер
 *     пекаря квантует цвет в палитру и в четыре дорожки; здесь палитры нет;
 *   • «smooth + женщина = мужская фигура» — лист один, силуэт берётся из него,
 *     перекраска форму не меняет; здесь форма = меш выбранного пола;
 *   • «сквозь одежды видна задница» — там, где нужен буфер глубины, был порядок
 *     слоёв; здесь depth-test + polygonOffset.
 * От листа взята только СЕТКА кадра (cell/pxPerUnit/footPad) и проекция:
 * `node tools/hero-rig-export.js --check` сверяет якорь кисти с запечённым листом и
 * требует ≤ 1 px, поэтому переключение «лист ↔ live» не сдвигает ни героя, ни
 * предмет в руке, ни тень, ни ватерлинию.
 *
 * Честные упрощения: пальцевого патча (`grip`) здесь нет — он был способом ладони
 * лечь поверх рукояти в плоском спрайте; в 3D это делает глубина. `hidden` стоит
 * там же, где у пекаря, — через readPixels одного пикселя.
 */
import { RIG_META, RIG_BLOBS } from "./herorig.js";

const META = RIG_META;
const U = 1 / (META.pxPerUnit || 2.4);            // пиксель кадра → единицы мира
const CELL = META.cell;
const TOP = -(CELL.h - META.footPad) * U;
const M_PER_PX = 1 / META.unit;                   // метры модели на пиксель кадра
// Сколько пикселей кадра обязан занять герой. Лист даёт ~2 400–2 900; берём с
// запасом: 300 — это уже «что-то нарисовано», а не мусор из-за битых весов.
const MIN_COVERAGE = Number(globalThis.process?.env?.HERO_MIN_COVERAGE ?? 300);
const TAU = Math.PI * 2;

export const LIVE = {
    on: false, ready: false, error: "", reason: "",
    looks: 0, frames: 0, skipped: 0, active: "", tone: null,
    // Аудит первого кадра: сколько пикселей кадра реально залилось. Без него
    // «точка вместо героя» (битые веса, потерянный контекст) выглядит как
    // «3D работает»: сцена собрана, кадры считаются, а на экране пусто.
    coverage: -1, audited: false
};

let THREE = null;
let renderer = null, scene = null, camera = null, root = null, gl = null;
let lights = null;
const blobCache = new Map();
const lookCache = new Map();
const px = new Uint8Array(4);
let LAST = null;                                  // последний собранный кадр (для якорей)

/* --------------------------------- блок питания --------------------------------- */
function decode(index) {
    if (blobCache.has(index)) return blobCache.get(index);
    const b64 = RIG_BLOBS[index];
    let buf;
    if (typeof Buffer !== "undefined") {
        const node = Buffer.from(b64, "base64");
        buf = new Uint8Array(node.buffer.slice(node.byteOffset, node.byteOffset + node.byteLength));
    } else {
        const bin = atob(b64);
        buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
    }
    blobCache.set(index, buf);
    return buf;
}

/** Есть ли чем рисовать: WebGL обязателен, без него игра остаётся на листе. */
function webglContext(canvas, release = false) {
    for (const kind of ["webgl2", "webgl", "experimental-webgl"]) {
        let ctx = null;
        try { ctx = canvas.getContext(kind); } catch { ctx = null; }
        // Пробный контекст обязан уходить: браузер держит ~16 живых WebGL-
        // контекстов, и «проверить, можно ли рисовать» без loseContext само
        // по себе ломает рисование после нескольких переключений в панели.
        if (ctx && release && typeof ctx.getExtension === "function" && typeof ctx.getParameter === "function") {
            try { ctx.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* уже всё равно */ }
            return true;
        }
        // Настоящий WebGL-контекст обязан уметь отвечать на getParameter.
        // 2D-«холст» (в тестовой подставке getContext возвращает что попало) — нет:
        // иначе «среда поддерживает 3D» означает «поддержка есть», а не «есть чем рисовать».
        if (ctx && typeof ctx.getParameter === "function") return ctx;
    }
    return release ? false : null;
}
export function liveSupported() {
    if (typeof document === "undefined" || typeof window === "undefined") return false;
    try {
        // Только спросить, не занимая контекст: рисовать будет renderer.
        return webglContext(document.createElement("canvas"), true) === true;
    } catch { return false; }
}

/**
 * Собрать сцену. false — живой рендер недоступен (причина в LIVE.error/reason),
 * и это не молчание: штамп сборки показывает её прямо в углу кадра.
 */
export async function initLive() {
    // Готовность пробника (enableForTests) НЕ равна готовности рисовать: без
    // renderer живой кадр вернул бы null на каждом актёре, а штамп рапортовал бы
    // «live». Поэтому требуем именно рисующий контекст.
    if (LIVE.ready && renderer) return true;
    if (!liveSupported()) {
        LIVE.error = "нет WebGL — играет запечённый лист";
        LIVE.reason = "no-webgl";
        return false;
    }
    try {
        THREE = await import("../vendor/three.module.js");
    } catch (err) {
        LIVE.reason = "no-webgl";
        LIVE.error = `three.js не загрузился: ${String(err && err.message || err).slice(0, 120)}`;
        LIVE.reason = "no-three";
        return false;
    }
    try {
        const canvas = document.createElement("canvas");
        const gl0 = webglContext(canvas);
        if (!gl0) throw new Error("браузер не дал WebGL-контекст");
        canvas.width = CELL.w; canvas.height = CELL.h;
        renderer = new THREE.WebGLRenderer({
            canvas, alpha: true, antialias: false, premultipliedAlpha: false,
            preserveDrawingBuffer: true                 // кадр забирает 2D-слой игры
        });
        renderer.setPixelRatio(1);
        renderer.setSize(CELL.w, CELL.h, false);
        renderer.setClearColor(0x000000, 0);
        renderer.shadowMap.enabled = false;
        gl = renderer.getContext() || gl0;
        scene = new THREE.Scene();
        // Ортография: игра рисует персонажа без перспективы, и лист собран тем же
        // проективным аппаратом — перспектива сдвинула бы силуэт относительно тени.
        camera = new THREE.OrthographicCamera(-CELL.w / 2 * M_PER_PX, CELL.w / 2 * M_PER_PX,
            CELL.h / 2 * M_PER_PX, -CELL.h / 2 * M_PER_PX, 0.05, 60);
        root = new THREE.Group();
        root.name = "heroRoot";
        scene.add(camera);
        scene.add(root);
        buildLights();
        applySun();
        LIVE.on = true;
        LIVE.ready = true;
        LIVE.error = "";
        LIVE.reason = "";
        return true;
    } catch (err) {
        LIVE.error = String(err && err.message || err).slice(0, 160);
        LIVE.reason = "renderer";
        renderer = null; scene = null; camera = null; root = null; gl = null;
        LIVE.ready = false;
        return false;
    }
}

/**
 * Свет — в ПРОСТРАНСТВЕ КАМЕРЫ (как у пекаря): грань темнеет, когда разворачивается
 * от наблюдателя, а не когда герой обойдёт солнце. Поэтому источники — дети камеры.
 */
function buildLights() {
    const key = new THREE.DirectionalLight(0xffffff, 1);
    // Цель — в НУЛЕ КАМЕРЫ, а не внутри самой лампы: у DirectionalLight направление
    // = позиция минус позиция цели, и если посадить цель на родителя-лампу, вектор
    // вырождается в ноль, а герой становится плоским силуэтом без единой грани.
    const target = new THREE.Object3D();
    target.position.set(0, 0, 0);
    camera.add(target);
    camera.add(key);
    key.target = target;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.5);
    scene.add(hemi);
    lights = { key, target, hemi };
}
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
/**
 * Свет — общий с 3D-пропами: `sun` приходит из `props3d.propSunFor(state, SUN)`
 * (dir/elev/amp/amb), поэтому герой и двор темнеют и разворачиваются вместе.
 * Форма `dir`-вектора из пакета — запасной путь для пекаря и тестов.
 */
export function liveSun(sun = null) {
    if (!lights || !THREE) return;
    LIVE.tone = sun || null;
    const l = META.light;
    const real = sun && Number.isFinite(sun.amp) ? sun : null;
    // Направление «от лампы к герою» в пространстве камеры: X — сторона света,
    // Y — высота солнца (0.28…0.90), Z — чуть спереди, как в кадрах пекаря.
    const dx = real ? clamp01(Math.abs(real.dir || 0)) * Math.sign(real.dir || 0) : l.dir[0];
    const dy = real ? 0.28 + 0.62 * clamp01(real.elev) : l.dir[1];
    const dz = real ? -0.5 : l.dir[2];
    const n = Math.hypot(dx, dy, dz) || 1;
    lights.key.position.set(dx / n * 6, dy / n * 6, -dz / n * 6);
    lights.key.intensity = l.intensity * (real ? 0.34 + 0.66 * clamp01(real.amp) : 1);
    // Пасмурно и ночь — холоднее: тот же приём, что `tintPal` у пропов.
    const cold = real && real.amp < 0.5;
    const c = cold ? [0.84, 0.88, 0.98] : l.color;
    lights.key.color.setRGB(c[0], c[1], c[2]);
    lights.hemi.color.setRGB(l.sky[0], l.sky[1], l.sky[2]);
    lights.hemi.groundColor.setRGB(l.ground[0], l.ground[1], l.ground[2]);
    lights.hemi.intensity = l.ambient + (real ? 0.44 * clamp01(real.amb) : 0.5);
}
function applySun() { liveSun(LIVE.tone || null); }

/* ---------------------------------- герой: меши ---------------------------------- */
const rgb255 = (hex) => {
    const c = String(hex || "#ffffff").replace("#", "");
    if (c.length < 6) return [255, 255, 255];
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
};
const asHex = (rgb) => {
    const h = (v) => Math.max(0, Math.min(255, Math.round(v || 0))).toString(16).padStart(2, "0");
    return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
};

function buildGeometry(mesh) {
    const bytes = decode(mesh.verts);
    const idxBytes = decode(mesh.idx);
    const n = mesh.count;
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const skIdx = new Uint16Array(n * 4);
    const skWgt = new Uint8Array(n * 4);
    const s = mesh.scale;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let v = 0; v < n; v += 1) {
        const o = v * 13;
        pos[v * 3] = view.getInt16(o, true) * s[0];
        pos[v * 3 + 1] = view.getInt16(o + 2, true) * s[1];
        pos[v * 3 + 2] = view.getInt16(o + 4, true) * s[2];
        const nx = view.getInt8(o + 6), ny = view.getInt8(o + 7), nz = view.getInt8(o + 8);
        const len = Math.hypot(nx, ny, nz) || 1;
        nrm[v * 3] = nx / len; nrm[v * 3 + 1] = ny / len; nrm[v * 3 + 2] = nz / len;
        // У DataView НЕТ доступа по индексу: `view[o+9]` — это undefined, а
        // undefined в Uint8Array пишется как 0. Позиции и нормали читались
        // геттерами и были в порядке, а вот яркость, кости и веса молча стали
        // нулями: меш схлопнулся в одну точку (в кадре — точка у ног вместо
        // героя). Только геттеры, и проверка силуэта кадра это ловит.
        const lum = view.getUint8(o + 9) / 255;
        col[v * 3] = lum; col[v * 3 + 1] = lum; col[v * 3 + 2] = lum;
        skIdx[v * 4] = view.getUint8(o + 10); skIdx[v * 4 + 1] = view.getUint8(o + 11);
        skWgt[v * 4] = view.getUint8(o + 12); skWgt[v * 4 + 1] = 255 - view.getUint8(o + 12);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skIdx, 4));
    geo.setAttribute("skinWeight", new THREE.Uint8BufferAttribute(skWgt, 4, true));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(idxBytes.buffer, idxBytes.byteOffset, idxBytes.byteLength / 2), 1));
    geo.computeBoundingSphere();
    return geo;
}
/** Кости в bind-позе: обратные матрицы скелет считается по ним, поэтому порядок
 *  строго такой — иерархия → updateMatrixWorld → Skeleton. */
function buildSkeleton() {
    const bones = META.bones.map(b => {
        const bone = new THREE.Bone();
        bone.name = b.name;
        bone.position.set(b.t[0], b.t[1], b.t[2]);
        bone.quaternion.set(b.r[0], b.r[1], b.r[2], b.r[3]);
        if (b.s) bone.scale.set(b.s[0], b.s[1], b.s[2]);
        return bone;
    });
    META.bones.forEach((b, i) => {
        if (b.parent >= 0 && b.parent < bones.length) bones[b.parent].add(bones[i]);
        else root.add(bones[i]);
    });
    root.updateMatrixWorld(true);
    return new THREE.Skeleton(bones);
}

/**
 * Собрать героя под образ. Пол и причёска — это ВЫБОР МЕШЕЙ, а не цвета: отсюда и
 * честная женская фигура, и разные стрижки. Цвета (кожа/ткань/штаны/волосы) идут в
 * материалы как есть, без квантования в палитру.
 */
export function liveLook(look) {
    const who = look && look.gender === "female" ? "female" : "male";
    const style = (look && look.hairStyle) || "short";
    const key = `${who}/${style}`;
    if (lookCache.has(key)) return lookCache.get(key);
    if (!LIVE.ready) return null;
    const spec = META.looks[key] || META.looks[`${who}/short`] || META.looks["male/short"];
    if (!spec) return null;
    const tintHex = {
        skin: look?.skin || "#e0b594",
        cloth: look?.coat || "#446d68",
        pants: look?.pants || "#48473e",
        hair: look?.hair || "#302b29"
    };
    const group = new THREE.Group();
    group.name = `hero:${key}`;
    let skeleton = null;
    const meshes = [];
    for (const partKey of spec.parts) {
        const part = META.parts[partKey];
        if (!part) continue;
        for (const mesh of part.meshes) {
            if (!skeleton) skeleton = buildSkeleton();
            const hex = mesh.tint ? (tintHex[mesh.tint] || "#ffffff") : asHex(mesh.color || [255, 255, 255]);
            const mat = new THREE.MeshLambertMaterial({
                color: new THREE.Color(...rgb255(hex).map(v => v / 255)),
                vertexColors: true,               // яркость из текстуры: складки есть, палитры нет
                side: THREE.DoubleSide,
                // Одежда всегда выигрывает глубину у подкладки, глаза — у кожи.
                // Раньше это делалось «порядком слоёв», и именно поэтому сквозь
                // куртку была видна задница.
                polygonOffset: true,
                polygonOffsetFactor: mesh.tint === "cloth" || mesh.tint === "pants" ? -2
                    : !mesh.tint ? -4 : -1,
                polygonOffsetUnits: -1
            });
            const obj = new THREE.SkinnedMesh(buildGeometry(mesh), mat);
            obj.name = `${partKey}/${mesh.name}`;
            obj.frustumCulled = false;
            obj.matrixAutoUpdate = false;
            obj.bind(skeleton, new THREE.Matrix4());
            group.add(obj);
            meshes.push(obj);
        }
    }
    if (!skeleton) return null;
    const bad = validateMeshes(meshes, META.bones.length);
    if (bad) {
        // Молча рисовать мусор — худший вариант: лучше лист, чем точка у ног.
        LIVE.error = `живой рендер: ${bad}`;
        LIVE.reason = "bad-mesh";
        for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); }
        return null;
    }
    root.add(group);
    const entry = { key, who, style, group, meshes, skeleton };
    lookCache.set(key, entry);
    LIVE.looks = lookCache.size;
    return entry;
}

/**
 * Проверка собранной геометрии. Нули в весах (например, если `DataView` прочитали
 * «по индексу» и получили undefined) не падают — они складывают меш в одну точку
 * у ног, и в браузере это выглядит как «герой пропал». Поэтому считаем сами.
 */
function validateMeshes(meshes, boneCount) {
    let verts = 0, nan = 0, badW = 0, badBone = 0;
    for (const mesh of meshes) {
        const g = mesh.geometry;
        const pos = g.attributes.position.array;
        const col = g.attributes.color ? g.attributes.color.array : null;
        const si = g.attributes.skinIndex.array;
        const sw = g.attributes.skinWeight.array;
        for (let v = 0, n = pos.length / 3; v < n; v += 1) {
            verts += 1;
            if (!Number.isFinite(pos[v * 3]) || !Number.isFinite(pos[v * 3 + 1]) || !Number.isFinite(pos[v * 3 + 2])
                || (col && !Number.isFinite(col[v * 3]))) nan += 1;
            const w = sw[v * 4] + sw[v * 4 + 1];
            if (w < 250 || w > 255) badW += 1;
            if (si[v * 4] >= boneCount || si[v * 4 + 1] >= boneCount) badBone += 1;
        }
    }
    if (!verts) return "ни одной вершины";
    if (nan) return `${nan} вершин из ${verts} с NaN в позиции/цвете`;
    if (badW > verts * 0.02) return `${badW} вершин из ${verts} без веса (скиннинг сложит их в точку)`;
    if (badBone) return `${badBone} вершин с номером кости вне скелета`;
    return null;
}
/** Наружу — для тестов и панели: что проверки увидели в собранном образе. */
export function liveValidate(look) {
    const entry = liveLook(look);
    if (!entry) return { ok: false, error: LIVE.error || "образ не собран" };
    const bad = validateMeshes(entry.meshes, META.bones.length);
    return { ok: !bad, error: bad || "", verts: entry.meshes.length, parts: entry.key };
}

/** Активный образ один: остальные прячутся, а не рисуются слоями под героем. */
function activate(entry) {
    for (const other of lookCache.values()) other.group.visible = other === entry;
    LIVE.active = entry.key;
}
export function liveReset() {
    for (const entry of lookCache.values()) {
        for (const mesh of entry.meshes) { mesh.geometry.dispose(); mesh.material.dispose(); }
        if (entry.group.parent) entry.group.parent.remove(entry.group);
    }
    lookCache.clear();
    LAST = null;
    LIVE.looks = 0;
}
/** Пересобрать цвета без пересборки геометрии (ползунки палитры в редакторе внешности). */
export function liveRecolor(look) {
    const entry = liveLook(look);
    if (!entry) return false;
    const tintHex = {
        skin: look?.skin || "#e0b594", cloth: look?.coat || "#446d68",
        pants: look?.pants || "#48473e", hair: look?.hair || "#302b29"
    };
    for (const mesh of entry.meshes) {
        const name = mesh.name;
        const part = name.split("/")[0];
        const spec = META.parts[part];
        if (!spec) continue;
        const local = spec.meshes.find(m => name.endsWith(`/${m.name}`));
        if (!local) continue;
        const hex = local.tint ? (tintHex[local.tint] || "#ffffff") : asHex(local.color || [255, 255, 255]);
        mesh.material.color.setRGB(...rgb255(hex).map(v => v / 255));
    }
    return true;
}

/**
 * Поставить камеру в базис кадра. Ровно этот пересчёт отвечает за то, что
 * ОТРИСОВАННЫЕ пиксели и якоря кисти лежат на одной сетке: ортография взята из
 * `project`, а строка опоры — из `f.rowFeet`, поэтому асимметричные top/bottom
 * сдвигают проекцию на те же доли пикселя, что и формула кадра. Сдвигать вместо
 * этого камеру по мировой +Y нельзя: ось `up` наклонена (pitch 0.2), и герой
 * уезжал бы на полпикселя вверх-вниз при каждом повороте.
 */
function applyCamera(f) {
    const halfH = CELL.h / 2 * M_PER_PX, halfW = CELL.w / 2 * M_PER_PX;
    const c = halfH * (2 * f.rowFeet / CELL.h - 1);
    camera.left = -halfW; camera.right = halfW;
    camera.top = c + halfH; camera.bottom = c - halfH;
    camera.position.set(f.eye[0], f.eye[1], f.eye[2]);
    camera.up.set(f.up[0], f.up[1], f.up[2]);
    camera.lookAt(f.eye[0] + f.fwd[0], f.eye[1] + f.fwd[1], f.eye[2] + f.fwd[2]);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return camera;
}
/** Мировая точка → пиксель кадра ЧЕРЕЗ камеру: сверка с `project` в тестах. */
export function cameraPixel(f, p) {          // тот же порядок аргументов, что у project
    applyCamera(f);
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
    return [(v.x * 0.5 + 0.5) * CELL.w, (0.5 - v.y * 0.5) * CELL.h];
}

/* ---------------------------------- поза и кадр --------------------------------- */
/** Какую позу просит состояние актёра — те же правила, что `heroPose` у листа. */
export function livePose(p) {
    const dir = p.dir === "left" || p.dir === "right" || p.dir === "up" ? p.dir : "down";
    const act = p.actionTimer > 0 ? clamp01(1 - p.actionTimer / 0.35) : -1;
    if (act >= 0) {
        const kind = { chop: "chop", mine: "mine", gather: "gather" }[p.actionKind] || "attack";
        const label = META.clips[kind] ? kind : "attack";
        return { dir, label, frame: Math.min(1, act) * META.clips[label].frames };
    }
    if (p.fallTimer > 0) return { dir, label: "idle", frame: 0 };
    const gait = clamp01(p.gait != null ? p.gait : (p.moving ? 1 : 0));
    if (gait > 0.06) {
        const run = clamp01(p.runBlend || 0);
        const label = run > 0.55 && META.clips.run ? "run" : "walk";
        const phase = ((p.phase || 0) % TAU + TAU) % TAU;
        return { dir, label, frame: (phase / TAU) * META.clips[label].frames };
    }
    const left = p.leftTool;
    const torchInLeft = left === "torch" || left?.tool === "torch";
    if (torchInLeft && META.clips.torch) {
        return { dir, label: "torch", frame: ((p.idleTime || 0) * META.clips.torch.fps) % META.clips.torch.frames };
    }
    const idle = META.clips.idle || { fps: 6, frames: 4 };
    return { dir, label: "idle", frame: ((p.idleTime || 0) * idle.fps) % idle.frames };
}
const FRAMES = new Map(META.frames.map(f => [f.yaw, f]));
const ZERO = 1e-9;
const frameForDir = (dir) => FRAMES.get(dir === "left" ? Math.PI / 2
    : dir === "right" ? -Math.PI / 2 : dir === "up" ? Math.PI : 0);

/** Кости в кадр клипа. Дискретный, как у листа: интерполяция здесь не «плавнее»,
 *  а мыло на границе шага, и сравнение с листом перестало бы быть попиксельным. */
function applyFrame(entry, label, frame) {
    const clip = META.clips[label];
    if (!clip) return false;
    const bytes = decode(clip.data);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const f = ((Math.floor(frame) % clip.frames) + clip.frames) % clip.frames;
    const base = f * clip.bones * 14;
    const bones = entry.skeleton.bones;
    for (let i = 0; i < clip.bones; i += 1) {
        const bone = bones[i];
        if (!bone) continue;
        const o = base + i * 14, rest = META.bones[i];
        bone.position.set(
            rest.t[0] + view.getInt16(o, true) * clip.tScale,
            rest.t[1] + view.getInt16(o + 2, true) * clip.tScale,
            rest.t[2] + view.getInt16(o + 4, true) * clip.tScale
        );
        bone.quaternion.set(
            view.getInt16(o + 6, true) / 32767, view.getInt16(o + 8, true) / 32767,
            view.getInt16(o + 10, true) / 32767, view.getInt16(o + 12, true) / 32767
        );
    }
    root.updateMatrixWorld(true);
    entry.skeleton.update();
    return true;
}
const boneOf = (entry, name) => entry.skeleton.getBoneByName(name);
/** Мировозвращение кости в метрах модели. */
function boneWorld(entry, name) {
    const bone = boneOf(entry, name);
    if (!bone) return null;
    const m = bone.matrixWorld.elements;
    return [m[12], m[13], m[14]];
}
const handName = (base, side) => (side === "l" ? base.replace(/_r$/, "_l") : base);
/** Кулак = середина запястье↔фаланга; та же точка, что пишет якорь листа. */
function fistWorld(entry, side) {
    const f = META.fist;
    const w = boneWorld(entry, handName(f.wrist, side)), k = boneWorld(entry, handName(f.knuckle, side));
    if (!w || !k) return null;
    return [(w[0] + k[0]) / 2, (w[1] + k[1]) / 2, (w[2] + k[2]) / 2];
}
function project(f, p) {
    const d = [p[0] - f.eye[0], p[1] - f.eye[1], p[2] - f.eye[2]];
    const dot = v => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    return [CELL.w / 2 + dot(f.right) * META.unit, f.rowFeet - dot(f.up) * META.unit];
}
/** Пиксель кадра → единицы мира: тот же пересчёт, что `toUnits` у пекаря. */
const toUnits = (pxX, pxY) => ({ x: (pxX - CELL.w / 2) * U, y: (pxY - (CELL.h - META.footPad)) * U });

/**
 * Кадр: применить позу, отрисовать, вернуть контракт листа. null — живой рендер
 * недоступен, и вызывающий (hero3d.js) честно рисуёт листом.
 */
export function liveFrame(p, look, opts = {}) {
    if (!LIVE.ready || !renderer) { LIVE.skipped += 1; return null; }
    const entry = liveLook(look || p.look);
    if (!entry) { LIVE.skipped += 1; return null; }
    const pose = livePose(p);
    const f = frameForDir(pose.dir);
    if (!f) { LIVE.skipped += 1; return null; }
    if (!applyFrame(entry, pose.label, pose.frame)) { LIVE.skipped += 1; return null; }
    activate(entry);
    applyCamera(f);
    if (opts.hideHands) hideHands(entry, true);
    renderer.render(scene, camera);
    if (opts.hideHands) hideHands(entry, false);
    if (gl && gl.isContextLost && gl.isContextLost()) {
        // Телефон мог забрать контекст (фоновая вкладка, ещё один canvas): молча
        // рисовать пустоту нельзя — возвращаем лист и говорим почему.
        LIVE.ready = false;
        LIVE.error = "WebGL-контекст потерян";
        LIVE.reason = "context-lost";
        LIVE.skipped += 1;
        return null;
    }
    if (!auditFrame()) {
        LIVE.skipped += 1;
        return null;
    }
    LIVE.frames += 1;
    const canvas = withInk(renderer.domElement);
    LAST = { entry, frame: pose.frame, label: pose.label, dir: pose.dir, f, canvas };
    return {
        canvas, dir: pose.dir, label: pose.label,
        index: Math.floor(pose.frame), pixels: null, wet: null, live: true, ink: liveInkPx(),
        x: -CELL.w / 2 * U, y: TOP, w: CELL.w * U, h: CELL.h * U,
        grip: () => null,
        hidden: (hand) => liveHidden(entry, f, hand),
        covers: () => false
    };
}
/**
 * Временное «без кистей» для теста глубины. ИМЕНА брать осторожно: у костюма
 * свои меши рукавиц, и снять их — значит проверить не то. Поэтому только кисти
 * скелета (`*_hand_*` / `hand_l|r`) и пальцы, а не «всё, где есть hand».
 */
/**
 * Обводка кадра. У листа она запечена (индекс палитры 59 = `ink`), у пропов —
 * тоже, а у живого рендера её не было: поэтому герой и выглядел «приклеенным».
 * Делается без шейдеров: силуэт сдвигается на inkPx по четырём сторонам,
 * заливается чернилами, а сверху кладётся сам кадр. Нижняя строка при этом
 * приходит ровно к линии опоры — настолько же, насколько у листа (rowFeet уже
 * поднят на inkPx пекаря).
 */
let inkCv = null;
/**
 * Толщина обводки кадра. Наружу — чтобы `tools/hero-live-raster.js` сверял с листом
 * РОВНО тот силуэт, который рисует withInk: снял или изменил обводку — покрытие
 * кадра падает следом, и тест это видит.
 */
export const liveInkPx = () => (META.ink ? Math.max(1, META.inkPx || 2) : 0);
function withInk(src) {
    const px = liveInkPx();
    // Чернила — свойство КАДРА, а не среды: величину читают и тесты (в node нет
    // document), а применяем мы её только там, где есть 2D-холст.
    if (px <= 0 || typeof document === "undefined" || !src) return src;
    if (!inkCv || inkCv.width !== CELL.w) {
        inkCv = document.createElement("canvas");
        inkCv.width = CELL.w; inkCv.height = CELL.h;
    }
    const c = inkCv.getContext("2d");
    if (!c) return src;
    c.save();
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, CELL.w, CELL.h);
    for (const [dx, dy] of [[-px, 0], [px, 0], [0, -px], [0, px],
                           [-px, -px], [px, -px], [-px, px], [px, px]]) {
        c.drawImage(src, dx, dy);
    }
    c.globalCompositeOperation = "source-in";
    c.fillStyle = META.ink;
    c.fillRect(0, 0, CELL.w, CELL.h);
    c.globalCompositeOperation = "source-over";
    c.drawImage(src, 0, 0);
    c.restore();
    return inkCv;
}

/**
 * Первый (и только он) кадр проверяется по-настоящему: читаем альфу всего кадра и
 * требуем, чтобы герой в нём был. Это не «тест на GPU в браузере» — это страховка
 * от того класса поломки, который глазами выглядит как «персонаж пропал»: меши
 * собраны, кости посчитаны, а пикселей нет.
 */
let auditBuf = null;
function auditFrame() {
    if (LIVE.audited) return true;
    if (!gl || !renderer) { LIVE.audited = true; return true; }
    try {
        const n = CELL.w * CELL.h;
        if (!auditBuf) auditBuf = new Uint8Array(n * 4);
        renderer.render(scene, camera);
        gl.readPixels(0, 0, CELL.w, CELL.h, gl.RGBA, gl.UNSIGNED_BYTE, auditBuf);
        let lit = 0;
        for (let i = 3; i < auditBuf.length; i += 4) if (auditBuf[i] > 8) lit += 1;
        LIVE.coverage = lit;
        LIVE.audited = true;
        if (lit < MIN_COVERAGE) {
            LIVE.error = `живой кадр пуст: ${lit} пикселей из ${n} (нужно ≥ ${MIN_COVERAGE})`;
            LIVE.reason = "empty-frame";
            return false;
        }
        return true;
    } catch (err) {
        LIVE.audited = true;
        LIVE.error = `кадр не проверить: ${String((err && err.message) || err).slice(0, 120)}`;
        LIVE.reason = "audit";
        return false;
    }
}
/** Сброс аудита — для панели разработчика («перепроверь кадр»). */
export function liveReaudit() { LIVE.audited = false; LIVE.coverage = -1; LIVE.error = ""; LIVE.reason = ""; }

function hideHands(entry, on) {
    for (const mesh of entry.meshes) {
        const base = mesh.name.split("/").pop();
        if (/^(hand|finger|thumb|index|middle|ring|pinky)_?[lrf]?/i.test(base) || /_(leaf|fnt)/.test(base)) {
            mesh.visible = !on;
        }
    }
}

/**
 * Скрыта ли кисть за телой: рендер БЕЗ кистей и сравнение альфы в точке кулака —
 * ровно тот же тест, что делала запекка по буферу глубины. Один пиксель, один
 * вызов на руку, только когда в руке предмет.
 */
function liveHidden(entry, f, side) {
    if (!gl || !renderer) return false;
    const fist = fistWorld(entry, side === "left" ? "l" : "r");
    if (!fist) return false;
    const [pxX, pxY] = project(f, fist);
    const x = Math.max(0, Math.min(CELL.w - 1, Math.round(pxX)));
    const y = Math.max(0, Math.min(CELL.h - 1, Math.round(CELL.h - 1 - pxY)));
    try {
        hideHands(entry, true);
        renderer.render(scene, camera);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        hideHands(entry, false);
        return px[3] === 0;
    } catch {
        hideHands(entry, false);
        return false;
    }
}

/**
 * Якорь кисти для предмета в руке — из тех же костей, что и отрисованный кадр.
 * `probe` — тот же расчёт без рендера: он нужен тестам (и отладочной панели),
 * чтобы сверять фрейминг живого рендера с запечённым листом попиксельно.
 */
export function liveHandAnchor(p, look, hand = "right", extra = {}) {
    if (!LAST) return null;
    const { entry, f } = LAST;
    const side = hand === "left" ? "l" : "r";
    const fist = fistWorld(entry, side);
    if (!fist) return null;
    const [pxX, pxY] = project(f, fist);
    const u = toUnits(pxX, pxY);
    const elbow = boneWorld(entry, handName(META.fist.elbow, side));
    let ang = ZERO;
    if (elbow) {
        const [ex, ey] = project(f, elbow);
        ang = Math.atan2(pxX - ex, ey - pxY);
    }
    const angle = extra.follow ? ang : (extra.angle || 0);
    return {
        x: u.x, y: u.y, gripX: u.x, gripY: u.y, angle,
        noMirror: !!extra.follow, intensity: extra.intensity ?? 1,
        behind: !!extra.behind, hand
    };
}

/** Всё, что показывает штамп сборки и панель отладки. */
export const liveInfo = () => ({
    on: LIVE.on, ready: LIVE.ready, looks: LIVE.looks, frames: LIVE.frames,
    skipped: LIVE.skipped, error: LIVE.error, reason: LIVE.reason, active: LIVE.active,
    coverage: LIVE.coverage, audited: LIVE.audited, inkPx: liveInkPx(),
    cell: CELL, pxPerUnit: META.pxPerUnit, footPad: META.footPad,
    parts: Object.keys(META.parts).length, clips: Object.keys(META.clips).length,
    source: META.source, tool: META.tool
});

/**
 * Якорь без кадра: (look, поза, кадр, ракурс, рука) → единицы мира от линии стоп.
 * Тем же кодом, что рисует: расхождение с `META.anchors` листа = баг фрейминга.
 */
export function liveProbe(look, label = "idle", frame = 0, dir = "down", side = "r") {
    const entry = liveLook(look);
    const f = frameForDir(dir);
    if (!entry || !f || !applyFrame(entry, label, frame)) return null;
    const fist = fistWorld(entry, side);
    if (!fist) return null;
    const [pxX, pxY] = project(f, fist);
    const u = toUnits(pxX, pxY);
    const elbow = boneWorld(entry, handName(META.fist.elbow, side));
    let ang = ZERO;
    if (elbow) {
        const [ex, ey] = project(f, elbow);
        ang = Math.atan2(pxX - ex, ey - pxY);
    }
    // camPx — та же точка, прогнанная через камеру three.js. Если она расходится с
    // `project`, то нарисованный кадр и якорь предмета живут на разных сетках.
    const [cx, cy] = cameraPixel(f, fist);
    return { x: u.x, y: u.y, angle: ang, px: pxX, py: pxY, camPx: cx, camPy: cy, meshes: entry.meshes.length };
}
/**
 * Точки ОДИН РАЗ посчитанного скиннинга — в пикселях кадра. Это ровно то, что в
 * браузере делает GPU (`boneMatrices` = world×boneInverse, веса из атрибутов),
 * поэтому расхождение силуэта с листом видно и без WebGL. `liveProbe` сверяет
 * одну точку (кулак), а здесь сверяется ВЕСЬ кадр.
 */
export function liveSkinnedPoints(look, label = "idle", frame = 0, dir = "down") {
    const entry = liveLook(look);
    const f = frameForDir(dir);
    if (!entry || !f || !applyFrame(entry, label, frame)) return null;
    const mats = entry.skeleton.boneMatrices;
    const xs = [], ys = [], tris = [];
    for (const mesh of entry.meshes) {
        if (mesh.visible === false) continue;
        const g = mesh.geometry;
        const pos = g.attributes.position.array;
        const si = g.attributes.skinIndex.array;
        const sw = g.attributes.skinWeight.array;
        const idx = g.index ? g.index.array : null;
        const n = pos.length / 3;
        const ox = xs.length;
        for (let v = 0; v < n; v += 1) {
            let x = 0, y = 0, z = 0;
            for (let k = 0; k < 2; k += 1) {
                const w = sw[v * 4 + k] / 255;
                if (!w) continue;
                const b = si[v * 4 + k] * 16;
                const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
                x += w * (mats[b] * px + mats[b + 4] * py + mats[b + 8] * pz + mats[b + 12]);
                y += w * (mats[b + 1] * px + mats[b + 5] * py + mats[b + 9] * pz + mats[b + 13]);
                z += w * (mats[b + 2] * px + mats[b + 6] * py + mats[b + 10] * pz + mats[b + 14]);
            }
            const [sx, sy] = project(f, [x, y, z]);
            xs.push(sx); ys.push(sy);
        }
        if (idx) for (let t = 0; t < idx.length; t += 3) tris.push(ox + idx[t], ox + idx[t + 1], ox + idx[t + 2]);
    }
    return { xs: Float32Array.from(xs), ys: Float32Array.from(ys), tris: Uint32Array.from(tris) };
}
/** Пакетный базис кадра — наружу, чтобы инструменты сверяли ту же сетку. */
export const liveFrameBasis = (dir) => frameForDir(dir);

/** Готовность среды без WebGL-рендерера: сцена/кости/проекция работают и в node. */
export function enableForTests(three) {
    if (LIVE.ready) return true;
    THREE = three;
    if (!THREE) return false;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 40);
    root = new THREE.Group();
    scene.add(camera);
    scene.add(root);
    buildLights();
    applySun();
    LIVE.ready = true; LIVE.on = true;
    return true;
}

/** Тесты и превью: живой рендер можно собрать? (WebGL+three+пакет). */
export const liveAvailable = () => LIVE.ready || liveSupported();
export const liveLooks = () => Object.keys(META.looks);
export const liveClipFrames = (label) => (META.clips[label] ? META.clips[label].frames : 0);
