/**
 * tools/hero-live-raster.js — ЖИВОЙ кадр против запечённого ЛИСТА, по силуэту.
 *
 * Якоря (hero-live-check) проверяют одну точку. Это проверяет ВЕСЬ кадр:
 * скиннинг считается на CPU ровно так же, как его посчитает GPU (boneMatrices ×
 * веса из атрибутов), вершины проецируются базисом кадра, треугольники растеризуются
 * в сетку 101×113 — и получившийся силуэт сравнивается с кадром листа: покрытие,
 * габарит, центроид. Это и есть ответ на «исправляй»: если в браузере герой
 * пропал/сжался/уехал, здесь он так же не совпадёт, и починить это можно без
 * WebGL и без скриншотов.
 *
 *   node tools/hero-live-raster.js            // таблица по 4 ракурсам
 *   node tools/hero-live-raster.js --all       // все позы × 4 ракурса
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = (rel) => new URL(`../${rel}`, import.meta.url).href.replace(/^/, "file://").replace("file://" + ROOT, "file://" + ROOT);

const url = (rel) => `file://${path.join(ROOT, rel)}`;

/** Ряды пикселей листа → покрытие: RLE-поток `heroframes` (run, value), 0 = пусто. */
function decodeStream(b64, cell) {
    const bytes = typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(b64, "base64")) : (() => {
        const bin = atob(b64); const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
        return out;
    })();
    const per = cell.w * cell.h;
    let total = 0;
    for (let i = 0; i + 1 < bytes.length; i += 2) total += bytes[i];
    const indices = new Uint8Array(total);
    let at = 0;
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        const run = bytes[i], value = bytes[i + 1];
        indices.fill(value, at, at + run);
        at += run;
    }
    const count = Math.max(1, Math.round(total / per));
    const frames = [];
    for (let f = 0; f < count; f += 1) frames.push(indices.subarray(f * per, (f + 1) * per));
    return { frames, count };
}

function stats(px, w, h) {
    let n = 0, x0 = w, x1 = -1, y0 = h, y1 = -1, sx = 0, sy = 0;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        if (!px[y * w + x]) continue;
        n += 1; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { n, box: n ? [x0, y0, x1, y1] : null, cx: n ? sx / n : 0, cy: n ? sy / n : 0 };
}

/** Заливка треугольников в сетку кадра (без глубины: нужен силуэт, а неshade). */
function rasterize(pts, W, H) {
    const { xs, ys, tris } = pts;
    const occ = new Uint8Array(W * H);
    for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t], b = tris[t + 1], c = tris[t + 2];
        const ax = xs[a], ay = ys[a], bx = xs[b], by = ys[b], cx = xs[c], cy = ys[c];
        if (!Number.isFinite(ax) || !Number.isFinite(ay)) continue;
        const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(area) < 1e-9) continue;                      // вырожденный triangle
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
        const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
        for (let y = y0; y <= y1; y += 1) {
            const py = y + 0.5;
            for (let x = x0; x <= x1; x += 1) {
                const px = x + 0.5;
                const w0 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
                const w1 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
                const w2 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
                const pos = (w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0);
                if (pos) occ[y * W + x] = 1;
            }
        }
    }
    return occ;
}

/**
 * Раздувание силуэта на p px по осям — то же, что делает обводка кадра в
 * `js/render/hero3d-live.js` (withInk). Сравнивать надо именно раздутый
 * силуэт: без чернил живой кадр легче листа примерно на треть, и «покрытие
 * 64%» выглядело бы претензией, хотя расхождение ровно в толщине обводки.
 */
function dilate(occ, W, H, p) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
        if (!occ[y * W + x]) continue;
        for (const [dx, dy] of [[0, 0], [-p, 0], [p, 0], [0, -p], [0, p]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            out[ny * W + nx] = 1;
        }
    }
    return out;
}

