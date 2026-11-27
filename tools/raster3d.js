/**
 * tools/raster3d.js — программный ортографический растеризатор для запекки спрайтов.
 *
 * Зачем: в песочнице нет WebGL, а спрайты героя надо собрать из настоящей 3D-модели
 * Quaternius. Поэтому рендер пишем сами — ровно тот, что нужен для покадровой запекки:
 * ортографическая камера (в игре персонаж и так рисуется без перспективы), один источник
 * света + небесная полусфера, аффинная интерполяция UV (в орто-проекции она точна),
 * z-буфер и скиннинг по 4 костям на вершину.
 *
 * Осветка задаётся в ПРОСТРАНСТВЕ КАМЕРЫ, а не мира: тогда персонаж освещён одинаково,
 * с какой стороны бы ни стоял, — ровно как в векторном рендере игры, где грань темнее,
 * когда она разворачивается от наблюдателя.
 */

const SRGB_TO_LINEAR = new Float32Array(256);
const LINEAR_TO_SRGB = new Uint8Array(256 * 256);
for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
for (let i = 0; i < 256 * 256; i += 1) {
    const lin = (i / 255) / 255;
    const s = lin <= 0.0031308 ? lin * 12.92 : 1.055 * (lin ** (1 / 2.4)) - 0.055;
    LINEAR_TO_SRGB[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
}

export function makeFrame(width, height) {
    return {
        width, height,
        data: new Uint8ClampedArray(width * height * 4),
        depth: new Float32Array(width * height).fill(-Infinity),
        // Чей это материал (0 = не дорожка). По этой маске запекка раскладывает пиксели
        // по цветовым дорожкам образа: куртка/кожа/волосы красятся в рантайме, а не
        // в пекарне, — см. RAMP_* в tools/hero-bake.js.
        track: new Uint8Array(width * height),
        // Куда смотрит грань в этой точке (0 = не задано, 1..6 = +X,-X,+Y,-Y,+Z,-Z
        // в системе взгляда). 3D-проп — это растр, нормалей в нём нет, а рантайму
        // нужно что-то, по чему пересчитывать светотень под солнце и погоду.
        face: new Uint8Array(width * height)
    };
}

export function clearFrame(frame, rgba = null) {
    frame.depth.fill(-Infinity);
    frame.track.fill(0);
    frame.face.fill(0);
    if (rgba) {
        for (let i = 0; i < frame.data.length; i += 4) {
            frame.data[i] = rgba[0]; frame.data[i + 1] = rgba[1];
            frame.data[i + 2] = rgba[2]; frame.data[i + 3] = rgba[3];
        }
    } else {
        frame.data.fill(0);
    }
}

/**
 * Базис камеры: yaw — вокруг вертикали, pitch — наклон сверху вниз (радианы).
 * right = fwd × worldUp, up = right × fwd — правая система, как в glTF, поэтому
 * экранная ось Y идёт вверх и персонаж не переворачивается.
 */
export function cameraBasis({ yaw = 0, pitch = 0.28, target = [0, 0.95, 0], distance = 6 }) {
    const cy = Math.cos(yaw); const sy = Math.sin(yaw);
    const cp = Math.cos(pitch); const sp = Math.sin(pitch);
    const eye = [
        target[0] + sy * cp * distance,
        target[1] + sp * distance,
        target[2] + cy * cp * distance
    ];
    const norm = v => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
    };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fwd = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    return { eye, fwd, right, up, target };
}

const DEFAULT_LIGHT = {
    dir: [-0.42, 0.78, 0.46],      // в пространстве камеры: слева-сверху-от наблюдателя
    color: [1.0, 0.96, 0.88],
    intensity: 0.92,
    sky: [0.44, 0.50, 0.58],       // небесная полусфера сверху
    ground: [0.30, 0.25, 0.20],    // тёплый отскок снизу
    ambient: 0.16
};

/**
 * Один кадр: скиннинг → перевод в пространство камеры → растеризация треугольников.
 * drawables: [{positions, normals, uv, joints, weights, indices, jointWorld, factor, texture}]
 */
