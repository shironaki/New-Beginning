/**
 * измеритель кадра — числа вместо «выглядит пусто»
 *
 * Инструмент рендерит несколько эталонных кадров (tools/scene.js) и по пикселям
 * считает то, за что обычно цепляет глаз:
 *
 *   · «разброс»      — P95−P5 яркости. Карта, где всё в одной децили, читается
 *                      как пятна: разброс < ~40 ярк. ед. = нет света;
 *   · «пол»          — сколько оттенков в нижней четверти кадра (там земля).
 *                      Пустой мир — это земля в 8 оттенках;
 *   · «контраст»     — средняя дельта яркости между соседями в 2 px: сколько
 *                      микрорельефа реально видно;
 *   · «субъект»      — яркость персонажа относительно локального фона: герой не
 *                      должен ни проваливаться в чёрное, ни светиться сам по себе.
 *
 * Каждый вечер правки света/текстур проверяются именно здесь, а не «на глаз»:
 * если правка не сдвинула ни одну из четырёх строк, она ничего не изменила.
 *
 *   node tools/frame-metrics.js                 — прогнать эталонные сцены
 *   node tools/frame-metrics.js --gate          — то же, но падать при провале
 *   node tools/frame-metrics.js --png a.png …   — размеры по готовым файлам
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPngFile } from "./png-decode.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = ".artifacts/frame-metrics";

/** Эталоны: то, на что смотрит владелец в скриншотах с телефона. */
export const SCENES = [
    { name: "01-noon", zone: "ashfall", hour: 12, weather: "clear", hero: 1, zoom: 2.6 },
    { name: "02-golden", zone: "ashfall", hour: 17.5, weather: "clear", hero: 1, zoom: 2.6 },
    { name: "03-night", zone: "ashfall", hour: 21.5, weather: "clear", hero: 1, zoom: 2.6, torch: 1 },
    { name: "04-dawn", zone: "ashfall", hour: 5.8, weather: "clear", hero: 1, zoom: 2.6, torch: 1 },
    { name: "05-forest-day", zone: "forest", hour: 12, weather: "clear", hero: 1, zoom: 2.6 },
    { name: "06-rain", zone: "meadow", hour: 15, weather: "rain", hero: 1, zoom: 2.6 }
];

const W = 760, H = 560;

function render(scene) {
    const file = path.join(outDir, `${scene.name}.png`);
    fs.mkdirSync(outDir, { recursive: true });
    const args = ["tools/scene.js", "--zone", scene.zone, "--hour", String(scene.hour),
        "--weather", scene.weather, "--zoom", String(scene.zoom), "--size", `${W}x${H}`,
        "--hud", "--out", file];
    if (scene.hero) args.push("--hero3d", "grade");   // в node WebGL нет: меряем кадр с листом, как и откат в браузере
    if (scene.torch) args.push("--torch");
    execFileSync(process.execPath, args, { cwd: root, stdio: "pipe" });
    return file;
}

const q = (v) => (v >> 3 << 10) | (v >> 3 << 5) | (v >> 3);

export function measure(file) {
    const p = loadPngFile(file);
    const W = p.width, H = p.height, n = W * H;
    const lum = new Float64Array(n);
    const ground = new Set(), all = new Set();
    for (let i = 0; i < n; i++) {
        const o = i << 2, r = p.data[o], g = p.data[o + 1], b = p.data[o + 2];
        lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        const k = q(r) << 6 | q(g) << 3 | q(b);
        all.add(k);
        if (i >= n - W * Math.floor(H / 4)) ground.add(k);
    }
    const sorted = Float64Array.from(lum).sort();
    const at = (f) => sorted[Math.round(f * (n - 1))];
    // Локальный контраст: соседи в 2 px по горизонтали и вертикали.
    let d = 0, dn = 0;
    for (let y = 2; y < H - 1; y += 2) {
        for (let x = 2; x < W - 1; x += 2) {
            d += Math.abs(lum[y * W + x] - lum[y * W + x - 2]) + Math.abs(lum[y * W + x] - lum[(y - 1) * W + x]);
            dn++;
        }
    }
    // Субъект: прямоугольник героя по центру кадра против кольца вокруг него.
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    const box = [cx - 14, cy - 34, 28, 68];
    let inSum = 0, inN = 0, outSum = 0, outN = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const inside = x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3];
            const near = x >= box[0] - 40 && x < box[0] + box[2] + 40 && y >= box[1] - 20 && y < box[1] + box[3] + 40;
            if (inside) { inSum += lum[y * W + x]; inN++; }
            else if (near) { outSum += lum[y * W + x]; outN++; }
        }
    }
    const hero = inSum / Math.max(1, inN), bg = outSum / Math.max(1, outN);
    return {
        spread: at(0.95) - at(0.05),
        median: at(0.5),
        ground: ground.size,
        colors: all.size,
        contrast: d / Math.max(1, dn),
        hero, bg,
        sep: Math.abs(hero - bg)
    };
}

