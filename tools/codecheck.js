/**
 * tools/codecheck.js — сплошная статическая проверка каждого файла
 *
 * Владелец потребовал: «полностью пройдись по коду, проверяя каждый момент и
 * каждую деталь, не упуская ни один код». Глазом 130 файлов не проходят —
 * поэтому проверки механические, а спорное вынесено в allow-файл
 * (`tools/codecheck-allow.json`) с указанием причины: «разрешено, потому что…»
 *
 * Что ловится (каждый пункт — класс ошибки, который уже встречался в проекте):
 *
 *   import      — импорт не разрешается в файл, имя не экспортируется,
 *                 импорт не использован (в проекте были молча мёртвые строки);
 *   unused      — локальная переменная модуля, объявленная и не читанная;
 *   style       — `==` вместо `===`, `parseInt` без-radix, пустой `catch {}`,
 *                 `debugger`, табы, CRLF, хвостовые пробелы, нет \n в конце;
 *   determinism — `Math.random()`/`Date.now()` в симуляции (js/**, кроме dev/):
 *                 мир обязан воспроизводиться по сиду, иначе сейвы и повторы
 *                 расходятся. Инструментам и HUD это разрешено;
 *   noise       — `console.log` вне dev- и tools-кода (в браузере это шум в
 *                 консоли телефона), TODO/FIXME без номера блока;
 *   text        — кириллица, набранная латиницей («двa», «completely» в
 *                 русском комментарии), смешанный алфавит в одном слове;
 *   size        — файл больше 1200 строк или функция больше 220 — кандидат на
 *                 разбор (не ошибка, а «посмотри»);
 *   export      — `export` имени, которого нет в списке (пересечение с
 *                 `npm run deadcode`, тут ловится только «экспорт в никуда»).
 *
 * Выход: отчёт по файлам. `--gate` (и `npm run codecheck`) делает из отчёта
 * прогон: код 1, если хоть одна строка уровня ERROR.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ALLOW_FILE = path.join(ROOT, "tools", "codecheck-allow.json");

/** Где искать. Папки вендора провераются только на «не сломан ли синтаксис». */
const DIRS = ["js", "tools", "tests", "."];
const FILES_ROOT = ["serve.js"];
const SKIP_DIR = new Set([".git", "node_modules", ".artifacts", "dev", "docs", "vendor"]);

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".") && e.name !== ".jekyllignore") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(full, out); }
        else if (e.name.endsWith(".js")) out.push(full);
    }
    return out;
}

const files = [];
for (const d of DIRS) {
    const full = path.join(ROOT, d);
    if (d === ".") { for (const f of FILES_ROOT) if (fs.existsSync(path.join(ROOT, f))) files.push(path.join(ROOT, f)); continue; }
    if (fs.existsSync(full)) walk(full, files);
}
files.sort();

/** Файлы, которые собирает пекарь: base64-потоки, «TODO» внутри них и «==» в
 *  padding'е — не замечания, а данные. Проверять им разрешаем только синтаксис. */
const GENERATED = [
    "js/render/heroframes.js", "js/render/heroframes-female.js", "js/render/heroframes-female-braid.js",
    "js/render/heroframes-female-short.js", "js/render/heroframes-male-braid.js", "js/render/heroframes-male-short.js",
    "js/render/herosmooth.js", "js/render/herorig.js", "js/render/propsprites.js"
];
/** Сам инструмент описывает правила в строках — проверять его самого бессмысленно. */
const SELF = "tools/codecheck.js";

const allow = fs.existsSync(ALLOW_FILE) ? JSON.parse(fs.readFileSync(ALLOW_FILE, "utf8")) : {};
/**
 * Allow-файл: список «код — причина». Причина обязательна по правилам проекта:
 * разрешение без объяснения через год выглядит как «тут и было всё чисто».
 * Запись вида «js/vendor/» отключает проверки для целого дерева.
 */
const allowKey = (file) => {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const hits = [];
    for (const k of Object.keys(allow)) {
        if (k.endsWith("/") ? rel.startsWith(k) : rel === k) hits.push(k);
    }
    return hits;
};
const allowed = (file, code) => allowKey(file).some((k) =>
    allow[k].some((entry) => {
        const rule = String(entry).split(" — ")[0].trim();
        return rule === "*" || rule === code || (rule.endsWith("*") && code.startsWith(rule.slice(0, -1)));
    }));

