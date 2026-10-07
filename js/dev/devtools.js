/**
 * dev tools — the owner's control room.
 *
 * Everything you need to check the game without playing it: jump between
 * zones, set the hour, the day, the season and the weather, fill or empty the
 * needs, hand yourself items, switch debug overlays on, and — the important
 * one — PIN A NOTE to a spot in the world so the next pass over the code
 * knows exactly what you meant.
 *
 * Access
 *   Ctrl+Shift+D asks for the password; the SHA-256 of the right one lives in
 *   dev.config.json (default: nachalo2026, change it with tools/devpass.js).
 *   An unlocked session is remembered in localStorage until you lock it again.
 *   Be honest about what this is: the client is open source, so the gate keeps
 *   an ordinary player out of the panel, it is not a security boundary. The
 *   part that *is* enforced is the server: `serve.js` refuses to write a note
 *   without the same password.
 *
 * Notes
 *   "Отметить место" turns the cursor into a crosshair. Click anywhere on
 *   screen, type what is wrong, and the note goes to the dev server together
 *   with the zone, the world coordinates, the in-game time, the weather and a
 *   PNG of exactly what you were looking at. They land in docs/notes/ — in the
 *   repository — so I can read them and fix precisely that.
 *   If the game is not being served by serve.js, the note is downloaded as a
 *   file instead and nothing is lost.
 */

/** The panel, in numbers. */
export const DEV = {
    hotkey: { code: "KeyD", ctrl: true, shift: true },
    storeKey: "minirpg_v3_dev",
    width: 268,              // px of the panel
    noteDir: "docs/notes",
    timeScales: [0, 1, 5, 20, 120],
    seasonDays: { spring: 1, summer: 29, autumn: 57, winter: 85 },
    presets: {
        "Рассвет": 5.5, "Утро": 8, "Полдень": 12.5, "Закат": 19, "Ночь": 1.5
    },
    // Notes that cannot reach a server wait in a queue instead of raining
    // files into the Downloads folder.
    queueKey: "minirpg_v3_notes",
    queueMax: 40,
    shotMax: 1280,           // px — the saved frame is scaled down to this
    dragMin: 8,              // px of movement that turns a click into an area
    kits: {
        "Инструменты": [["knife", 1], ["axe", 1], ["pickaxe", 1], ["shovel", 1], ["flint", 1], ["torch", 3]],
        "Еда": [["berry", 10], ["mushroom", 10], ["meat_raw", 5], ["fish_raw", 5], ["root", 5]],
        "Топливо": [["firewood", 20], ["log", 10], ["hay", 10], ["coal", 5]],
        "Материалы": [["stone", 20], ["fiber", 20], ["resin", 10], ["clay", 10], ["plank", 10]]
    }
};

const CSS = `
#devPanel{position:fixed;top:8px;right:8px;width:${DEV.width}px;max-height:calc(100vh - 16px);
 overflow-y:auto;background:rgba(14,13,11,.94);color:#f0e6d2;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;
 border:1px solid #d6aa68;border-radius:8px;padding:8px;z-index:9999;box-shadow:0 8px 28px rgba(0,0,0,.5)}
#devPanel h4{margin:9px 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#f0cc8c;
 border-bottom:1px solid rgba(214,170,104,.3);padding-bottom:2px}
#devPanel h4:first-child{margin-top:0}
#devPanel button{background:#241f17;color:#f0e6d2;border:1px solid #6b5637;border-radius:4px;
 padding:3px 6px;margin:1px;font:11px ui-monospace,monospace;cursor:pointer}
#devPanel button:hover{background:#3a301f;border-color:#d6aa68}
#devPanel button.on{background:#54401d;border-color:#f0cc8c;color:#fff2d8}
#devPanel input[type=range]{width:100%;margin:2px 0}
#devPanel input[type=text],#devPanel input[type=password],#devPanel textarea{width:100%;box-sizing:border-box;
 background:#1b1813;color:#f0e6d2;border:1px solid #6b5637;border-radius:4px;padding:4px;font:12px ui-monospace,monospace}
#devPanel .row{display:flex;flex-wrap:wrap;gap:2px;align-items:center}
#devPanel .val{color:#f0cc8c}
#devPanel .hint{color:#9a8f7c;font-size:10px;margin:2px 0}
#devPanel .close{position:absolute;top:6px;right:8px;border:0;background:none;color:#9a8f7c;font-size:14px}
#devGate{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:10000;
 background:rgba(8,7,6,.82)}
#devGate .box{background:#14120e;border:1px solid #d6aa68;border-radius:8px;padding:16px;width:280px;
 color:#f0e6d2;font:13px ui-monospace,monospace;text-align:center}
#devGate h3{margin:0 0 8px;font-size:13px;color:#f0cc8c}
#devNoteForm{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10001;width:420px;
 background:#14120e;border:1px solid #d6aa68;border-radius:8px;padding:12px;color:#f0e6d2;
 font:12px ui-monospace,monospace;box-shadow:0 10px 40px rgba(0,0,0,.6)}
#devNoteForm textarea{height:90px;resize:vertical}
#devToast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10002;
 background:rgba(20,18,14,.95);border:1px solid #d6aa68;color:#f0e6d2;padding:8px 14px;border-radius:6px;
 font:12px ui-monospace,monospace;pointer-events:none;transition:opacity .3s}
body.devPicking #game{cursor:crosshair}
#devSelect{position:fixed;z-index:10000;border:1.5px dashed #f0cc8c;background:rgba(240,204,140,.14);
 pointer-events:none;border-radius:2px}
#devSelect .size{position:absolute;right:2px;bottom:2px;font:10px ui-monospace,monospace;color:#f0cc8c;
 background:rgba(10,9,7,.7);padding:1px 3px;border-radius:2px}
`;