/**
 * Пороги. Абсолютная яркость честнее между кадрами одного часа, но сравнивать
 * полдень и полночь нельзя: ночью контраст обязан быть меньше по определению.
 * Поэтому две главные меры — относительные: микрорельеф и разброс делённые на
 * медиану кадра. Пороги выставлены по правилу «правка обязана сдвинуть число»:
 * на коде до блока 80 noon давал 1.6 % микрорельефа и 11 оттенков земли — оба
 * теста падают.
 */
export const GATES = {
    rel: 2.2,        // микрорельеф, % от медианы кадра
    spreadRel: 28,   // разброс P95−P5, % от медианы
    ground: 20,      // оттенков в нижней четверти
    sepMin: 14,      // герой читаем относительно локального фона
    sepMax: 130      // …но не вырезан из бумаги
};

export function row(name, m, gate = false) {
    const rel = 100 * m.contrast / Math.max(1, m.median);
    const spreadRel = 100 * m.spread / Math.max(1, m.median);
    // «Сколько оттенков в земле» меряется только при свете: ночью кадр лежит в
    // 3–4 битах на канал, и подсчёт цветов там враньё. Ночью смотрим на
    // относительный микрорельеф — он как раз и есть «лепку не съело».
    const day = m.median >= 90;
    const bad = gate && (rel < GATES.rel || spreadRel < GATES.spreadRel ||
        (day && m.ground < GATES.ground) || m.sep < GATES.sepMin || m.sep > GATES.sepMax);
    const f = (v) => v.toFixed(v < 10 ? 2 : 0).padStart(6);
    m.rel = rel; m.spreadRel = spreadRel; m.day = day;
    return `${bad ? "❌" : "  "} ${name.padEnd(13)} микро-контраст ${rel.toFixed(1).padStart(4)}%  ` +
        `разброс ${spreadRel.toFixed(0).padStart(3)}%  пол ${String(m.ground).padStart(3)}  ` +
        `оттенков ${String(m.colors).padStart(4)}  медиана ${f(m.median)}  ` +
        `герой ${f(m.hero)} vs ${f(m.bg)} (Δ${f(m.sep)})`;
}

const args = process.argv.slice(2);
const gate = args.includes("--gate");
const filesAt = args.indexOf("--png");
if (filesAt >= 0) {
    for (const f of args.slice(filesAt + 1)) {
        if (f.startsWith("--")) continue;
        console.log(row(path.basename(f, ".png"), measure(f), gate));
    }
} else {
    fs.mkdirSync(outDir, { recursive: true });
    let fail = 0;
    for (const s of SCENES) {
        const file = render(s);
        const m = measure(file);
        const line = row(s.name, m, gate);
        console.log(line);
        if (line.startsWith("❌")) fail++;
    }
    console.log(`\nкадры: ${path.relative(root, outDir)} · пороги: микро-контраст ≥ ${GATES.rel} % медианы, разброс ≥ ${GATES.spreadRel} %, пол ≥ ${GATES.ground} оттенков, Δгерой ∈ [${GATES.sepMin}; ${GATES.sepMax}]`);
    if (gate && fail) {
        console.error(`❌ ${fail} кадр(ов) не проходят пороги — кадр правится здесь, а не в юнит-тестах`);
        process.exit(1);
    }
}