export function renderFrame(frame, cam, drawables, options = {}) {
    const light = { ...DEFAULT_LIGHT, ...(options.light || {}) };
    const ln = Math.hypot(...light.dir);
    const L = light.dir.map(v => v / ln);
    const pxPerUnit = options.pxPerUnit || 180;
    const cx = frame.width / 2;
    const cy = frame.height / 2;

    const total = drawables.reduce((max, d) => Math.max(max, d.count), 0);
    const view = new Float32Array(total * 3);
    const viewN = new Float32Array(total * 3);
    const { right, up, fwd } = cam.basis;

    for (const d of drawables) {
        const { positions, normals, uv, joints, weights, indices, jointWorld, count } = d;
        const factor = d.factor || [1, 1, 1, 1];
        const tex = d.texture || null;

        for (let v = 0; v < count; v += 1) {
            let px; let py; let pz; let nx; let ny; let nz;
            if (jointWorld && joints && weights) {
                const ox = positions[v * 3]; const oy = positions[v * 3 + 1]; const oz = positions[v * 3 + 2];
                px = 0; py = 0; pz = 0; nx = 0; ny = 0; nz = 0;
                for (let k = 0; k < 4; k += 1) {
                    const w = weights[v * 4 + k];
                    if (!w) continue;
                    const m = jointWorld[joints[v * 4 + k]];
                    if (!m) continue;
                    px += w * (m[0] * ox + m[4] * oy + m[8] * oz + m[12]);
                    py += w * (m[1] * ox + m[5] * oy + m[9] * oz + m[13]);
                    pz += w * (m[2] * ox + m[6] * oy + m[10] * oz + m[14]);
                    if (normals) {
                        const vx0 = normals[v * 3]; const vy0 = normals[v * 3 + 1]; const vz0 = normals[v * 3 + 2];
                        nx += w * (m[0] * vx0 + m[4] * vy0 + m[8] * vz0);
                        ny += w * (m[1] * vx0 + m[5] * vy0 + m[9] * vz0);
                        nz += w * (m[2] * vx0 + m[6] * vy0 + m[10] * vz0);
                    }
                }
            } else {
                px = positions[v * 3]; py = positions[v * 3 + 1]; pz = positions[v * 3 + 2];
                if (normals) { nx = normals[v * 3]; ny = normals[v * 3 + 1]; nz = normals[v * 3 + 2]; }
                else { nx = 0; ny = 0; nz = 1; }
            }

            const dx = px - cam.basis.eye[0];
            const dy = py - cam.basis.eye[1];
            const dz = pz - cam.basis.eye[2];
            const vx = dx * right[0] + dy * right[1] + dz * right[2];
            const vy = dx * up[0] + dy * up[1] + dz * up[2];
            const vz = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
            view[v * 3] = cx + vx * pxPerUnit;
            view[v * 3 + 1] = cy - vy * pxPerUnit;
            // depthBias — намекнуть растеризатору, что этот слой ближе: так одежда
            // поверх тела не начинает мерцать там, где две поверхности почти совпадают.
            view[v * 3 + 2] = -vz + (d.depthBias || 0);

            const nvx = nx * right[0] + ny * right[1] + nz * right[2];
            const nvy = nx * up[0] + ny * up[1] + nz * up[2];
            const nvz = nx * fwd[0] + ny * fwd[1] + nz * fwd[2];
            viewN[v * 3] = nvx;
            viewN[v * 3 + 1] = nvy;
            viewN[v * 3 + 2] = nvz;
        }

        const tri = indices ? indices.length / 3 : count / 3;
        const mappedUv = tex && uv ? uv : null;
        for (let t = 0; t < tri; t += 1) {
            const i0 = indices ? indices[t * 3] : t * 3;
            const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
            const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;
            rasterTriangle(frame, view, viewN, mappedUv, tex, factor, L, light, i0, i1, i2, d.track || 0);
        }
    }
    return frame;
}

