/**
 * tools/pagescheck.js — would this commit actually run on GitHub Pages?
 *
 * Pages is a plain static host with a case-sensitive filesystem and no build
 * step. The three ways this project can break there are boring and easy to
 * check mechanically:
 *
 *   1. index.html points at a file that is not in the repository (or differs
 *      in case — it works on a Mac and 404s on Pages);
 *   2. a module imports a path that does not exist, same reason;
 *   3. something only the dev server provides (an absolute /__dev/ URL, a
 *      live-reload hook) is required for the game to boot.
 *
 *   node tools/pagescheck.js      exits 1 and lists what would 404
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const problems = [];
let checked = 0;

const exists = (rel) => {
    // Case-sensitive on purpose: walk the path segment by segment.
    const parts = rel.split("/").filter(Boolean);
    let dir = ROOT;
    for (let i = 0; i < parts.length; i++) {
        let names;
        try { names = fs.readdirSync(dir); } catch { return false; }
        if (!names.includes(parts[i])) return false;
        dir = path.join(dir, parts[i]);
    }
    return true;
};

/* ---- 1. what index.html asks for ------------------------------------- */
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:|data:|#|\/\/)/.test(url)) continue;
    checked++;
    if (url.startsWith("/")) problems.push(`index.html: абсолютный путь "${url}" — на Pages сайт лежит в подпапке`);
    else if (!exists(url)) problems.push(`index.html: нет файла ${url}`);
}

/* ---- 2. every import in every module ---------------------------------- */
function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) { walk(full); continue; }
        if (!name.endsWith(".js")) continue;
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(/(?:^|[^\w$])(?:import|from)\s*\(?\s*["'](\.[^"']+)["']/g)) {
            checked++;
            const target = path.relative(ROOT, path.resolve(path.dirname(full), m[1])).split(path.sep).join("/");
            if (!exists(target)) {
                problems.push(`${path.relative(ROOT, full)}: импорт не существует → ${m[1]}`);
            }
        }
    }
}
walk(path.join(ROOT, "js"));

/* ---- 3. the game must boot without the dev server --------------------- */
const main = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
if (/await\s+fetch\(\s*["']\/__/.test(main)) {
    problems.push("js/main.js: загрузка игры ждёт ответа от dev-сервера");
}
checked++;
if (!fs.existsSync(path.join(ROOT, ".nojekyll"))) {
    problems.push("нет файла .nojekyll — Pages прогонит сайт через Jekyll");
}

/* ---- report ------------------------------------------------------------ */
if (problems.length) {
    console.log(`\n❌ Pages: ${problems.length} проблем(ы) из ${checked} проверок\n`);
    for (const p of problems) console.log("   • " + p);
    console.log("");
    process.exit(1);
}
console.log(`✅ Pages: ${checked} ссылок и импортов на месте, Jekyll отключён`);
