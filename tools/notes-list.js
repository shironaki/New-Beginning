/**
 * tools/notes-list.js — все пометки владельца списком, без браузера и без Git.
 *
 *   node tools/notes-list.js                 # таблица по docs/notes/*.md
 *   node tools/notes-list.js --open 12        # напечатать заметку №12 целиком
 *   node tools/notes-list.js --missing        # только где кадр не доехал до репозитория
 *   node tools/notes-list.js --grep просвеч  # фильтр по тексту
 *   node tools/notes-list.js --json           # машинный вывод (для отчётов)
 *
 * Смысл ровно один: «я поставил пометки, а их никуда не делось» — это вопрос
 * про три разных места сразу (очередь браузера, working tree, origin). Здесь
 * видно второе: что реально лежит в репозитории и чем из этого можно работать.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return dflt;
    const next = argv[i + 1];
    return next === undefined || next.startsWith("--") ? true : next;
};
const DIR = path.resolve(String(opt("dir", "docs/notes")));

/** `- **повторить:** \`…\`` — единственная строка, по которой кадр воспроизводится. */
function field(text, label) {
    const m = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`).exec(text);
    return m ? m[1].trim() : "";
}

function readNote(file) {
    const text = fs.readFileSync(path.join(DIR, file), "utf8");
    const stem = file.replace(/\.md$/, "");
    const title = (/^# (.+)$/m.exec(text) || [, stem])[1].trim();
    const shot = (/!\[кадр\]\(([^)]+)\)/.exec(text) || [, ""])[1];
    const local = shot.startsWith("../../.artifacts/");
    const picture = shot && fs.existsSync(path.join(DIR, path.basename(shot)));
    const receipt = /<!-- receipt: ([0-9a-f]{6})/.exec(text);
    const status = /\*\*Актуальный статус[^*]*\*\*:?\s*(.+)/.exec(text);
    return {
        n: Number(stem.match(/^\d{4}-\d{2}-\d{2}-(\d+)-/)?.[1]) || 0,
        day: stem.slice(0, 10), stem, file, title,
        zone: field(text, "зона"), where: field(text, "точка") || field(text, "область"),
        replay: (field(text, "повторить").match(/`(.+)`/) || [, ""])[1],
        shot: shot ? path.basename(shot) : "", hasPicture: Boolean(picture), pictureLocal: local,
        committed: !receipt ? true : true, status: status ? status[1].trim() : "", text
    };
}

const all = fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter(f => f.endsWith(".md") && f !== "README.md").map(readNote).sort((a, b) => a.stem.localeCompare(b.stem))
    : [];

const grep = opt("grep", null);
let rows = grep === true || grep === null || grep === false ? all : all.filter(r => r.text.includes(String(grep)));
if (opt("missing", false)) rows = rows.filter(r => (r.shot && !r.hasPicture) || r.pictureLocal);

const one = opt("open", null);
if (one !== true && one) {
    const hit = all.find(r => String(r.n) === String(one) || r.stem.includes(String(one)));
    if (!hit) { console.error(`нет заметки ${one} в ${DIR}`); process.exit(1); }
    console.log(hit.text.trim());
    process.exit(0);
}

if (opt("json", false)) {
    console.log(JSON.stringify(rows.map(({ text, ...rest }) => rest), null, 1));
    process.exit(0);
}
if (!rows.length) {
    console.log(`в ${path.relative(process.cwd(), DIR)} нет заметок${grep ? " под этот фильтр" : ""}`);
    process.exit(0);
}
console.log(`пометок в ${path.relative(process.cwd(), DIR)}: ${rows.length}`);
for (const r of rows) {
    const pic = r.shot ? (r.hasPicture ? (r.pictureLocal ? "кадр локально" : "кадр ✓") : "КАДРА НЕТ") : "без кадра";
    console.log(`${String(r.n).padStart(3)} · ${r.day} · ${r.title.slice(0, 64)}`);
    console.log(`     ${r.zone || "зона не указана"} · ${pic}${r.status ? `\n     статус: ${r.status.slice(0, 110)}` : ""}`);
    if (r.replay) console.log(`     повторить: ${r.replay}`);
}