function rasterTriangle(frame, view, viewN, uv, tex, factor, L, light, i0, i1, i2, track = 0) {
    const x0 = view[i0 * 3], y0 = view[i0 * 3 + 1], z0 = view[i0 * 3 + 2];
    const x1 = view[i1 * 3], y1 = view[i1 * 3 + 1], z1 = view[i1 * 3 + 2];
    const x2 = view[i2 * 3], y2 = view[i2 * 3 + 1], z2 = view[i2 * 3 + 2];
    const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    if (area === 0) return;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(frame.width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(frame.height - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (maxX < minX || maxY < minY) return;
    const invArea = 1 / area;
    const w = tex ? tex.width : 1;
    const h = tex ? tex.height : 1;

    for (let py = minY; py <= maxY; py += 1) {
        for (let px = minX; px <= maxX; px += 1) {
            const cxp = px + 0.5; const cyp = py + 0.5;
            const w0 = ((x1 - cxp) * (y2 - cyp) - (y1 - cyp) * (x2 - cxp)) * invArea;
            const w1 = ((x2 - cxp) * (y0 - cyp) - (y2 - cyp) * (x0 - cxp)) * invArea;
            const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            const depth = w0 * z0 + w1 * z1 + w2 * z2;
            const idx = py * frame.width + px;
            if (depth <= frame.depth[idx]) continue;
            frame.depth[idx] = depth;
            frame.track[idx] = track;

            let r; let g; let b;
            if (uv) {
                const u = w0 * uv[i0 * 2] + w1 * uv[i1 * 2] + w2 * uv[i2 * 2];
                const v = w0 * uv[i0 * 2 + 1] + w1 * uv[i1 * 2 + 1] + w2 * uv[i2 * 2 + 1];
                // glTF 2.0 (§3.10): v = 0 — ВЕРХНЯЯ строка изображения, а PNG
                // декодируется сверху вниз, поэтому никакого флипа тут быть не
                // должно. Стоял OpenGL-флип (1 - v): на Kenney и Quaternius он был
                // не виден (у Kenney текстур нет вовсе, а одиночную текстуру
                // отзеркалить по вертикали — почти та же картинка), но на паке с
                // общим атласом (KayKit) каждая грань брала цвет соседней плитки:
                // хвоя дерева — у неба (#007450 → #2797d1), камень — у глиняной
                // черепицы. Ошибка была именно про цвет, а не про геометрию.
                const sx = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
                const sy = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
                const ti = (sy * w + sx) * 4;
                if (tex.data[ti + 3] < 24) continue;
                r = SRGB_TO_LINEAR[tex.data[ti]];
                g = SRGB_TO_LINEAR[tex.data[ti + 1]];
                b = SRGB_TO_LINEAR[tex.data[ti + 2]];
            } else {
                r = 1; g = 1; b = 1;
            }
            r *= factor[0]; g *= factor[1]; b *= factor[2];

            let nx = w0 * viewN[i0 * 3] + w1 * viewN[i1 * 3] + w2 * viewN[i2 * 3];
            let ny = w0 * viewN[i0 * 3 + 1] + w1 * viewN[i1 * 3 + 1] + w2 * viewN[i2 * 3 + 1];
            let nz = w0 * viewN[i0 * 3 + 2] + w1 * viewN[i1 * 3 + 2] + w2 * viewN[i2 * 3 + 2];
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl; ny /= nl; nz /= nl;
            // Код стороны света по интерполированной нормали. Считается здесь, а не
            // в пекарне, потому что только здесь есть нормаль каждого пикселя.
            const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
            if (ay >= ax && ay >= az) frame.face[idx] = ny > 0 ? 3 : 4;
            else if (ax >= az) frame.face[idx] = nx > 0 ? 1 : 2;
            else frame.face[idx] = nz > 0 ? 5 : 6;
            const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
            const hemi = 0.5 + 0.5 * ny;
            const ambR = light.ambient + light.sky[0] * hemi + light.ground[0] * (1 - hemi);
            const ambG = light.ambient + light.sky[1] * hemi + light.ground[1] * (1 - hemi);
            const ambB = light.ambient + light.sky[2] * hemi + light.ground[2] * (1 - hemi);
            const lit = light.intensity * ndl;
            r = r * (ambR + lit * light.color[0]);
            g = g * (ambG + lit * light.color[1]);
            b = b * (ambB + lit * light.color[2]);

            const o = idx * 4;
            frame.data[o] = LINEAR_TO_SRGB[Math.min(65535, Math.round(Math.max(0, Math.min(1, r)) * 255) * 255)];
            frame.data[o + 1] = LINEAR_TO_SRGB[Math.min(65535, Math.round(Math.max(0, Math.min(1, g)) * 255) * 255)];
            frame.data[o + 2] = LINEAR_TO_SRGB[Math.min(65535, Math.round(Math.max(0, Math.min(1, b)) * 255) * 255)];
            frame.data[o + 3] = 255;
        }
    }
}