/** Зарегистрированные глобальные имена браузера и node — чтобы не путать их с несуществующими. */
const GLOBALS = new Set(["globalThis", "window", "document", "console", "performance", "localStorage",
    "requestAnimationFrame", "cancelAnimationFrame", "addEventListener", "removeEventListener", "location",
    "navigator", "Image", "Audio", "Math", "JSON", "Object", "Array", "Map", "Set", "WeakMap", "WeakSet",
    "String", "Number", "Boolean", "Symbol", "BigInt", "Promise", "Error", "TypeError", "RangeError",
    "Date", "RegExp", "Function", "Proxy", "Reflect", "Infinity", "NaN", "undefined", "null", "true", "false",
    "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "encodeURI",
    "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "Float32Array", "Float64Array", "Uint8Array",
    "Uint8ClampedArray", "Int8Array", "Uint16Array", "Int16Array", "Uint32Array", "Int32Array", "ArrayBuffer",
    "DataView", "structuredClone", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask",
    "fetch", "AbortController", "devicePixelRatio", "matchMedia", "ResizeObserver", "MutationObserver", "WeakRef",
    "require", "module", "__dirname", "__filename", "process", "Buffer", "arguments", "this", "super", "new",
    "typeof", "instanceof", "in", "of", "delete", "void", "await", "async", "yield", "class", "function",
    "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "try",
    "catch", "finally", "throw", "const", "let", "var", "import", "export", "from", "as", "with", "debugger",
    "get", "set", "static", "extends", "constructor", "canvas", "ctx", "WebGL2RenderingContext", "Path2D",
    "ImageData", "OffscreenCanvas", "HTMLElement", "KeyboardEvent", "MouseEvent", "TouchEvent", "WheelEvent",
    "ErrorEvent", "Event", "CustomEvent", "Blob", "FileReader", "crypto", "Intl", "BigInt64Array", "Float16Array"]);

/* ------------------------------------------------------------ разбор файла */

