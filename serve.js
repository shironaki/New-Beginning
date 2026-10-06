/**
 * v3 dev server — zero dependencies.
 *
 *   node serve.js                      port 3000, host 0.0.0.0
 *   node serve.js 8080                 positional port
 *   node serve.js --port 8080 --host 127.0.0.1
 *   node serve.js --no-reload          serve files only, no live reload
 *
 * Live reload: the server watches the source tree and pushes an event over
 * Server-Sent Events; a few lines injected into index.html listen and reload.
 * No build step, no dependency, and nothing of it reaches production — the
 * snippet is added by the dev server as it serves the page.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Dev server knobs, in one place. */
export const SERVE = {
    port: 3000,
    host: "0.0.0.0",
    reload: true,
    watchDirs: ["js", "css", "index.html"],
    debounceMs: 120,        // collapse a burst of saves into one reload
    pingMs: 25000           // keep-alive so proxies do not drop the stream
};

/** Tiny argv reader: positional port, then --key value / --no-key flags. */
export function parseArgs(argv = [], env = {}) {
    const out = { port: SERVE.port, host: SERVE.host, reload: SERVE.reload };
    if (env.PORT) out.port = Number(env.PORT) || out.port;
    if (env.HOST) out.host = env.HOST;
    for (let i = 0; i < argv.length; i++) {
        const a = String(argv[i]);
        if (/^\d+$/.test(a)) { out.port = Number(a); continue; }
        if (a === "--no-reload") { out.reload = false; continue; }
        const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
        if (!m) continue;
        const key = m[1];
        const val = m[2] !== undefined ? m[2] : argv[++i];
        if (key === "port") out.port = Number(val) || out.port;
        else if (key === "host") out.host = String(val);
        else if (key === "reload") out.reload = val !== "false" && val !== "0";
    }
    return out;
}

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json; charset=utf-8"
};

// A tiny inline favicon keeps the browser console clean in the live preview.
const FAVICON = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="#16130f"/>' +
    '<path d="M16 6c3 5 6 7 6 12a6 6 0 0 1-12 0c0-5 3-7 6-12z" fill="#ff8a3a"/>' +
    '<path d="M16 14c1.4 2.4 2.6 3.4 2.6 5.6a2.6 2.6 0 0 1-5.2 0c0-2.2 1.2-3.2 2.6-5.6z" fill="#ffe0a0"/>' +
    "</svg>"
);

/** The client half of live reload. Kept deliberately dumb and tiny. */
const RELOAD_SNIPPET = `
<script>
(() => {
  let es;
  const open = () => {
    es = new EventSource("/__reload");
    es.addEventListener("change", (e) => {
      // A stylesheet can be swapped in place; anything else needs a reload.
      if (e.data && e.data.endsWith(".css")) {
        for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
          const u = new URL(link.href, location.href);
          u.searchParams.set("v", Date.now());
          link.href = u.pathname + u.search;
        }
        return;
      }
      location.reload();
    });
    es.onerror = () => { es.close(); setTimeout(open, 800); };
  };
  open();
})();
</script>`;

/** Dev-note endpoints, in numbers and paths. */
export const DEVAPI = {
    config: "dev.config.json",
    dir: "docs/notes",
    index: "docs/notes/README.md",
    maxBody: 12 * 1024 * 1024      // a PNG of a 4K frame fits with room to spare
};

/** The SHA-256 the client has to present, or "" when dev mode is off. */
export function devHash(root = ROOT) {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(root, DEVAPI.config), "utf8"));
        return String(cfg.sha256 || "");
    } catch { return ""; }
}

/** `2026-10-06-143` → a stable, sortable, filesystem-safe stem. */
export function noteStem(note, n) {
    const day = new Date(note.at || Date.now()).toISOString().slice(0, 10);
    const slug = String(note.text || "note").toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "note";
    return `${day}-${String(n).padStart(3, "0")}-${note.zone || "zone"}-${slug}`;
}

/** Markdown for one note — written so it reads fine straight in a diff. */
export function noteMarkdown(note, shotName) {
    return `# ${note.text}\n\n`
        + `- **зона:** ${note.zoneName || note.zone} (\`${note.zone}\`)\n`
        + `- **место:** x ${note.x}, y ${note.y} (тайл ${Math.floor(note.x / 32)},${Math.floor(note.y / 32)})\n`
        + `- **время:** день ${note.day}, ${note.time}, ${note.season}\n`
        + `- **погода:** ${note.weather}\n`
        + `- **зум:** ${note.zoom}\n`
        + `- **повторить:** \`node tools/scene.js --zone ${note.zone} --at ${note.x},${note.y} `
        + `--hour ${(note.time || "12:00").split(":")[0]} --weather ${note.weather} --zoom ${note.zoom}\`\n`
        + (shotName ? `\n![кадр](${shotName})\n` : "")
        + `\n<!-- ${note.at} -->\n`;
}

