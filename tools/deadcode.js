/**
 * tools/deadcode.js — ревизия мёртвого кода и висячих экспортов.
 *
 * Зачем. Пак правок накапливает «на всякий случай»: модуль, из которого вырезали
 * последний вход, ещё месяц выглядит живым, потому что на него ссылается чей-то
 * тест или dev-панель. Здесь три независимых вопроса:
 *
 *   1. достижим ли файл из точки входа, которую видит игрок (index.html), из
 *     serve.js, из dev-страниц или только из tools/tests — «только из теста» и
 *      «ниоткуда» это разные решения;
 *   2. есть ли у экспорта хоть один потребитель вне его собственного файла;
 *   3. есть ли у инструмента в package.json и в docs реальный вход.
 *
 * Выход — текст, не числа: `node tools/deadcode.js` и читать сверху вниз.
 * Флагов «ошибка» нет намеренно: это карта, а не судья.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

const walk = (dir, out = []) => {
    for (const name of readdirSync(path.join(ROOT, dir))) {
        const p = path.join(dir, name);
        if (!existsSync(path.join(ROOT, p))) continue;
        if (statSync(path.join(ROOT, p)).isDirectory()) walk(p, out);
        else if (/\.(js|mjs)$/.test(p)) out.push(p);
    }
    return out;
};

const files = [...walk("js"), ...walk("tools"), ...walk("tests"), ...walk("js/dev"), "serve.js"];
const uniq = [...new Set(files)].filter((f) => !/canvas-shim|carry-fixture|tiny\.js|dom-harness/.test(f) || true);

/** Импорты одного файла → список путей внутри репозитория. */
const IMPORT_RE = /(?:from|import)\s*\(?\s*["']((?:\.\.?\/|~\/)[^"']+|\.\/[^"']+|[^"']*\.js)["']/g;
const importsOf = (file) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    const out = new Set();
    for (const m of src.matchAll(IMPORT_RE)) {
        const spec = m[1];
        if (/^https?:/.test(spec)) continue;
        const base = path.resolve(path.dirname(path.join(ROOT, file)), spec);
        const cand = [base, `${base}.js`].find((p) => existsSync(p) && statSync(p).isFile());
        if (cand) out.add(rel(cand));
    }
    return [...out];
};

/**
 * Скрипты, которые грузит HTML: это настоящие точки входа пользователя.
 * Путь берётся относительно самого HTML-файла — dev/relief.html ссылается на
 * `../js/dev/relief-lab.js`, и если резолвить это от корня, стенд выглядел бы
 * висящим в воздухе (первая версия так и делала).
 */
const htmlEntries = () => {
    const out = new Set();
    const pages = [...readdirSync(ROOT).filter((n) => /\.html$/.test(n)).map((n) => [ROOT, n]),
        ...(existsSync(path.join(ROOT, "dev"))
            ? readdirSync(path.join(ROOT, "dev")).filter((n) => /\.html$/.test(n)).map((n) => [path.join(ROOT, "dev"), n])
            : [])];
    for (const [dir, name] of pages) {
        const src = readFileSync(path.join(dir, name), "utf8");
        for (const m of src.matchAll(/src="([^"]+\.js)"/g)) {
            const abs = path.resolve(dir, m[1].replace(/^\.\//, ""));
            if (existsSync(abs) && statSync(abs).isFile()) out.add(rel(abs));
        }
    }
    return [...out];
};

const closure = (seeds) => {
    const seen = new Set(seeds);
    const q = [...seeds];
    while (q.length) for (const dep of importsOf(q.shift())) if (!seen.has(dep)) { seen.add(dep); q.push(dep); }
    return seen;
};

const gameReach = closure(htmlEntries());
const toolReach = closure([...uniq.filter((f) => f.startsWith("tools/")), "serve.js", ...uniq.filter((f) => f.startsWith("tests/"))]);

const rows = [];
for (const f of uniq) {
    if (f.startsWith("tools/") || f === "serve.js") continue;
    const inGame = gameReach.has(f);
    const inAny = toolReach.has(f);
    if (!inGame && !inAny) rows.push([f, "ниоткуда"]);
    else if (!inGame && inAny) rows.push([f, "только tools/tests"]);
}

// ---- экспорты без потребителей вне своего файла -------------------------
const EXPORT_RE = /export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g;
const all = uniq.map((f) => [f, readFileSync(path.join(ROOT, f), "utf8")]);
const orphanExports = [];
for (const [file, src] of all) {
    if (!file.startsWith("js/")) continue;
    for (const m of src.matchAll(EXPORT_RE)) {
        const name = m[1];
        if (/^(default|Game|T)$/.test(name)) continue;
        const users = all.filter(([f, s]) => f !== file && new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(s));
        if (!users.length) orphanExports.push([file, name]);
    }
}

// ---- инструменты без входа в package.json ------------------------------
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const scripted = new Set(Object.values(pkg.scripts).join(" ").match(/[\w./-]+\.js/g) || []);
const docs = readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(path.join(ROOT, "docs", f), "utf8")).join("\n")
    + readFileSync(path.join(ROOT, "README.md"), "utf8");
const orphanTools = uniq.filter((f) => f.startsWith("tools/")
    && !scripted.has(path.basename(f)) && !scripted.has(f)
    && !new RegExp(`${path.basename(f).replace(/\./g, "\\.")}\\b`).test(docs));

const print = (title, list, fmt) => {
    console.log(`\n${title} — ${list.length}`);
    for (const x of list.slice(0, 60)) console.log("   " + fmt(x));
    if (list.length > 60) console.log(`   … и ещё ${list.length - 60}`);
};

console.log(`файлов в ревизии: ${uniq.length} · достижимо из HTML/serve: ${gameReach.size}`);
print("модули вне игрового графа", rows, (r) => `${r[0].padEnd(34)} ${r[1]}`);
print("экспорты без потребителей", orphanExports, (r) => `${r[0]} → ${r[1]}`);
print("инструменты без входа (npm run / docs)", orphanTools, (t) => t);
console.log("\n✅ ревизия закончена: это карта, а не список на удаление");