/* ----------------------------------------------------------------- utils */

const el = (tag, props = {}, kids = []) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    for (const k of kids) n.append(k);
    return n;
};
const btn = (label, onclick, title = "") => {
    const b = el("button", { textContent: label, title });
    b.addEventListener("click", onclick);
    return b;
};

async function sha256(text) {
    if (globalThis.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return "";                                   // no subtle crypto: gate stays shut
}

function toast(msg, ms = 2200) {
    let t = document.getElementById("devToast");
    if (!t) { t = el("div", { id: "devToast" }); document.body.append(t); }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.style.opacity = "0"; }, ms);
}

/* ------------------------------------------------------------------ gate */

async function loadConfig() {
    try {
        const r = await fetch("dev.config.json", { cache: "no-store" });
        if (r.ok) return await r.json();
    } catch { /* offline: fall through */ }
    return { sha256: "", notesDir: DEV.noteDir };
}

function askPassword() {
    return new Promise((resolve) => {
        const input = el("input", { type: "password", placeholder: "пароль" });
        const box = el("div", { className: "box" }, [
            el("h3", { textContent: "Режим разработчика" }), input
        ]);
        const ok = btn("Войти", () => { done(input.value); });
        const no = btn("Отмена", () => done(null));
        box.append(el("div", { className: "row", style: "justify-content:center;margin-top:8px" }, [ok, no]));
        const gate = el("div", { id: "devGate" }, [box]);
        const done = (v) => { gate.remove(); resolve(v); };
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") done(input.value);
            if (e.key === "Escape") done(null);
        });
        document.body.append(gate);
        input.focus();
    });
}

/* ------------------------------------------------------------- the panel */

