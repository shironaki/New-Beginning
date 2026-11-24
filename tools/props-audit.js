#!/usr/bin/env node
/**
 * tools/props-audit.js — ревизия запечённых пропов числами, а не на глаз.
 *
 * Владелец посмотрел на мир и сказал честно: «где-то круто, а где-то нет».
 * Глазом по одному кадру это не лечится — нужна таблица, где видно, какой проп
 * запёкся в свою высоту, какой съёжился в точку, а какой лег так, что света на
 * нём не видно вовсе. Всё это считается из данных листа, а не из ощущений.
 *
 *   node tools/props-audit.js            # таблица + список подозрительных
 *   node tools/props-audit.js --json     # машиночитаемо (для теста)
 *   node tools/props-audit.js --strict    # ненулевой код возврата, если есть флаги
 *
 * Флаги:
 *   tiny      — непрозрачных пикселей меньше, чем 25% площади кадра: проп
 *               почти не рисуется (обычно резка подложки съела саму модель);
 *   short     — кадр ниже PROP_HEIGHT×0.55: игра резервирует под проп место,
 *               а рисует половину, и деталь выглядит прилипшей к земле;
 *   wide      — ширине кадра не хватает 10 px: валун в 6 пикселей — это точка;
 *   no-face   — 90%+ пикселей смотрят в одну сторону: свет на пропаде не
 *               читается, модель снята ребром.
 */
import fs from "node:fs";
import path from "node:path";
import { PROP_SPRITES } from "../js/render/propsprites.js";
import { propHeight } from "../js/render/tilesart.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const strict = args.includes("--strict");

const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function facesOf(entry) {
    if (!entry.faces) return null;
    const raw = Buffer.from(entry.faces, "base64");
    const seen = new Array(8).fill(0);
    let p = 0;
    for (let i = 0; i + 1 < raw.length; i += 2) {
        const run = raw[i], v = raw[i + 1];
        seen[v] += run;
        p += run;
        if (p >= entry.w * entry.h) break;
    }
    return seen;
}

const rows = [];
for (const [kind, e] of Object.entries(PROP_SPRITES)) {
    const total = e.w * e.h;
    // Альфа-канал в потоке не лежит: считаем покрытиём по индексу палитры.
    const raw = Buffer.from(e.stream, "base64");
    let lit = 0;
    for (let i = 0; i + 1 < raw.length; i += 2) if (raw[i + 1]) lit += raw[i];
    const want = propHeight(kind, 1);
    const face = facesOf(e);
    const flags = [];
    // fit:"max" подгоняет длинную сторону, поэтому высота у такой детали может
    // быть маленькой по построению — сравнивать её с PROP_HEIGHT бессмысленно.
    const byHeight = (e.fit || "y") === "y";
    if (lit / total < 0.25) flags.push("tiny");
    if (byHeight && want >= 8 && e.h < want * 0.55) flags.push("short");
    // «Точка, а не деталь»: порог привязан к резервной высоте пропа, иначе он
    // ругался бы на любую мелкую вещь (галька обязана быть мелкой).
    if (Math.max(e.w, e.h) < Math.max(8, want * 0.5)) flags.push("wide");
    let topShare = 0;
    if (face) {
        const sum = face.reduce((a, c) => a + c, 0) || 1;
        topShare = Math.max(...face.slice(1)) / sum;
        // Плоская по замыслу деталь (стена, секция забора, фундамент) обязана
        // смотреть в одну сторону — это не «картонка», а геометрия. Флаг имеет
        // смысл только для объёмных пропов, где от света по граням что-то ждут.
        if (topShare > 0.9 && (e.fit || "y") !== "x") flags.push("no-face");
    }
    // Насколько «цветной» деталь: если разброс яркости маленький, проп сольётся
    // с землёй — это ровно жалоба «выглядит не совсем то».
    const pal = (e.palette || []).map(hex2rgb);
    const lum = pal.map((c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
    const spread = lum.length ? Math.max(...lum) - Math.min(...lum) : 0;
    rows.push({
        kind, w: e.w, h: e.h, want, lit, cover: +(lit / total).toFixed(2),
        tones: pal.length, spread: Math.round(spread), face: Math.round(topShare * 100) / 100,
        flags
    });
}

rows.sort((a, b) => (b.flags.length - a.flags.length) || (a.cover - b.cover));

if (json) {
    process.stdout.write(JSON.stringify({ rows, bad: rows.filter(r => r.flags.length) }, null, 2) + "\n");
} else {
    console.log("kind            кадр     высота  покрыт.  тонов  контр.  грань  флаги");
    for (const r of rows) {
        console.log(`${r.kind.padEnd(15)} ${`${r.w}×${r.h}`.padEnd(8)} ${String(r.want).padStart(5)}  `
            + `${String(r.cover).padStart(6)}  ${String(r.tones).padStart(5)}  ${String(r.spread).padStart(6)}  `
            + `${String(r.face).padStart(5)}  ${r.flags.join(",")}`);
    }
    const bad = rows.filter(r => r.flags.length);
    console.log(bad.length
        ? `\n⚠️  с флагами: ${bad.length} из ${rows.length} — ${bad.map(b => b.kind).join(", ")}`
        : `\n✅ все ${rows.length} пропов в пределах нормы`);
}

if (strict && rows.some(r => r.flags.length)) process.exit(1);
