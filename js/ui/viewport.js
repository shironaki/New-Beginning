/** One visible rectangle owns stage, canvas, HUD and camera. Browser chrome
 * changes the visual viewport; render resolution is a separate pixel budget. */
import { UI, pixelRatio } from "./uispec.js";
export function viewportRect(win) {
    const v = win.visualViewport;
    return { width: Math.max(1, Math.round(v?.width || win.innerWidth || 960)),
        height: Math.max(1, Math.round(v?.height || win.innerHeight || 540)),
        left: Math.max(0, v?.offsetLeft || 0), top: Math.max(0, v?.offsetTop || 0) };
}
export function renderSize(rect, win) {
    const density = Math.min(pixelRatio(win), Math.sqrt(8_000_000 / (rect.width * rect.height)));
    return { width: Math.max(1, Math.round(rect.width * density)),
        height: Math.max(1, Math.round(rect.height * density)), density };
}
export function controlMode(win, preference = "auto") {
    if (preference === "desktop" || preference === "touch") return preference;
    // Primary pointer only: a touch-capable laptop with a mouse is not a phone.
    return win.matchMedia?.("(pointer: coarse) and (hover: none)").matches ? "touch" : "desktop";
}
export function installViewport(game, stage, win = window, doc = document) {
    const listeners = [], storageKey = "new-beginning:controls";
    let queued = false, preference = "auto", disposed = false, lastBounds = "";
    try { const value = win.localStorage?.getItem(storageKey); if (["auto", "desktop", "touch"].includes(value)) preference = value; } catch { /* private mode */ }
    const on = (target, event, handler) => {
        target?.addEventListener?.(event, handler);
        listeners.push(() => target?.removeEventListener?.(event, handler));
    };
    const fullscreen = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    const fit = () => {
        if (disposed) return;
        queued = false;
        const rect = viewportRect(win), size = renderSize(rect, win), cam = game.camera;
        const center = { x: cam.x + cam.viewW / 2, y: cam.y + cam.viewH / 2 };
        Object.assign(stage.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        stage.setAttribute("data-shape", rect.width > rect.height ? "wide" : "tall");
        stage.setAttribute("data-short", String(rect.height < 480));
        stage.setAttribute("data-narrow", String(rect.width < 720));
        stage.setAttribute("data-tight", String(rect.width < 624));
        const mode = controlMode(win, preference);
        stage.setAttribute("data-controls", mode);
        const bounds = `${rect.width}:${rect.height}:${rect.left}:${rect.top}`;
        if (game.controlMode !== mode || bounds !== lastBounds) { game.input.releaseAll(); game.touch?.reset(); }
        lastBounds = bounds;
        game.controlMode = mode;
        for (const id of ["bag", "journal", "action"]) game.sessionButtons[id].hidden = mode !== "touch";
        const canvas = game.renderer.canvas;
        Object.assign(canvas.style, { width: `${rect.width}px`, height: `${rect.height}px` });
        if (canvas.width !== size.width || canvas.height !== size.height || cam.zoom !== UI.baseZoom * size.density) {
            game.renderer.resize(size.width, size.height);
            cam.zoom = UI.baseZoom * size.density;
            cam.snapTo(center.x, center.y);
            if (!cam.isVisible(game.player.x, game.player.y, -20)) cam.snapTo(game.player.x, game.player.y - 8);
        } else cam.zoom = UI.baseZoom * size.density;
        const button = game.sessionButtons.fullscreen;
        if (button) {
            button.textContent = fullscreen() ? "⊡" : "⛶";
            button.setAttribute("aria-label", fullscreen() ? "Выйти из полного экрана" : "На весь экран");
            button.setAttribute("aria-pressed", String(fullscreen()));
        }
    };
    const schedule = () => {
        if (queued || disposed) return;
        queued = true;
        if (win.requestAnimationFrame) win.requestAnimationFrame(fit); else fit();
    };
    const api = {
        fit,
        setControls(value) {
            preference = ["touch", "desktop"].includes(value) ? value : "auto";
            try { win.localStorage?.setItem(storageKey, preference); } catch { /* optional preference */ }
            fit();
        },
        async toggleFullscreen() {
            try {
                if (fullscreen()) {
                    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
                    if (!exit) throw Error("unsupported");
                    await exit.call(doc);
                } else {
                    const request = stage.requestFullscreen || stage.webkitRequestFullscreen;
                    if (!request) {
                        game.hud.toast("Этот браузер не поддерживает полный экран. Игра подстраивается под видимую область.", "ℹ️");
                        return false;
                    }
                    await request.call(stage, { navigationUI: "hide" });
                }
                game.input.releaseAll(); game.touch?.reset(); fit();
                return true;
            } catch {
                game.hud.toast("Браузер не разрешил полный экран. Оконный режим остаётся доступен.", "ℹ️");
                fit(); return false;
            }
        },
        destroy() { disposed = true; listeners.forEach((remove) => remove()); }
    };
    on(win, "resize", schedule); on(win, "orientationchange", schedule); on(win, "pageshow", schedule);
    on(win.visualViewport, "resize", schedule); on(win.visualViewport, "scroll", schedule);
    on(doc, "fullscreenchange", schedule); on(doc, "webkitfullscreenchange", schedule);
    on(win.matchMedia?.("(pointer: coarse) and (hover: none)"), "change", schedule);
    fit(); return api;
}