export function installDevTools(game, win = window) {
    if (!game || typeof document === "undefined") return null;
    const style = el("style", { textContent: CSS });
    document.head.append(style);

    const state = {
        open: false, unlocked: false, cfg: null, token: "",
        timeScale: 1, noclip: false, speed: 1,
        grid: false, hitboxes: false, stats: false, freezeWeather: false,
        picking: false, panel: null
    };

    // --- debug overlays, drawn after the game's own frame -----------------
    const baseRender = game.render.bind(game);
    game.render = function devRender() {
        baseRender();
        if (!state.unlocked) return;
        const ctx = game.renderer.ctx, cam = game.camera;
        if (state.grid) {
            const T = 32, z = cam.zoom;
            ctx.save();
            ctx.strokeStyle = "rgba(255,255,255,0.14)";
            ctx.lineWidth = 1;
            const x0 = Math.floor(cam.x / T) * T, y0 = Math.floor(cam.y / T) * T;
            for (let x = x0; x < cam.x + cam.viewW + T; x += T) {
                const s = cam.worldToScreen(x, cam.y);
                ctx.beginPath(); ctx.moveTo(Math.round(s.x), 0);
                ctx.lineTo(Math.round(s.x), game.renderer.canvas.height); ctx.stroke();
            }
            for (let y = y0; y < cam.y + cam.viewH + T; y += T) {
                const s = cam.worldToScreen(cam.x, y);
                ctx.beginPath(); ctx.moveTo(0, Math.round(s.y));
                ctx.lineTo(game.renderer.canvas.width, Math.round(s.y)); ctx.stroke();
            }
            ctx.restore();
        }
        if (state.hitboxes) {
            const z = cam.zoom;
            ctx.save();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "rgba(255,120,80,0.85)";
            for (const o of game.zone.objects) {
                if (o.removed || !o.solid) continue;
                if (!cam.isVisible(o.x, o.y, 60)) continue;
                const s = cam.worldToScreen(o.x, o.y);
                const r = (o.radius || 8) * z;
                ctx.beginPath(); ctx.ellipse(s.x, s.y, r, r * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
            }
            ctx.strokeStyle = "rgba(120,220,255,0.95)";
            const sp = cam.worldToScreen(game.player.x, game.player.y);
            ctx.beginPath();
            ctx.ellipse(sp.x, sp.y, game.player.radius * z, game.player.radius * z * 0.62, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        if (state.stats) {
            const st = game.renderer.stats || {};
            const lines = [
                `зона   ${game.zone.id}  ${Math.round(game.player.x)},${Math.round(game.player.y)}`,
                `время  день ${game.clock.day} ${game.clock.clockString()} ${game.weather.current}`,
                `чанки  ${st.chunksDrawn || 0}  пропсы ${st.propsDrawn || 0}  частицы ${game.particles.count || 0}`,
                `зум    ${cam.zoom.toFixed(2)}  v ${Math.hypot(game.player.vx, game.player.vy).toFixed(0)} px/с`
            ];
            ctx.save();
            ctx.font = "12px ui-monospace, monospace";
            ctx.textBaseline = "top";
            ctx.fillStyle = "rgba(10,9,7,0.72)";
            ctx.fillRect(8, 8, 330, lines.length * 15 + 8);
            ctx.fillStyle = "#f0e6d2";
            lines.forEach((l, i) => ctx.fillText(l, 14, 13 + i * 15));
            ctx.restore();
        }
    };

    // --- simulation hooks --------------------------------------------------
    const baseUpdate = game.update.bind(game);
    game.update = function devUpdate(dt) {
        if (state.unlocked && state.timeScale !== 1) {
            // Time scaling drives the clock only: the hero must keep moving at
            // his own speed, or every check turns into a slideshow.
            const extra = dt * (state.timeScale - 1);
            if (extra > 0) game.clock.advance(extra * (game.clockSpeed || 1));
        }
        baseUpdate(dt);
        if (state.unlocked && state.freezeWeather && state.forcedWeather) {
            game.weather.current = state.forcedWeather;
        }
    };

    /* -------------------------------------------------------- the widget */

    function build() {
        const p = el("div", { id: "devPanel" });
        const add = (title) => { p.append(el("h4", { textContent: title })); };
        const row = (...kids) => { p.append(el("div", { className: "row" }, kids)); return kids; };

        p.append(el("button", { className: "close", textContent: "✕", title: "закрыть (Ctrl+Shift+D)",
                                onclick: () => toggle(false) }));

        // ---- time
        add("Время");
        const hourLabel = el("span", { className: "val" });
        const hourSlider = el("input", { type: "range", min: "0", max: "1439", step: "5" });
        hourSlider.addEventListener("input", () => {
            game.clock.minute = Number(hourSlider.value);
            refresh();
        });
        p.append(hourLabel, hourSlider);
        row(...Object.entries(DEV.presets).map(([name, h]) =>
            btn(name, () => { game.clock.minute = h * 60; refresh(); })));
        row(btn("−1 ч", () => { game.clock.minute = (game.clock.minute + 1380) % 1440; refresh(); }),
            btn("+1 ч", () => { game.clock.minute = (game.clock.minute + 60) % 1440; refresh(); }),
            ...DEV.timeScales.map((s) => {
                const b = btn(s === 0 ? "стоп" : "×" + s, () => { state.timeScale = s; refresh(); });
                b.dataset.scale = String(s);
                return b;
            }));

        // ---- day and season
        add("День и сезон");
        const dayLabel = el("span", { className: "val" });
        p.append(dayLabel);
        row(btn("−1", () => { game.clock.day = Math.max(1, game.clock.day - 1); refresh(); }),
            btn("+1", () => { game.clock.day++; refresh(); }),
            btn("+7", () => { game.clock.day += 7; refresh(); }),
            ...Object.entries(DEV.seasonDays).map(([key, d]) =>
                btn({ spring: "Весна", summer: "Лето", autumn: "Осень", winter: "Зима" }[key],
                    () => { game.clock.day = d; refresh(); })));

        // ---- weather
        add("Погода");
        const weatherBtns = ["clear", "cloudy", "wind", "fog", "rain", "storm", "snow"].map((w) =>
            btn({ clear: "Ясно", cloudy: "Облачно", wind: "Ветер", fog: "Туман",
                  rain: "Дождь", storm: "Буря", snow: "Снег" }[w], () => {
                game.weather.current = w;
                state.forcedWeather = w;
                refresh();
            }));
        row(...weatherBtns);
        const freezeBtn = btn("Зафиксировать", () => {
            state.freezeWeather = !state.freezeWeather;
            state.forcedWeather = game.weather.current;
            refresh();
        }, "не давать погоде смениться самой");
        const windLabel = el("span", { className: "val" });
        row(freezeBtn, windLabel);
        const windSlider = el("input", { type: "range", min: "0", max: "628", step: "8" });
        windSlider.addEventListener("input", () => {
            game.weather.windAngle = Number(windSlider.value) / 100;
            refresh();
        });
        p.append(windSlider);

        const wetLabel = el("span", { className: "val" });
        const wetSlider = el("input", { type: "range", min: "0", max: "100", step: "1" });
        wetSlider.addEventListener("input", () => {
            game.weather.groundWet = Number(wetSlider.value) / 100;
            refresh();
        });
        p.append(wetLabel, wetSlider);
        row(btn("Сухо", () => { game.weather.groundWet = 0; refresh(); }),
            btn("После ливня", () => { game.weather.groundWet = 0.85; refresh(); }));

        // ---- zones
        add("Локации");
        const zoneWrap = el("div", { className: "row" });
        p.append(zoneWrap);

        // ---- player
        add("Герой");
        const needRows = [
            ["food", "Сытость"], ["warmth", "Тепло"], ["fatigue", "Усталость"],
            ["health", "Здоровье"], ["spirit", "Дух"]
        ].map(([key, name]) => {
            const label = el("span", { className: "val" });
            const slider = el("input", { type: "range", min: "0", max: "100", step: "1" });
            slider.addEventListener("input", () => { game.needs[key] = Number(slider.value); refresh(); });
            p.append(el("div", { className: "hint", textContent: name }), slider);
            return { key, label, slider };
        });
        row(btn("Всё в норму", () => {
                game.needs.food = 90; game.needs.warmth = 50; game.needs.fatigue = 10;
                game.needs.health = 100; game.needs.spirit = 70; game.needs.wet = 0; refresh();
            }),
            btn("На грани", () => {
                game.needs.food = 8; game.needs.warmth = 18; game.needs.fatigue = 92; refresh();
            }),
            btn("Промок", () => { game.needs.wet = 1; game.player.wet = 12; refresh(); }));
        const noclipBtn = btn("Сквозь стены", () => { setNoclip(!state.noclip); refresh(); });
        const speedBtns = [1, 2, 4].map((k) => btn("скорость ×" + k, () => { setSpeed(k); refresh(); }));
        row(noclipBtn, ...speedBtns);

        // ---- items
        add("Предметы");
        row(...Object.keys(DEV.kits).map((name) => btn(name, () => {
            for (const [id, n] of DEV.kits[name]) game.inventory.add(id, n);
            toast("выдано: " + name);
        })));
        const itemInput = el("input", { type: "text", placeholder: "id предмета ×кол-во, напр. log 5" });
        itemInput.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key !== "Enter") return;
            const [id, n] = itemInput.value.trim().split(/\s+/);
            if (!id) return;
            game.inventory.add(id, Number(n) || 1);
            toast(`+${Number(n) || 1} ${id}`);
            itemInput.value = "";
        });
        p.append(itemInput);

        // ---- view
        add("Отладка вида");
        const gridBtn = btn("Сетка", () => { state.grid = !state.grid; refresh(); });
        const hitBtn = btn("Хитбоксы", () => { state.hitboxes = !state.hitboxes; refresh(); });
        const statBtn = btn("Статистика", () => { state.stats = !state.stats; refresh(); });
        row(gridBtn, hitBtn, statBtn);
        row(btn("Зум −", () => { game.camera.zoom = Math.max(1, game.camera.zoom - 0.4); }),
            btn("Зум +", () => { game.camera.zoom = Math.min(8, game.camera.zoom + 0.4); }),
            btn("Зум сброс", () => { game.camera.zoom = 2.4 * (win.devicePixelRatio || 1); }));

        // ---- notes
        add("Заметки для правок");
        p.append(el("div", { className: "hint",
            textContent: "Отметь место на экране и опиши, что не так — заметка со скриншотом уедет в docs/notes/." }));
        const noteBtn = btn("📍 Отметить место / область", () => startPicking(),
                            "клик — точка, протянуть мышь — область");
        row(noteBtn);
        const serverLabel = el("div", { className: "hint" });
        p.append(serverLabel);
        const queueLabel = el("span", { className: "val" });
        const sendBtn = btn("Отправить очередь", () => flushQueue(true),
                            "попробовать ещё раз, когда dev-сервер доступен");
        const saveBtn = btn("Выгрузить файлом", () => downloadQueue(),
                            "один файл со всеми заметками сразу");
        const dropBtn = btn("Очистить", () => {
            if (confirm("Удалить все заметки из очереди?")) { queue.clear(); state.refresh(); }
        });
        row(queueLabel);
        row(sendBtn, saveBtn, dropBtn);
        p.append(el("div", { className: "hint",
            textContent: "Без dev-сервера (например, на GitHub Pages) заметки копятся здесь, "
                + "а не сыплются файлами в «Загрузки». Выгрузи их одним файлом и пришли мне." }));

        // ---- lock
        add("Доступ");
        row(btn("Запереть", () => {
            localStorage.removeItem(DEV.storeKey);
            state.unlocked = false; state.token = "";
            toggle(false);
            toast("dev-режим заперт");
        }));
        p.append(el("div", { className: "hint", textContent: "Ctrl+Shift+D — открыть/закрыть панель" }));

        document.body.append(p);
        state.panel = p;

        // zone buttons: filled on first refresh, when the world is known
        const zones = game.world && game.world.defs ? game.world.defs : null;
        const ids = zones ? Object.keys(zones) : Object.keys(game.world.zones || {});
        for (const id of ids) {
            const def = (zones && zones[id]) || {};
            zoneWrap.append(btn(def.name || id, () => {
                game.enterZone(id, null, true);
                game.placeSafely(game.zone.spawn.x, game.zone.spawn.y);
                toast("→ " + (def.name || id));
                refresh();
            }, id));
        }

        function refresh() {
            hourLabel.textContent = `${game.clock.clockString()}  ${game.clock.season.name}`;
            hourSlider.value = String(Math.round(game.clock.minute));
            dayLabel.textContent = `день ${game.clock.day} · ${game.clock.season.name}`;
            wetLabel.textContent = `Влажность земли: ${Math.round(game.weather.groundWet * 100)}%`;
            wetSlider.value = String(Math.round(game.weather.groundWet * 100));
            windLabel.textContent = `ветер ${(game.weather.windAngle * 57.3).toFixed(0)}°`;
            windSlider.value = String(Math.round(game.weather.windAngle * 100));
            freezeBtn.classList.toggle("on", state.freezeWeather);
            for (const b of weatherBtns) b.classList.remove("on");
            const wi = ["clear", "cloudy", "wind", "fog", "rain", "storm", "snow"].indexOf(game.weather.current);
            if (wi >= 0) weatherBtns[wi].classList.add("on");
            for (const b of p.querySelectorAll("button[data-scale]")) {
                b.classList.toggle("on", Number(b.dataset.scale) === state.timeScale);
            }
            for (const n of needRows) {
                n.slider.value = String(Math.round(game.needs[n.key]));
            }
            noclipBtn.classList.toggle("on", state.noclip);
            speedBtns.forEach((b, i) => b.classList.toggle("on", state.speed === [1, 2, 4][i]));
            gridBtn.classList.toggle("on", state.grid);
            hitBtn.classList.toggle("on", state.hitboxes);
            statBtn.classList.toggle("on", state.stats);
            const n = queue.read().length;
            queueLabel.textContent = n ? `в очереди: ${n}` : "очередь пуста";
            sendBtn.classList.toggle("on", n > 0);
            serverLabel.textContent = state.serverUp === undefined
                ? "проверяю сервер…"
                : state.serverUp
                    ? "✔ dev-сервер на связи — заметки идут прямо в репозиторий"
                    : "✖ сервера нет (Pages или файл с диска) — заметки копятся в очереди";
            serverLabel.style.color = state.serverUp ? "#9fd08c" : "#e0a06a";
        }
        state.refresh = refresh;
        refresh();
        setInterval(() => { if (state.open) refresh(); }, 500);
    }

    /* ------------------------------------------------------- cheat hooks */

    function setNoclip(on) {
        state.noclip = on;
        if (on && !game._devBlocked) {
            game._devBlocked = game.zone.isBlockedTile.bind(game.zone);
            game.zone.isBlockedTile = () => false;
            game._devContact = game.zone.propContact ? game.zone.propContact.bind(game.zone) : null;
            if (game._devContact) game.zone.propContact = () => null;
        } else if (!on && game._devBlocked) {
            game.zone.isBlockedTile = game._devBlocked;
            if (game._devContact) game.zone.propContact = game._devContact;
            game._devBlocked = null; game._devContact = null;
        }
    }
    function setSpeed(k) {
        state.speed = k;
        if (!game.player._devWalk) {
            game.player._devWalk = game.player.walkSpeed;
            game.player._devRun = game.player.runSpeed;
        }
        game.player.walkSpeed = game.player._devWalk * k;
        game.player.runSpeed = game.player._devRun * k;
    }

    /* ------------------------------------------------------------- notes */

    function startPicking() {
        state.picking = true;
        document.body.classList.add("devPicking");
        toast("клик — точка, протяни мышь — область (Esc — отмена)");
    }

    function screenToWorld(ev) {
        const canvas = game.renderer.canvas;
        const r = canvas.getBoundingClientRect();
        const sx = (ev.clientX - r.left) * (canvas.width / r.width);
        const sy = (ev.clientY - r.top) * (canvas.height / r.height);
        const cam = game.camera;
        return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom, sx, sy };
    }

    /**
     * The frame as it was, with the mark drawn on it. A screenshot of the
     * whole screen with no indication of WHERE the problem is only moves the
     * guessing from you to me.
     */
    function markedShot(spot) {
        const src = game.renderer.canvas;
        try {
            const scale = Math.min(1, DEV.shotMax / src.width);
            const c = document.createElement("canvas");
            c.width = Math.round(src.width * scale);
            c.height = Math.round(src.height * scale);
            const g = c.getContext("2d");
            g.drawImage(src, 0, 0, c.width, c.height);
            g.strokeStyle = "#ff4d4d";
            g.lineWidth = Math.max(2, 2 * scale);
            if (spot.kind === "area") {
                g.strokeRect(spot.sx * scale, spot.sy * scale, spot.sw * scale, spot.sh * scale);
                g.fillStyle = "rgba(255,77,77,0.12)";
                g.fillRect(spot.sx * scale, spot.sy * scale, spot.sw * scale, spot.sh * scale);
            } else {
                const x = spot.sx * scale, y = spot.sy * scale, r = 16 * scale;
                g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
                g.beginPath();
                g.moveTo(x - r * 1.7, y); g.lineTo(x - r * 0.4, y);
                g.moveTo(x + r * 0.4, y); g.lineTo(x + r * 1.7, y);
                g.moveTo(x, y - r * 1.7); g.lineTo(x, y - r * 0.4);
                g.moveTo(x, y + r * 0.4); g.lineTo(x, y + r * 1.7);
                g.stroke();
            }
            return c.toDataURL("image/png");
        } catch {
            return "";
        }
    }

    function noteForm(spot) {
        const where = spot.kind === "area"
            ? `область ${Math.round(spot.w)}×${Math.round(spot.h)} от ${Math.round(spot.x)},${Math.round(spot.y)}`
            : `точка ${Math.round(spot.x)},${Math.round(spot.y)}`;
        const ta = el("textarea", { placeholder: "что здесь не так и как должно быть" });
        const box = el("div", { id: "devNoteForm" }, [
            el("div", { className: "hint",
                textContent: `${game.zone.def.name} · ${where} · `
                    + `день ${game.clock.day} ${game.clock.clockString()} · ${game.weather.current}` }),
            ta
        ]);
        const send = btn("Отправить", async () => {
            const text = ta.value.trim();
            if (!text) { toast("пустая заметка"); return; }
            box.remove();
            await sendNote(spot, text);
        });
        const cancel = btn("Отмена", () => box.remove());
        box.append(el("div", { className: "row", style: "justify-content:flex-end;margin-top:6px" }, [cancel, send]));
        ta.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Escape") box.remove();
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send.click();
        });
        document.body.append(box);
        ta.focus();
    }

    /* ---- the queue ---------------------------------------------------- */

    const queue = {
        read() {
            try { return JSON.parse(localStorage.getItem(DEV.queueKey) || "[]"); }
            catch { return []; }
        },
        write(list) {
            try { localStorage.setItem(DEV.queueKey, JSON.stringify(list.slice(-DEV.queueMax))); }
            catch { toast("очередь переполнена — выгрузи её файлом"); }
        },
        push(note) {
            const list = this.read();
            list.push(note);
            this.write(list);
            return list.length;
        },
        clear() { localStorage.removeItem(DEV.queueKey); }
    };

    /**
     * Is there anything on the other end that can save a note? Pages cannot,
     * a dev server can — and the panel says which, so the answer to "where
     * did my note go" is on screen before the note is written.
     */
    async function pingServer() {
        try {
            const r = await fetch("/__dev/notes", { headers: { "x-dev-token": state.token } });
            return r.ok;
        } catch { return false; }
    }

    /** Try the dev server once. Returns the saved file name, or null. */
    async function postNote(note) {
        try {
            const r = await fetch("/__dev/note", {
                method: "POST",
                headers: { "content-type": "application/json", "x-dev-token": state.token },
                body: JSON.stringify(note)
            });
            if (!r.ok) return null;
            const j = await r.json();
            // The server tells us whether the note made it into git; if it
            // only reached the disk, say so — a sandbox can be wiped.
            if (j.file && j.pushed === false) toast("заметка сохранена, но НЕ запушена", 4000);
            return j.file || "ok";
        } catch { return null; }
    }

    /** Send everything that is waiting. Quiet when there is nothing to do. */
    async function flushQueue(loud = false) {
        const list = queue.read();
        if (!list.length) { if (loud) toast("очередь пуста"); return 0; }
        const left = [];
        let sent = 0;
        for (const note of list) {
            // eslint-disable-next-line no-await-in-loop — order matters, these are notes
            const file = await postNote(note);
            if (file) sent++; else left.push(note);
        }
        queue.write(left);
        if (sent) toast(`отправлено заметок: ${sent}` + (left.length ? `, осталось ${left.length}` : ""));
        else if (loud) toast("сервер недоступен — заметки ждут в очереди");
        if (state.refresh) state.refresh();
        return sent;
    }

    /** One file with everything in it, instead of a file per note. */
    function downloadQueue() {
        const list = queue.read();
        if (!list.length) { toast("очередь пуста"); return; }
        const bundle = { kind: "minirpg-notes", version: 1, at: new Date().toISOString(), notes: list };
        const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
        const a = el("a", { href: URL.createObjectURL(blob),
                            download: `notes-${new Date().toISOString().slice(0, 10)}-${list.length}.json` });
        document.body.append(a); a.click(); a.remove();
        toast(`выгружено заметок: ${list.length} (одним файлом)`);
    }

    async function sendNote(spot, text) {
        const note = {
            text,
            kind: spot.kind || "point",
            zone: game.zone.id,
            zoneName: game.zone.def.name,
            x: Math.round(spot.x), y: Math.round(spot.y),
            w: spot.kind === "area" ? Math.round(spot.w) : 0,
            h: spot.kind === "area" ? Math.round(spot.h) : 0,
            screenX: Math.round(spot.sx), screenY: Math.round(spot.sy),
            day: game.clock.day, time: game.clock.clockString(),
            season: game.clock.season.key,
            weather: game.weather.current,
            groundWet: game.weather.groundWet,
            zoom: Number(game.camera.zoom.toFixed(2)),
            seed: game.seed,
            at: new Date().toISOString(),
            shot: markedShot(spot)
        };
        const file = await postNote(note);
        if (file) { toast("заметка сохранена: " + file); return; }
        // No server (GitHub Pages, a file:// page): the note waits in the
        // browser instead of landing in Downloads as yet another file.
        const n = queue.push(note);
        toast(`сервера нет — заметка ${n} в очереди, выгрузишь одним файлом`);
        if (state.refresh) state.refresh();
    }

    /* ------------------------------------------------------------ wiring */

    function toggle(on) {
        state.open = on === undefined ? !state.open : on;
        if (state.panel) state.panel.style.display = state.open ? "block" : "none";
        if (state.open && state.refresh) state.refresh();
        // Opening the panel is a good moment to try the server again: notes
        // written on Pages get saved the next time you play through serve.js.
        if (state.open && state.unlocked) {
            pingServer().then((up) => {
                state.serverUp = up;
                if (up) flushQueue(false);
                if (state.refresh) state.refresh();
            });
        }
    }

    async function unlock() {
        state.cfg = state.cfg || await loadConfig();
        const saved = localStorage.getItem(DEV.storeKey);
        if (saved && saved === state.cfg.sha256) {
            state.unlocked = true; state.token = saved;
            return true;
        }
        const pass = await askPassword();
        if (pass === null) return false;
        const hash = await sha256(pass);
        if (!hash || hash !== state.cfg.sha256) { toast("неверный пароль"); return false; }
        localStorage.setItem(DEV.storeKey, hash);
        state.unlocked = true; state.token = hash;
        toast("dev-режим открыт");
        return true;
    }

    win.addEventListener("keydown", async (e) => {
        if (e.code === DEV.hotkey.code && e.ctrlKey && e.shiftKey) {
            e.preventDefault();
            if (!state.unlocked && !(await unlock())) return;
            if (!state.panel) build();
            toggle();
            return;
        }
        if (e.key === "Escape" && state.picking) {
            state.picking = false;
            dragFrom = null;
            hideBox();
            document.body.classList.remove("devPicking");
        }
    });

    // Click = a point, drag = an area. The box follows the mouse so you can
    // see exactly what you are about to mark.
    let dragFrom = null, dragBox = null;

    const showBox = (a, b) => {
        if (!dragBox) {
            dragBox = el("div", { id: "devSelect" }, [el("div", { className: "size" })]);
            document.body.append(dragBox);
        }
        const x = Math.min(a.cx, b.cx), y = Math.min(a.cy, b.cy);
        const w = Math.abs(a.cx - b.cx), h = Math.abs(a.cy - b.cy);
        dragBox.style.left = x + "px"; dragBox.style.top = y + "px";
        dragBox.style.width = w + "px"; dragBox.style.height = h + "px";
        dragBox.firstChild.textContent = `${Math.round(w)}×${Math.round(h)}`;
    };
    const hideBox = () => { if (dragBox) { dragBox.remove(); dragBox = null; } };

    win.addEventListener("mousedown", (ev) => {
        if (!state.picking) return;
        if (state.panel && state.panel.contains(ev.target)) return;
        ev.preventDefault(); ev.stopPropagation();
        const w = screenToWorld(ev);
        dragFrom = { ...w, cx: ev.clientX, cy: ev.clientY };
    }, true);

    win.addEventListener("mousemove", (ev) => {
        if (!state.picking || !dragFrom) return;
        const d = Math.hypot(ev.clientX - dragFrom.cx, ev.clientY - dragFrom.cy);
        if (d >= DEV.dragMin) showBox(dragFrom, { cx: ev.clientX, cy: ev.clientY });
    }, true);

    win.addEventListener("mouseup", (ev) => {
        if (!state.picking || !dragFrom) return;
        ev.preventDefault(); ev.stopPropagation();
        const to = screenToWorld(ev);
        const moved = Math.hypot(ev.clientX - dragFrom.cx, ev.clientY - dragFrom.cy);
        const from = dragFrom;
        dragFrom = null;
        hideBox();
        state.picking = false;
        document.body.classList.remove("devPicking");
        if (moved < DEV.dragMin) {
            noteForm({ kind: "point", x: to.x, y: to.y, sx: to.sx, sy: to.sy });
            return;
        }
        noteForm({
            kind: "area",
            x: Math.min(from.x, to.x), y: Math.min(from.y, to.y),
            w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y),
            sx: Math.min(from.sx, to.sx), sy: Math.min(from.sy, to.sy),
            sw: Math.abs(to.sx - from.sx), sh: Math.abs(to.sy - from.sy)
        });
    }, true);

    // An already-unlocked session gets its panel back without asking again —
    // and anything that could not be saved last time is sent NOW, before the
    // owner has to remember that a queue exists at all.
    (async () => {
        state.cfg = await loadConfig();
        const saved = localStorage.getItem(DEV.storeKey);
        if (!saved || saved !== state.cfg.sha256) return;
        state.unlocked = true; state.token = saved;
        build();
        toggle(false);
        state.serverUp = await pingServer();
        const waiting = queue.read().length;
        if (waiting && state.serverUp) {
            const sent = await flushQueue(false);
            if (sent) toast(`заметок отправлено в репозиторий: ${sent}`, 4000);
        } else if (waiting) {
            toast(`в очереди ${waiting} заметок — сервера нет, выгрузи их файлом`, 5000);
        }
        if (state.refresh) state.refresh();
    })();

    // A bundle exported on another host (GitHub Pages, another sandbox URL,
    // yesterday's session) can simply be dropped onto the game window: it is
    // read here and posted to the dev server, note by note.
    win.addEventListener("dragover", (e) => {
        if (!state.unlocked) return;
        e.preventDefault();
    });
    win.addEventListener("drop", async (e) => {
        if (!state.unlocked) return;
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file || !/\.json$/i.test(file.name)) return;
        e.preventDefault();
        let data;
        try { data = JSON.parse(await file.text()); }
        catch { toast("это не файл заметок"); return; }
        const notes = Array.isArray(data) ? data
            : Array.isArray(data.notes) ? data.notes
            : data.text ? [data] : null;
        if (!notes || !notes.length) { toast("в файле нет заметок"); return; }
        let sent = 0;
        for (const note of notes) {
            // eslint-disable-next-line no-await-in-loop — a handful of notes, in order
            if (await postNote(note)) sent++; else queue.push(note);
        }
        toast(sent === notes.length
            ? `принято заметок: ${sent}`
            : `принято ${sent} из ${notes.length}, остальные в очереди`, 4000);
        if (state.refresh) state.refresh();
    });

    return state;
}
