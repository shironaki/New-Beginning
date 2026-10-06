/**
 * tools/notes-import.js — unpack a bundle of notes into docs/notes/.
 *
 * When the game runs somewhere without the dev server (GitHub Pages, a page
 * opened straight from disk), the panel keeps notes in the browser and hands
 * them over as ONE file. This turns that one file back into the usual pairs
 * of `.md` + `.png` in the repository.
 *
 *   node tools/notes-import.js ~/Downloads/notes-2026-10-06-7.json
 *   node tools/notes-import.js bundle.json --dry      just list what is in it
 *
 * Zero dependencies; it reuses the very same markdown writer the dev server
 * uses, so a note imported by hand is indistinguishable from one posted live.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { noteStem, noteMarkdown, DEVAPI } from "../serve.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = process.argv[2];
const dry = process.argv.includes("--dry");

if (!file) {
    console.error("укажи файл:  node tools/notes-import.js <bundle.json>");
    process.exit(1);
}
if (!fs.existsSync(file)) {
    console.error("нет такого файла: " + file);
    process.exit(1);
}

let data;
try { data = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (e) { console.error("не разобрать JSON: " + e.message); process.exit(1); }

// Accept both the bundle and a single note, so an old single-note file still
// imports without anyone having to edit it.
const notes = Array.isArray(data) ? data
    : Array.isArray(data.notes) ? data.notes
    : data.text ? [data] : null;
if (!notes || !notes.length) {
    console.error("в файле нет заметок");
    process.exit(1);
}

const dir = path.join(ROOT, DEVAPI.dir);
fs.mkdirSync(dir, { recursive: true });
let n = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").length;
let made = 0;

for (const note of notes) {
    n++;
    const stem = noteStem(note, n);
    const area = note.kind === "area" && note.w
        ? `область ${note.w}×${note.h}` : `точка ${note.x},${note.y}`;
    console.log(`  • ${note.zone}: ${note.text}  (${area})`);
    if (dry) continue;
    let shotName = "";
    const prefix = "data:image/png;base64,";
    if (typeof note.shot === "string" && note.shot.startsWith(prefix)) {
        shotName = stem + ".png";
        fs.writeFileSync(path.join(dir, shotName), Buffer.from(note.shot.slice(prefix.length), "base64"));
    }
    const copy = { ...note };
    delete copy.shot;
    fs.writeFileSync(path.join(dir, stem + ".md"), noteMarkdown(copy, shotName));
    made++;
}

console.log(dry
    ? `\n📋 в файле ${notes.length} заметок (ничего не записано)`
    : `\n📝 импортировано ${made} заметок в ${DEVAPI.dir}/`);
