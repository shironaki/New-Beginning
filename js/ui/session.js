/** Browser session controls. No automatic overwrite until Continue/New Game
 * has been explicitly selected; failed loads keep both live state and disk. */
export function checkpoint(game, quiet = false) {
    if (game.sessionReady === false) return false;
    const ok = game.save.write({ day: game.clock.day, zone: game.zone.id });
    if (!quiet || !ok) game.hud.toast(ok ? "Игра сохранена на этом устройстве" : "Не удалось сохранить. Не закрывайте игру: проверьте хранилище браузера.", ok ? "💾" : "⚠️");
    game._saveElapsed = 0;
    return ok;
}
export function resumeSaved(game) {
    const data = game.save.read();
    if (!data || !game.save.restore(data)) {
        game.hud.toast("Сохранение не удалось загрузить. Текущая игра и файл не заменены.", "⚠️");
        return false;
    }
    game.sessionReady = true;
    game.hud.closePanel(true); game.hud.hideStory();
    game.input.releaseAll(); game.input.consume(); game.touch?.reset();
    if (!game.player.fallTimer) game.player.mvx = game.player.mvy = 0;
    game.player.vx = game.player.vy = 0;
    game.player.gait = game.player.runBlend = game.player.actionTimer = 0;
    game.player.sleeping = false; game.sleepTarget = null;
    game.tracks.clear(); game.particles.n = 0; game.interact = null;
    game.camera.snapTo(game.player.x, game.player.y); game.renderer.invalidate();
    game._saveElapsed = 0; game._saveDue = false;
    game.hud.toast(!game.isTrial && !data.parts.world
        ? "Загружен старый сейв: он не содержал состояние собранных ресурсов." : "Продолжаем с сохранённого места", "💾");
    return true;
}
export function openSessionMenu(game) {
    const g = game, initial = g.sessionReady === false;
    g.input.releaseAll(); g.touch?.reset();
    const rows = [];
    if (!initial) rows.push({ label: "Продолжить игру", action: () => g.hud.closePanel(true) });
    if (g.save.has()) rows.push({ label: initial ? "Продолжить сохранение" : "Загрузить сохранение", icon: "💾", action: () => {
        if (initial) resumeSaved(g);
        else g.hud.openPanel("Загрузить и заменить текущий прогресс?", [
            { label: "Да, загрузить", action: () => resumeSaved(g) },
            { label: "Назад", action: () => openSessionMenu(g) }
        ], "session");
    } });
    if (!initial) rows.push({ label: "Состояние и причины", action: () => g.openCondition() });
    if (!initial) rows.push({ label: "Сохранить игру", icon: "💾", action: () => checkpoint(g) });
    if (!g.isTrial) rows.push({ label: "Новая игра", action: () => {
        g.hud.openPanel("Начать заново? Старый прогресс будет заменён после сохранения.", [
            { label: "Да, начать заново", action: () => {
                if (!g.save.restore(g.initialState)) return;
                g.sessionReady = true; g.hud.closePanel(true); g.hud.hideStory();
                g.input.releaseAll(); g.tracks.clear(); g.particles.n = 0;
                g.camera.snapTo(g.player.x, g.player.y); g.renderer.invalidate();
                checkpoint(g);
            } },
            { label: "Назад", action: () => openSessionMenu(g) }
        ], "session", { locked: initial });
    } });
    if (g.viewport) rows.push({ label: "Полный экран", icon: "⛶", action: () => g.viewport.toggleFullscreen() });
    if (g.viewport) rows.push({ label: "Интерфейс", action: () => {
        g.hud.openPanel("Интерфейс", [["auto", "Автоматически"], ["desktop", "ПК · клавиатура и мышь"], ["touch", "Сенсорный экран"]].map(([value, label]) => ({ label,
            action: () => { g.viewport.setControls(value); openSessionMenu(g); }
        })), "session", { locked: initial });
    } });
    rows.push({ html: "Сохранение хранится в этом браузере. На телефоне, ПК, Pages и превью — отдельные хранилища. Перед закрытием нажмите «Сохранить игру»." });
    if (g.isTrial) rows.push({ label: "День / ночь / дождь / зима", action: () => g.openTrialConditions() });
    if (!g.isTrial) rows.push({ label: "Игровой участок рельефа", action: () => leaveFor(g, "?relief=1") });
    g.hud.openPanel("Игра · пауза", rows, "session", { locked: initial });
}
export function leaveFor(game, url) {
    if (!game.isTrial && game.sessionReady === false) {
        game.hud.toast("Сначала продолжите сохранение или начните новую игру.", "ℹ️"); return false;
    }
    if (!game.isTrial && !checkpoint(game)) return false;
    window.location.href = url;
    return true;
}
export function sessionTick(game, dt, blocked) {
    if (game.isTrial || game.sessionReady === false) return;
    if (!blocked) game._saveElapsed = (game._saveElapsed || 0) + dt;
    if (game._saveDue || game._saveElapsed >= 30) {
        game._saveDue = false; checkpoint(game, true);
    }
}
export function installSession(game) {
    game.sessionReady = true;
    game.initialState = JSON.parse(JSON.stringify(game.save.snapshot()));
    const bar = document.createElement("nav"); bar.className = "sessionControls";
    bar.setAttribute("aria-label", "Управление игрой");
    game.sessionButtons = { bag: game.hud.els.quickBag };
    for (const [id, label, action] of [
        ["menu", "☰", () => openSessionMenu(game)],
        ["journal", "Дневник", () => { game.input.releaseAll(); game.hud.hideStory(); game.openJournal(); }],
        ["action", "Действие", () => game.input.tap("action")],
        ["fullscreen", "⛶", () => game.viewport?.toggleFullscreen()]
    ]) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = label;
        b.className = `control-${id}`;
        b.setAttribute("aria-label", { menu: "Меню игры", bag: "Рюкзак", journal: "Дневник", action: "Действие", fullscreen: "На весь экран" }[id]);
        b.addEventListener("click", () => { if (id === "menu" || id === "fullscreen" || game.sessionReady !== false) action(); });
        bar.appendChild(b); game.sessionButtons[id] = b;
    }
    game.hud.root.appendChild(bar);
}
export function bindSessionLifecycle(game, win, doc) {
    const suspend = () => {
        if (game.backgrounded) return;
        game.backgrounded = true; game.input.releaseAll(); game.touch?.reset();
        if (!game.isTrial) checkpoint(game, true);
    };
    const wake = () => { if (!doc.hidden) { game.backgrounded = false; game.input.releaseAll(); game.touch?.reset(); } };
    win.addEventListener("blur", suspend);
    win.addEventListener("focus", wake);
    win.addEventListener("pagehide", suspend);
    win.addEventListener("pageshow", wake);
    doc.addEventListener("visibilitychange", () => doc.hidden ? suspend() : wake());
}
