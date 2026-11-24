/**
 * tools/sprite-holes.js — где спрайт героя просвечивает.
 *
 *   node tools/sprite-holes.js                    # heroframes.js (то, что играет)
 *   node tools/sprite-holes.js js/render/herosmooth.js
 *
 * Кадр — это RLE пустоты и индексов палитры. «Дырка» — пиксель с нулевой
 * альфой, до которого заполненная область окружает со всех сторон: на экране
 * через него видно землю, и на одежде/ногах/ботинках это выглядит как
 * просвечивающие пиксели. Волосы и тонкие места тела дают такие точки первыми,
 * потому что квантизация берёт среднее по ячейке и прикрытый пиксель становится
 * пустым.
 *
 * Считаем floods-филлом пустоты с краёв кадра: всё, до чего он не дошёл, и есть
 * замкнутая дырка. Печатается top-10 кадров и координаты первых дыр, чтобы их
 * можно было найти глазами на `.artifacts/hero-*` листе.
 */
import fs from "node:fs";
import path from "node:path";

const target = process.argv[2] || "js/render/heroframes.js";
const abs = path.resolve(target);
if (!fs.existsSync(abs)) { console.error(`нет файла ${target}`); process.exit(1); }
const { STREAMS, META } = await import(abs);
const CELL = META.cell;
const rows = [];
let checker = 0, filledN = 0;

for (const [key, b64] of Object.entries(STREAMS)) {
    const bytes = Buffer.from(b64, "base64");
    const per = CELL.w * CELL.h;
    let total = 0;
    for (let i = 0; i + 1 < bytes.length; i += 2) total += bytes[i];
    const idx = new Uint8Array(total);
    let at = 0;
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        const run = bytes[i], value = bytes[i + 1];
        idx.fill(value, at, at + run);
        at += run;
    }
    const frames = Math.max(1, Math.round(total / per));
    for (let f = 0; f < frames; f += 1) {
        const px = idx.subarray(f * per, (f + 1) * per);
        const seen = new Uint8Array(per);
        const stack = [];
        for (let x = 0; x < CELL.w; x += 1) stack.push(x, (CELL.h - 1) * CELL.w + x);
        for (let y = 0; y < CELL.h; y += 1) stack.push(y * CELL.w, y * CELL.w + CELL.w - 1);
        while (stack.length) {
            const p = stack.pop();
            if (p < 0 || p >= per || seen[p] || px[p]) continue;
            seen[p] = 1;
            const x = p % CELL.w;
            if (x > 0) stack.push(p - 1);
            if (x < CELL.w - 1) stack.push(p + 1);
            stack.push(p - CELL.w, p + CELL.w);
        }
        const holes = [];
        for (let i = 0; i < per; i += 1) if (!px[i] && !seen[i]) holes.push([i % CELL.w, (i / CELL.w) | 0]);
        if (holes.length) rows.push({ key, frame: f, holes });
        // Шахматная доля: пиксели, попавшие в чередование A-B-A-B по X и по Y.
        // Это то, что владелец описывает как «пиксели просвечиваются»: глаз
        // читает регулярную решётку из двух тонов как полупрозрачную ткань.
        let chk = 0, filled = 0;
        for (let y = 1; y < CELL.h - 3; y += 1) {
            for (let x = 1; x < CELL.w - 3; x += 1) {
                const i = y * CELL.w + x;
                if (!px[i]) continue;
                filled += 1;
                const a1 = px[i], b1 = px[i + 1];
                if (!b1 || a1 === b1) continue;      // плоская область — не решётка
                const rowAlt = px[i + 2] === a1 && px[i + 3] === b1;
                const colAlt = px[i + CELL.w] === b1 && px[i + CELL.w * 2] === a1;
                if (rowAlt && colAlt) chk += 1;
            }
        }
        checker += chk; filledN += filled;
    }
}

rows.sort((a, b) => b.holes.length - a.holes.length);
console.log(`решётка (дизер): ${(checker / Math.max(1, filledN) * 100).toFixed(2)}% заполненных пикселей (${checker} из ${filledN})`);
if (!rows.length) { console.log(`✅ ${target}: замкнутых дыр в силуэте нет`); process.exit(0); }
const worst = rows[0];
console.log(`⚠️  ${target}: дыры в ${rows.length} кадрах, худший — ${worst.key}#${worst.frame} (${worst.holes.length} px)`);
for (const r of rows.slice(0, 10)) {
    const cells = r.holes.slice(0, 6).map(([x, y]) => `${x},${y}`).join(" ");
    console.log(`   ${r.key}#${String(r.frame).padEnd(2)} ${String(r.holes.length).padStart(3)} px: ${cells}${r.holes.length > 6 ? " …" : ""}`);
}
