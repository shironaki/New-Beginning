/**
 * tools/hero-live-check.js — сверка ЖИВОГО 3D-рендера с запечённым листом.
 *
 * Тесты в node не имеют WebGL, поэтому «картинка» проверяется так: сцена three.js
 * собирается целиком (кости, меши, веса, кадры клипов), а проекция кулака из той же
 * сцены сверяется с якорем листа. Расхождение в пикселях = расхождение самого
 * кадра: стопа встанет не на землю, а предмет в руке уедет с ладони.
 *
 * Второе, что проверяется молча в старом пути: пол и причёска обязаны давать РАЗНУЮ
 * геометрию, а не один лист в разной краске. Здесь сравнивается вершинный габарит
 * мужского и женского образа — если он совпадает, «выбрал женщину, а он всё ещё он»
 * вернулось.
 *
 *   node tools/hero-live-check.js
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function check(opts = {}) {
    const THREE = await import(`${path.join(ROOT, "js/vendor/three.module.js").replace(/\\/g, "/")}`.replace(/^/, "file://"));
    const live = await import(`${path.join(ROOT, "js/render/hero3d-live.js").replace(/\\/g, "/")}`.replace(/^/, "file://"));
    const sheet = await import(`${path.join(ROOT, "js/render/heroframes.js").replace(/\\/g, "/")}`.replace(/^/, "file://"));
    if (!live.enableForTests(THREE)) throw new Error(`живой рендер не собрался: ${live.LIVE.error}`);

    const meta = sheet.META;
    const PX = meta.pxPerUnit, CELL = meta.cell, FOOT = meta.footPad;
    const looks = {
        male: { gender: "male", hairStyle: "long", skin: "#e0b594", coat: "#446d68", pants: "#48473e", hair: "#302b29" },
        female: { gender: "female", hairStyle: "short", skin: "#ba8864", coat: "#785044", pants: "#3a2f28", hair: "#825332" }
    };
    const out = { anchors: { tested: 0, worst: 0, sum: 0 }, boxes: {}, parts: {}, error: live.LIVE.error };

    // 1) якорь живого кадра против запечённого якоря того же кадра
    const probeLook = looks.male;
    const entry = live.liveLook(probeLook);
    if (!entry) throw new Error("liveLook не собрал образ");
    out.parts[entry.key] = entry.meshes.map(m => m.name);
    for (const pose of meta.poses) {
        for (const dir of ["down", "left", "right", "up"]) {
            const anchors = (meta.anchors || {})[`${dir}/${pose.label}`];
            if (!anchors?.r) continue;
            for (let f = 0; f < pose.frames; f += 1) {
                const baked = anchors.r[f];
                if (!baked) continue;
                const p = live.liveProbe(probeLook, pose.label, f, dir, "r");
                if (!p) continue;
                const bx = baked[0] * PX + CELL.w / 2;
                const by = baked[1] * PX + (CELL.h - FOOT);
                const d = Math.hypot(p.px - bx, p.py - by);
                out.anchors.tested += 1; out.anchors.sum += d;
                out.anchors.worst = Math.max(out.anchors.worst, d);
                // …и что камера рисует ровно там, где якорь посчитан.
                out.camera = out.camera || { worst: 0 };
                out.camera.worst = Math.max(out.camera.worst, Math.hypot(p.camPx - p.px, p.camPy - p.py));
            }
        }
    }
    out.anchors.mean = out.anchors.tested ? out.anchors.sum / out.anchors.tested : 0;

    // 2) пол и причёска = разная геометрия, а не разная краска
    const boxOf = (look) => {
        const e = live.liveLook(look);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, verts = 0, tris = 0;
        for (const mesh of e.meshes) {
            const pos = mesh.geometry.attributes.position.array;
            const idx = mesh.geometry.index;
            tris += idx ? idx.count / 3 : 0;
            for (let i = 0; i < pos.length; i += 3) {
                verts += 1;
                if (pos[i] < x0) x0 = pos[i]; if (pos[i] > x1) x1 = pos[i];
                if (pos[i + 1] < y0) y0 = pos[i + 1]; if (pos[i + 1] > y1) y1 = pos[i + 1];
            }
        }
        return { verts, tris: Math.round(tris), width: +(x1 - x0).toFixed(4), height: +(y1 - y0).toFixed(4) };
    };
    const styles = ["long", "short", "bun", "buzz", "bald"];
    for (const who of ["male", "female"]) {
        for (const style of styles) {
            out.boxes[`${who}/${style}`] = boxOf({ ...looks[who], hairStyle: style });
        }
    }
    const worst = +out.anchors.worst.toFixed(2);
    const cam = +(out.camera?.worst ?? 99).toFixed(3);
    const ok = out.anchors.tested > 0 && worst <= (opts.maxPx ?? 1) && cam <= 0.01;
    out.cameraPx = cam;
    return { ...out, ok, worst, parts: Object.keys(out.parts).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const res = await check();
    console.log(`LIVE: кадров сверено ${res.anchors.tested} · среднее ${res.anchors.mean.toFixed(2)} px · худший ${res.worst} px · камера↔формула ${res.cameraPx} px`);
    for (const [key, box] of Object.entries(res.boxes)) {
        console.log(`     ${key.padEnd(14)} вершин ${String(box.verts).padStart(6)} · треугов ${String(box.tris).padStart(6)} · ширина ${box.width} · высота ${box.height}`);
    }
    const m = res.boxes["male/long"], f = res.boxes["female/long"];
    console.log(`пол меняет геометрию: ${m.verts !== f.verts && Math.abs(m.height - f.height) > 1e-4 ? "да" : "НЕТ"}`);
    if (!res.ok) { console.error(`❌ живой рендер не совпадает с листом: якорь ${res.worst} px (нужно ≤ 1), камера↔формула ${res.cameraPx} px (нужно ≤ 0.01)`); process.exit(1); }
    console.log("✅ живой кадр садится в сетку листа");
}