export async function compare(opts = {}) {
    const [THREE, live, sheet] = await Promise.all([
        import(url("js/vendor/three.module.js")),
        import(url("js/render/hero3d-live.js")),
        import(url("js/render/heroframes.js"))
    ]);
    if (!live.enableForTests(THREE)) throw new Error(`живой рендер не собрался: ${live.LIVE.error}`);
    const META = sheet.META, CELL = META.cell;
    const who = opts.who || "male", style = opts.style || "long";
    const look = {
        gender: who, hairStyle: style,
        skin: who === "female" ? "#ba8864" : "#e0b594",
        coat: who === "female" ? "#785044" : "#446d68",
        pants: who === "female" ? "#3a2f28" : "#48473e",
        hair: who === "female" ? "#825332" : "#302b29"
    };
    const dirs = ["down", "left", "right", "up"];
    const poses = opts.all ? META.poses.map(p => p.label) : ["idle", "walk"];
    const rows = [];
    let fail = null;
    for (const dir of dirs) {
        for (const label of poses) {
            const stream = sheet.STREAMS?.[`${dir}/${label}`];
            if (!stream) { rows.push({ dir, label, skip: "нет потока листа" }); if (!fail) fail = { dir, label, bad: "у листа нет потока" }; continue; }
            const pose = decodeStream(stream, CELL);
            const f = Math.min(opts.frame ?? 0, pose.count - 1);
            const pts = live.liveSkinnedPoints(look, label, f, dir);
            if (!pts) {
                // Пропуск — НЕ «нейтральный» результат: иначе проверка молча
                // радуется тому, что сравнивать нечего (так и прошляпили пустой
                // кадр, когда liveLook отказал из-за битых весов).
                rows.push({ dir, label, skip: "live не отдал кадр" });
                if (!fail) fail = { dir, label, bad: `живой рендер не отдал кадр: ${live.LIVE.error || "нет позы/базиса"}` };
                continue;
            }
            const occ = rasterize(pts, CELL.w, CELL.h);
            const liveS = stats(occ, CELL.w, CELL.h);
            // Толщину берём У РЕНДЕРА: withInk рисует ровно столько же.
            const inkPx = opts.inkPx ?? (live.liveInkPx ? live.liveInkPx() : 0);
            const inkS = stats(dilate(occ, CELL.w, CELL.h, inkPx), CELL.w, CELL.h);
            const sheetS = stats(pose.frames[f], CELL.w, CELL.h);
            const cov = sheetS.n ? liveS.n / sheetS.n : 0;
            const dBox = liveS.box && sheetS.box ? Math.max(
                Math.abs(liveS.box[0] - sheetS.box[0]), Math.abs(liveS.box[1] - sheetS.box[1]),
                Math.abs(liveS.box[2] - sheetS.box[2]), Math.abs(liveS.box[3] - sheetS.box[3])
            ) : 999;
            const dC = Math.hypot(liveS.cx - sheetS.cx, liveS.cy - sheetS.cy);
            const covInk = sheetS.n ? inkS.n / sheetS.n : 0;
            const row = { dir, label, frame: f, live: liveS.n, sheet: sheetS.n, cov, dBox, dC, ink: inkS.n, covInk, inkPx,
                liveBox: liveS.box, sheetBox: sheetS.box };
            rows.push(row);
            const bad = liveS.n === 0 ? "живой кадр пуст"
                : (cov < 0.45 || cov > 1.6) ? `покрытие ${cov.toFixed(2)}× от листа`
                : dBox > 6 ? `габарит разъехался на ${dBox} px`
                : dC > 6 ? `центроид сдвинут на ${dC.toFixed(1)} px`
                : (covInk < 0.78 || covInk > 1.3) ? `кадр с обводкой весит ${covInk.toFixed(2)}× от листа (обводка не та)` : null;
            if (bad && !fail) fail = { ...row, bad };
        }
    }
    const compared = rows.filter(r => !r.skip).length;
    if (!fail && compared < (opts.minFrames ?? 4)) {
        fail = { dir: "-", label: "-", bad: `сравнено всего ${compared} кадров — тест ничего не проверяет` };
    }
    return { rows, fail, compared, look: `${who}/${style}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const all = process.argv.includes("--all");
    const res = await compare({ all });
    console.log(`RASTER: ${res.look} · живой силуэт против кадра листа`);
    for (const r of res.rows) {
        if (r.skip) { console.log(`  ${r.dir}/${r.label}: ${r.skip}`); continue; }
        console.log(`  ${(r.dir + "/" + r.label).padEnd(16)} кадр ${r.frame} · пикселей live ${String(r.live).padStart(5)} / лист ${String(r.sheet).padStart(5)}`
            + ` (${(r.cov * 100).toFixed(0)}%) · габарит Δ${r.dBox} px · центроид Δ${r.dC.toFixed(1)} px`
            + ` · с обводкой ${String(r.ink).padStart(5)} (${(r.covInk * 100).toFixed(0)}%)`);
    }
    if (res.fail) { console.error(`❌ ${res.fail.dir}/${res.fail.label}: ${res.fail.bad}`); process.exit(1); }
    console.log(`✅ живой кадр совпадает с листом по силуэту (${res.compared} кадров)`);
}