export function createServer(opts = {}) {
    const cfg = { ...SERVE, ...opts };
    /** @type {Set<import("node:http").ServerResponse>} */
    const clients = new Set();

    const json = (res, code, obj) => {
        res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(obj));
    };

    function handleDev(urlPath, req, res) {
        const want = devHash();
        const got = String(req.headers["x-dev-token"] || "");
        if (!want || got !== want) { json(res, 403, { ok: false, error: "forbidden" }); return; }
        const dir = path.join(ROOT, DEVAPI.dir);

        if (urlPath === "/__dev/notes" && req.method === "GET") {
            let files = [];
            try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md"); } catch { /* none yet */ }
            json(res, 200, { ok: true, count: files.length, files: files.slice(-20) });
            return;
        }
        if (urlPath === "/__dev/note" && req.method === "POST") {
            let size = 0;
            const chunks = [];
            req.on("data", (c) => {
                size += c.length;
                if (size > DEVAPI.maxBody) { req.destroy(); return; }
                chunks.push(c);
            });
            req.on("end", () => {
                let note;
                try { note = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
                catch { json(res, 400, { ok: false, error: "bad json" }); return; }
                fs.mkdirSync(dir, { recursive: true });
                const n = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").length + 1;
                const stem = noteStem(note, n);
                let shotName = "";
                if (typeof note.shot === "string" && note.shot.startsWith("data:image/png;base64,")) {
                    shotName = stem + ".png";
                    fs.writeFileSync(path.join(dir, shotName),
                                     Buffer.from(note.shot.slice("data:image/png;base64,".length), "base64"));
                }
                delete note.shot;
                fs.writeFileSync(path.join(dir, stem + ".md"), noteMarkdown(note, shotName));
                console.log(`📝 заметка: ${DEVAPI.dir}/${stem}.md`);
                json(res, 200, { ok: true, file: stem + ".md" });
            });
            return;
        }
        json(res, 404, { ok: false, error: "no such dev endpoint" });
    }

    const server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);

        if (cfg.reload && urlPath === "/__reload") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive"
            });
            res.write("retry: 800\n\n");
            clients.add(res);
            req.on("close", () => clients.delete(res));
            return;
        }

        // --- dev notes ----------------------------------------------------
        // The owner pins a note to a place in the world; it lands in the
        // repository as markdown plus the exact frame he was looking at.
        // The password is checked HERE for real — the client-side gate only
        // keeps the panel out of a player's way.
        if (urlPath.startsWith("/__dev/")) {
            handleDev(urlPath, req, res);
            return;
        }

        if (urlPath === "/favicon.ico" || urlPath === "/favicon.svg") {
            res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" });
            res.end(FAVICON);
            return;
        }

        const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
        const filePath = path.join(ROOT, rel);
        if (!filePath.startsWith(ROOT)) {
            res.writeHead(403).end("Forbidden");
            return;
        }
        fs.stat(filePath, (err, stat) => {
            if (err || !stat.isFile()) {
                res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                res.end("404 Not Found");
                return;
            }
            const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
            // The reload client rides along with the page, never with a file
            // on disk: `git status` stays clean whatever the dev server does.
            if (cfg.reload && type.startsWith("text/html")) {
                fs.readFile(filePath, "utf8", (e2, html) => {
                    if (e2) { res.writeHead(500).end("500"); return; }
                    const body = html.replace(/<\/body>/i, RELOAD_SNIPPET + "\n</body>");
                    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
                    res.end(body);
                });
                return;
            }
            res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
            fs.createReadStream(filePath).pipe(res);
        });
    });

    server.on("clientError", (err, socket) => {
        if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    });

    /** Watch the sources and fan a single event out to every open page. */
    const watchers = [];
    let timer = null;
    const announce = (file) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const payload = `event: change\ndata: ${file}\n\n`;
            for (const c of clients) c.write(payload);
            if (clients.size) console.log(`[serve] ${file} → ${clients.size} перезагрузк(а/и)`);
        }, cfg.debounceMs);
    };
    if (cfg.reload) {
        for (const dir of cfg.watchDirs) {
            const target = path.join(ROOT, dir);
            if (!fs.existsSync(target)) continue;
            try {
                watchers.push(fs.watch(target, { recursive: true }, (_e, name) => {
                    announce(name ? path.join(dir, String(name)) : dir);
                }));
            } catch {
                watchers.push(fs.watch(target, (_e, name) => announce(name ? String(name) : dir)));
            }
        }
        const ping = setInterval(() => {
            for (const c of clients) c.write(": ping\n\n");
        }, cfg.pingMs);
        ping.unref && ping.unref();
    }

    server.on("close", () => { for (const w of watchers) w.close(); });
    return server;
}

// Only run when started directly, so tests can import `parseArgs` in peace.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
    const cfg = parseArgs(process.argv.slice(2), process.env);
    process.on("uncaughtException", (err) => console.error("[serve] ", err.message));
    createServer(cfg).listen(cfg.port, cfg.host, () => {
        console.log(`Пепел и Зерно (v3) → http://${cfg.host}:${cfg.port}`
            + (cfg.reload ? "  (live reload)" : ""));
    });
}