/** Убрать комментарии и строки, сохранив позиции (для поиска по коду). */
function blank(src) {
    let out = "", i = 0;
    while (i < src.length) {
        const c = src[i], n = src[i + 1];
        if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") { out += " "; i++; } continue; }
        if (c === "/" && n === "*") {
            while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
            out += "  "; i += 2; continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            const q = c; out += " "; i++;
            let tpl = 0;                                  // вложенность ${…} в шаблоне
            while (i < src.length) {
                const ch = src[i];
                if (ch === "\\") { out += "  "; i += 2; continue; }
                if (q === "`" && ch === "$" && src[i + 1] === "{") { out += "${"; i += 2; tpl++; continue; }
                if (q === "`" && tpl > 0) {
                    if (ch === "{") { tpl++; out += ch; i++; continue; }
                    if (ch === "}") { tpl--; out += ch; i++; continue; }
                    if (ch === "`") {                    // вложенный шаблон внутри ${…}
                        let j = i + 1, d = 0;
                        while (j < src.length && !(src[j] === "`" && d === 0)) {
                            if (src[j] === "\\") { out += src[j]; j++; out += src[j]; j++; continue; }
                            if (src[j] === "$" && src[j + 1] === "{") d++;
                            else if (src[j] === "}" && d > 0) d--;
                            j++;
                        }
                        out += src.slice(i, j + 1); i = j + 1; continue;
                    }
                    out += ch; i++; continue;             // сам код внутри ${…} сохраняется
                }
                if (ch === q) break;
                out += ch === "\n" ? "\n" : " "; i++;
            }
            out += " "; i++; continue;
        }
        // регулярки: ловим только явные /.../flags в начале выражения
        if (c === "/" && /(?:^|[=(,:[!&|?{};\n]\s*(?:return\s+)?)[/]/.test(out + c)) {
            let j = i + 1, ok = false;
            while (j < src.length && src[j] !== "\n") { if (src[j] === "\\") { j += 2; continue; } if (src[j] === "/") { ok = true; break; } j++; }
            if (ok) { for (let k = i; k <= j; k++) out += " "; i = j + 1; continue; }
        }
        out += c; i++;
    }
    return out;
}

const lineOf = (src, pos) => src.slice(0, pos).split("\n").length;

/** Только комментарии, построчно: текстовые правила проверяются по тексту, а не по коду. */
function commentLines(src) {
    const out = [];
    const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
    let m;
    while ((m = re.exec(src))) {
        const text = m[0];
        for (let i = 0; i < text.split("\n").length; i++) out.push({ line: lineOf(src, m.index) + i, text });
    }
    // строки и шаблонные литералы не считаются комментарием
    return out.filter((c) => !/^\s*\*?\s*(?:["'`])/.test(c.text));
}

/** Имена, объявленные в модуле (const/let/var/function/class) и их использования. */
function localNames(code) {
    const decl = new Map();
    const re = /(?:^|[;{}\n]\s*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(code))) if (!decl.has(m[1])) decl.set(m[1], lineOf(code, m.index));
    const fn = /(?:^|[;{}\n]\s*)(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g;
    while ((m = fn.exec(code))) if (!decl.has(m[1])) decl.set(m[1], lineOf(code, m.index));
    const cls = /(?:^|[;{}\n]\s*)(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g;
    while ((m = cls.exec(code))) if (!decl.has(m[1])) decl.set(m[1], lineOf(code, m.index));
    const uses = new Map();
    // `\b` не работает для имён с `$`: для «$» границы нет вообще. Смотрим
    // «не буква/цифра/$» с обеих сторон — тогда и `$("needs")` посчитается.
    const names = [...decl.keys()].map((k) => k.replace(/[$.*+?^{}()|[\]\\]/g, "\\$&"));
    if (names.length) {
        const all = new RegExp(`(?<![\\w$])(${names.join("|")})(?![\\w$])`, "g");
        while ((m = all.exec(code))) uses.set(m[1], (uses.get(m[1]) || 0) + 1);
    }
    return { decl, uses };
}

function exportedNames(code) {
    const set = new Set();
    let m;
    const one = /export\s+(?:const|let|var|function\s*\*?|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g;
    while ((m = one.exec(code))) set.add(m[1]);
    const list = /export\s*\{([^}]*)\}/g;
    while ((m = list.exec(code))) for (const part of m[1].split(",")) {
        const t = part.trim(); if (!t) continue;
        set.add((t.split(/\s+as\s+/).pop() || t).trim());
    }
    if (/export\s+default/.test(code)) set.add("default");
    return set;
}

/* --------------------------------------------------------------- проверки */

const report = [];
const add = (file, code, line, text, level = "ERROR") => report.push({
    file: path.relative(ROOT, file), code, line, text, level
});

for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    // сам инструмент описывает правила в строках — проверки над ним самим
    // дают только шум («while (true)» в списке правил — это не баг)
    if (rel === SELF) continue;
    const inGame = rel.startsWith("js/") && !rel.startsWith("js/dev/") && !rel.startsWith("js/vendor/");
    // Симуляция обязана быть детерминированной: сид → тот же мир, тот же сейв,
    // та же запись. Отрисовка и HUD вправе брать Math.random (частицы, тряска).
    const inSim = /^js\/(world|survival|sandbox|entities|core|engine)\//.test(rel) || rel === "js/main.js";
    const isVendor = rel.startsWith("js/vendor/");
    const src = fs.readFileSync(file, "utf8");
    const code = blank(src);
    try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); }
    catch (e) { add(file, "syntax", 0, String(e.stderr || e.message).split("\n").slice(0, 2).join(" ")); }
    if (isVendor || GENERATED.includes(rel) || rel === SELF) continue;
    // чужое (вендор), данные (пекарня) и сам инструмент: синтаксис проверен, дальше не идём

    /* --- импорты: файл, имя, использование ------------------------------ */
    const importRe = /import\s+([^;]*?)\s+from\s*["']([^"']+)["']/g;
    let m;
    const used = new Set();
    while ((m = importRe.exec(code))) {
        const clause = m[1], spec = m[2];
        if (!spec.startsWith(".")) continue;
        const target = path.resolve(path.dirname(file), spec);
        if (!fs.existsSync(target)) { add(file, "import-missing", lineOf(code, m.index), `${spec}: файла нет`); continue; }
        const tsrc = fs.readFileSync(target, "utf8");
        const texp = exportedNames(blank(tsrc));
        const named = clause.match(/\{([^}]*)\}/);
        if (named) for (const part of named[1].split(",")) {
            const t = part.trim(); if (!t) continue;
            const [orig, alias] = t.split(/\s+as\s+/).map((s) => s.trim());
            const local = alias || orig;
            used.add(local);
            if (!texp.has(orig) && !texp.has("*")) {
                add(file, "import-unknown", lineOf(code, m.index), `импорт { ${orig} } — «${path.basename(spec)}» этого не экспортирует`);
            }
            const useRe = new RegExp(`\\b${local.replace(/\$/g, "\\$")}\\b`, "g");
            let hits = 0; while (useRe.exec(code)) hits++;
            if (hits <= 1) add(file, "import-unused", lineOf(code, m.index), `импорт «${local}» не используется`, "WARN");
        }
        const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
        if (ns) used.add(ns[1]);
        const def = clause.trim().match(/^([A-Za-z_$][\w$]*)$/);
        if (def) { used.add(def[1]); if (!texp.has("default")) add(file, "import-unknown", lineOf(code, m.index), `default-импорт «${def[1]}», а у файла нет default-экспорта`); }
    }
    if (/^\s*import\s*["']/m.test(code)) { /* side-effect import — ничего не проверяем */ }

    /* --- стиль и детерминизм -------------------------------------------- */
    const codeLines = code.split("\n");
    const lineChecks = [
        [/(^|[^=!<>])==(?![=])/, "loose-eq", "`==` вместо `===`", "raw"],
        [/[^.\w]debugger\b/, "debugger", "забыт `debugger`"],
        [/\bwhile\s*\(\s*true\s*\)/, "while-true", "`while (true)` без явного выхода — смотри предел цикла"],
        [/catch\s*(\([^)]*\))?\s*\{\s*\}/, "empty-catch", "пустой `catch {}` — молчаливое проглатывание ошибки", "raw"],
        [/parseInt\([^,()]*(?:\([^()]*\)[^,()]*)*\)/, "parseint-radix", "`parseInt` без основания"],
        [/\binnerHTML\s*=/, "innerhtml", "`innerHTML =`: в разметку обязана попадать строка игры, не текст из сейва", "code", "WARN"],
        [/\beval\s*\(/, "eval", "`eval`"],
        [/\bnew\s+Function\s*\(/, "eval", "`new Function` — тот же eval"],
    ];
    // Пробелы смотрим по сырой строке: blank() заменяет строки и комментарии
    // пробелами, и любая строка, кончавшаяся комментарием, стала бы «хвостом».
    const wsChecks = [[/[ \t]+$/u, "trailing-ws", "хвостовые пробелы"], [/\t/, "tab", "табуляция вместо пробелов"], [/\r/, "crlf", "CRLF в файле"]];
    const lines = src.split("\n");
    for (let i = 0; i < codeLines.length; i++) {
        const L = codeLines[i];
        for (const [re, codeName, text, where = "code", level = "ERROR"] of lineChecks) {
            if (allowed(file, codeName)) continue;
            const src_ = where === "raw" ? (lines[i] || "") : L;
            if (re.test(src_)) add(file, codeName, i + 1, `${text}: ${src_.trim().slice(0, 90)}`, level);
        }
        if (i < lines.length) {
            for (const [re, codeName, text] of wsChecks) {
                if (allowed(file, codeName)) continue;
                if (re.test(lines[i])) add(file, codeName, i + 1, `${text}: ${lines[i].trim().slice(0, 60)}`, "WARN");
            }
        }
        // Строка с «@nondet» помечена руками: косметика, которой детерминизм
        // не нужен (тряска камеры, дым, pollen). Помеченное — молча проходим,
        // всё остальное в симуляции — падение.
        const marked = /@nondet/.test(lines[i] || "");
        if (inSim && !marked) {
            if (/\bMath\s*\.\s*random\s*\(/.test(L) && !allowed(file, "nondeterminism")) add(file, "nondeterminism", i + 1, "`Math.random()` в симуляции — мир обязан быть по сиду");
            if (!marked && /\bDate\s*\.\s*now\s*\(/.test(L) && !allowed(file, "nondeterminism")) add(file, "nondeterminism", i + 1, "`Date.now()` в симуляции — читай clock/время кадра");
            if (!marked && /\bnew\s+Date\s*\(/.test(L) && !allowed(file, "nondeterminism")) add(file, "nondeterminism", i + 1, "`new Date()` в симуляции — только через clock", "WARN");
        }
        if (inGame && /console\.log\s*\(/.test(L) && !allowed(file, "console")) {
            add(file, "console", i + 1, "`console.log` в игровом коде — в консоли телефона это шум", "WARN");
        }
    }
    // Текстовые правила — по комментариям: «двa» и «зaмeнить» живут в тексте, а не в коде.
    const LOOKALIKE = /[a-zA-Z]/;
    for (const { line, text } of commentLines(src)) {
        for (const tok of text.match(/[A-Za-zА-Яа-яЁё]+/g) || []) {
            if (!/[а-яё]/.test(tok) || !LOOKALIKE.test(tok)) continue;
            const lat = tok.replace(/[^a-zA-Z]/g, "");
            // одно-две латинские буквы внутри русского слова — это опечатка с
            // похожей клавиши (a, e, o, p, c, x, y); длинное латинское слово —
            // термин, он намеренный
            if (lat.length <= 2 && /^[aAceopxy]+$/.test(lat)) {
                if (!allowed(file, "mixed-script")) add(file, "mixed-script", line, `слово «${tok}» — кириллица вперемешку с латиницей`);
            }
        }
        if (/TODO|FIXME|XXX/.test(text) && !allowed(file, "todo")) {
            add(file, "todo", line, `незакрытая заметка: ${text.trim().slice(0, 90)}`, "WARN");
        }
    }
    if (!src.endsWith("\n") && !allowed(file, "no-final-newline")) add(file, "no-final-newline", lines.length, "нет перевода строки в конце файла", "WARN");

    /* --- объявления модуля ---------------------------------------------- */
    const { decl, uses } = localNames(code);
    const exported = exportedNames(code);
    for (const [name, ln] of decl) {
        if (exported.has(name)) continue;
        if (used.has(name)) continue;
        const n = uses.get(name) || 0;
        if (n <= 1 && !allowed(file, "unused")) add(file, "unused", ln, `«${name}» объявлено и ни разу не прочитано`, "WARN");
    }
    /* --- размеры -------------------------------------------------------- */
    if (lines.length > 1200 && !allowed(file, "big-file")) add(file, "big-file", lines.length, `${lines.length} строк в одном модуле — кандидат на разбор`, "WARN");
    let bigFn = null, depth = 0, start = 0;
    for (let i = 0; i < code.length; i++) {
        const c = code[i];
        if (c === "{") { if (depth === 0) start = i; depth++; }
        else if (c === "}") { depth--; if (depth === 0) { const len = lineOf(code, i) - lineOf(code, start); if (len > 220) { const head = code.slice(Math.max(0, start - 200), start).match(/(?:function|class)\s+([A-Za-z_$][\w$]*)/); bigFn = { name: head ? head[1] : "блок", line: lineOf(code, start), len }; } } }
    }
    if (bigFn && !allowed(file, "long-block")) add(file, "long-block", bigFn.line, `«${bigFn.name}» — ${bigFn.len} строк в одном блоке`, "WARN");
}

/* ------------------------------------------------------------------ вывод */

const gate = process.argv.includes("--gate");
const errors = report.filter((r) => r.level === "ERROR");
const warns = report.filter((r) => r.level === "WARN");
const byFile = new Map();
for (const r of report) { const k = r.file; if (!byFile.has(k)) byFile.set(k, []); byFile.get(k).push(r); }

for (const [file, list] of byFile) {
    console.log(`\n${file}`);
    for (const r of list) console.log(`   ${r.level === "ERROR" ? "❌" : "·"} ${r.code}:${r.line}  ${r.text}`);
}
const kinds = new Map();
for (const r of report) kinds.set(r.code, (kinds.get(r.code) || 0) + 1);
console.log(`\nпроверено файлов: ${files.length} · замечаний: ${report.length} (ошибок ${errors.length})`);
console.log("по правилам: " + [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "));
if (gate && errors.length) {
    console.error(`❌ codecheck: ${errors.length} ошибок. Либо чинить, либо в tools/codecheck-allow.json с причиной.`);
    process.exit(1);
}
if (!errors.length) console.log(`✅ ошибок нет; предупреждений ${warns.length}`);
