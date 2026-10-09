/** Stage 62: real camera/renderer wiring, visual bounds, modes and fullscreen.
 * DOM stubs check contracts, not CSS geometry; browser checks are separate. */
import { test, assert, run } from "./tiny.js";
import { installDOM, FakeElement } from "./dom-harness.js";
import { viewportRect, renderSize, controlMode, installViewport } from "../js/ui/viewport.js";
import { MemoryStorage } from "../js/core/save.js";
import { UI } from "../js/ui/uispec.js";
import { openSessionMenu } from "../js/ui/session.js";
installDOM();
const { Game } = await import("../js/main.js");
const { ReliefTrialGame } = await import("../js/dev/relief-trial.js");
function setup(Type = Game, coarse = false) {
    const canvas = new FakeElement("canvas"), stage = new FakeElement();
    const game = new Type({ canvas, hudRoot: new FakeElement(), seed: 62 });
    const win = new FakeElement(), doc = new FakeElement(), mq = new FakeElement();
    mq.matches = coarse;
    Object.assign(win, { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
        visualViewport: Object.assign(new FakeElement(), { width: 1920, height: 1080, offsetTop: 0, offsetLeft: 0 }),
        localStorage: new MemoryStorage(), matchMedia: () => mq });
    game.viewport = installViewport(game, stage, win, doc);
    return { game, canvas, stage, win, doc, mq };
}
test("visual bounds beat layout viewport including browser chrome offsets", () => {
    assert.deep(viewportRect({ innerWidth: 390, innerHeight: 844, visualViewport: { width: 390, height: 664, offsetTop: 12, offsetLeft: 3 } }), { width: 390, height: 664, left: 3, top: 12 });
    assert.deep(viewportRect({ innerWidth: 1920, innerHeight: 1080 }), { width: 1920, height: 1080, left: 0, top: 0 });
});
test("backing pixel budget does not cap layout, DPR bounded separately", () => {
    const size = renderSize({ width: 7680, height: 4320 }, { devicePixelRatio: 4 });
    assert.lte(size.width * size.height, 8_010_000);
    assert.eq(renderSize({ width: 390, height: 700 }, { devicePixelRatio: 3 }).density, 2);
});
test("primary pointer, not narrow width or touch-capable laptop, selects UI", () => {
    assert.eq(controlMode({ innerWidth: 320, maxTouchPoints: 10, matchMedia: () => ({ matches: false }) }), "desktop");
    assert.eq(controlMode({ matchMedia: () => ({ matches: true }) }), "touch");
    assert.eq(controlMode({}, "touch"), "touch"); assert.eq(controlMode({}, "desktop"), "desktop");
    assert.eq(controlMode({}), "desktop");
});
test("desktop stage, canvas and real renderer camera cover uncapped 1920x1080", () => {
    const { game, canvas, stage } = setup();
    assert.eq(stage.style.width, "1920px"); assert.eq(stage.style.height, "1080px");
    assert.eq(canvas.style.width, stage.style.width); assert.eq(canvas.width, 1920);
    assert.eq(game.camera.width, 1920); assert.eq(game.camera.zoom, UI.baseZoom);
    for (const id of ["journal", "action"]) assert.ok(game.sessionButtons[id].hidden);
    assert.eq(stage.getAttribute("data-controls"), "desktop");
});
test("visible viewport resize, scrolling and orientation reposition HUD and stop held touch", () => {
    const { win, game, stage, canvas } = setup(Game, true);
    game.input.setStick(1, 0);
    Object.assign(win.visualViewport, { width: 390, height: 620, offsetTop: 20 });
    win.visualViewport.dispatch("resize");
    assert.eq(stage.style.height, "620px"); assert.eq(stage.style.top, "20px");
    assert.eq(canvas.style.height, "620px"); assert.eq(game.input.stick.x, 0);
    assert.not(game.sessionButtons.action.hidden);
    win.visualViewport.offsetTop = 0; win.visualViewport.dispatch("scroll"); assert.eq(stage.style.top, "0px");
    Object.assign(win.visualViewport, { width: 740, height: 350 }); win.dispatch("orientationchange");
    assert.eq(stage.getAttribute("data-short"), "true"); assert.eq(stage.getAttribute("data-shape"), "wide");
    assert.ok(game.camera.isVisible(game.player.x, game.player.y));
});
test("ordinary viewport resize keeps world center; DPR does not change field of view", () => {
    const { game, win } = setup();
    game.camera.snapTo(game.player.x, game.player.y);
    const center = game.camera.x + game.camera.viewW / 2, viewW = game.camera.viewW;
    win.devicePixelRatio = 2; win.dispatch("resize");
    assert.near(game.camera.viewW, viewW, .1); assert.near(game.camera.x + game.camera.viewW / 2, center);
});
test("coalesces resize events, no fit or listeners after destroy", () => {
    const { game, win, stage } = setup(); const pending = [];
    win.requestAnimationFrame = (fn) => pending.push(fn);
    win.visualViewport.height = 500; win.dispatch("resize"); win.visualViewport.dispatch("resize");
    assert.eq(pending.length, 1); pending.shift()(); assert.eq(stage.style.height, "500px");
    win.visualViewport.height = 400; win.dispatch("resize"); game.viewport.destroy(); pending.shift()();
    assert.eq(stage.style.height, "500px"); win.dispatch("resize"); assert.eq(pending.length, 0);
});
test("mode switching resets movement, persists preference, auto follows primary pointer", () => {
    const { game, win, mq } = setup();
    game.input.setStick(1, 0); game.viewport.setControls("touch");
    assert.eq(game.input.stick.x, 0); assert.eq(win.localStorage.getItem("new-beginning:controls"), "touch");
    mq.dispatch("change"); assert.eq(game.controlMode, "touch");
    game.viewport.setControls("auto"); assert.eq(game.controlMode, "desktop");
    mq.matches = true; mq.dispatch("change"); assert.eq(game.controlMode, "touch");
});
test("blocked optional storage never prevents fitting or changing interface", () => {
    const { game, win, stage, doc } = setup(); game.viewport.destroy();
    Object.defineProperty(win, "localStorage", { get() { throw Error("private mode"); } });
    game.viewport = installViewport(game, stage, win, doc); game.viewport.setControls("touch");
    assert.eq(game.controlMode, "touch"); assert.eq(stage.style.width, "1920px");
});
test("saved explicit preference is restored even on coarse primary pointer", () => {
    const { game, win, stage, doc } = setup(Game, true); game.viewport.setControls("desktop"); game.viewport.destroy();
    game.viewport = installViewport(game, stage, win, doc); assert.eq(game.controlMode, "desktop");
});
test("fullscreen requests stage with HUD, exits, and tracks external Escape", async () => {
    const { game, stage, doc } = setup(); let target;
    stage.requestFullscreen = async function () { target = this; doc.fullscreenElement = this; };
    doc.exitFullscreen = async () => { doc.fullscreenElement = null; };
    assert.ok(await game.viewport.toggleFullscreen()); assert.eq(target, stage);
    assert.eq(game.sessionButtons.fullscreen.getAttribute("aria-pressed"), "true");
    assert.ok(await game.viewport.toggleFullscreen()); assert.eq(doc.fullscreenElement, null);
    await game.viewport.toggleFullscreen(); doc.fullscreenElement = null; doc.dispatch("fullscreenchange");
    assert.eq(game.sessionButtons.fullscreen.getAttribute("aria-pressed"), "false");
});
test("WebKit fullscreen fallback, unsupported and rejected request stay usable", async () => {
    const { game, stage, doc } = setup(); const notices = []; game.hud.toast = (s) => notices.push(s);
    assert.not(await game.viewport.toggleFullscreen()); assert.ok(notices[0].includes("не поддерживает"));
    stage.webkitRequestFullscreen = async () => { doc.webkitFullscreenElement = stage; };
    doc.webkitExitFullscreen = async () => { doc.webkitFullscreenElement = null; };
    assert.ok(await game.viewport.toggleFullscreen()); assert.ok(await game.viewport.toggleFullscreen());
    stage.webkitRequestFullscreen = async () => { throw Error("blocked by browser"); };
    assert.not(await game.viewport.toggleFullscreen()); assert.ok(notices.at(-1).includes("не разрешил"));
});
test("desktop ignores touch gestures; touch mode accepts them without tutorial elements", () => {
    const { game, canvas } = setup();
    const point = { identifier: 1, clientX: 10, clientY: 100 };
    canvas.dispatch("touchstart", { changedTouches: [point] });
    canvas.dispatch("touchmove", { changedTouches: [{ ...point, clientX: 60 }], preventDefault() {} });
    assert.eq(game.input.stick.x, 0);
    game.viewport.setControls("touch"); canvas.dispatch("touchstart", { changedTouches: [point] });
    canvas.dispatch("touchmove", { changedTouches: [{ ...point, clientX: 60 }], preventDefault() {} });
    assert.gt(game.input.stick.x, .8);
    assert.not(game.hud.root.innerHTML.includes("staminaHint"));
    assert.not(game.hud.els.hotbar.innerHTML.includes("slotKey"));
    const pad = game.hud.root.children.find((c) => c.className === "touchStick");
    assert.eq(pad.children.length, 1); assert.eq(pad.children[0].tagName, "I");
});
test("initial protected save menu offers fullscreen and interface without unlocking save", () => {
    const { game } = setup(); game.sessionReady = false; let rows;
    game.hud.openPanel = (_title, r) => { rows = r; }; openSessionMenu(game);
    assert.ok(rows.find((r) => r.label === "Полный экран"));
    rows.find((r) => r.label === "Интерфейс").action(); rows[1].action();
    assert.eq(game.controlMode, "desktop"); assert.eq(game.sessionReady, false);
});
test("relief pilot uses same mobile rectangle and resize wiring as normal game", () => {
    const { game, win, canvas } = setup(ReliefTrialGame, true);
    Object.assign(win.visualViewport, { width: 360, height: 640 }); win.dispatch("pageshow");
    assert.eq(canvas.style.width, "360px"); assert.eq(game.controlMode, "touch");
    assert.ok(game.camera.isVisible(game.player.x, game.player.y)); game.render();
});
await run("viewport");
