/** Optional real-browser review. No packages, browser download, or server launch.
 * Start a disposable Chromium with --remote-debugging-port=9222 and the game
 * server separately; Node 22+: node tools/viewport-review.js [baseURL] [cdpURL].
 * Never point this at a personal browser profile: it drives the current tab.
 * Emulation verifies layout, not physical browser chrome or iOS fullscreen. */
import fs from "node:fs";
import assert from "node:assert/strict";
const base = process.argv[2] || "http://127.0.0.1:3000";
const cdp = process.argv[3] || "http://127.0.0.1:9222";
const out = process.env.REVIEW_OUT || ".artifacts/stage63";
fs.mkdirSync(out, { recursive: true });
const targets = await (await fetch(`${cdp}/json/list`)).json();
const target = targets.find((t) => t.type === "page");
if (!target) throw Error("Open a disposable browser tab first");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map(), events = new Map(), errors = [], summary = [];
ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
        const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(Error(JSON.stringify(m.error))); else p.resolve(m.result);
    } else {
        if (m.method === "Runtime.exceptionThrown") errors.push(m.params);
        const event = events.get(m.method);
        if (event) { events.delete(m.method); clearTimeout(event.timer); event.resolve(m.params); }
    }
};
function nextEvent(method) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`CDP event timeout: ${method}`)), 30000);
        events.set(method, { resolve, timer });
    });
}
function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => reject(Error(`CDP timeout: ${method}`)), 30000);
        pending.set(n, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: n, method, params }));
    });
}
async function evaluate(expression, userGesture = false) {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
}
async function frames() { await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"); }
async function screenshot(name) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(`${out}/${name}.png`, Buffer.from(shot.data, "base64"));
}
try {
    await send("Page.enable"); await send("Runtime.enable");
    for (const [name, width, height, touch, path] of [
        ["phone", 390, 664, true, "/"], ["small-phone", 320, 568, true, "/"],
        ["landscape", 844, 360, true, "/"], ["small-landscape", 640, 320, true, "/"],
        ["desktop", 1920, 1080, false, "/"], ["narrow-desktop", 390, 664, false, "/"],
        ["relief-phone", 390, 664, true, "/?relief=1"]
    ]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: touch });
        await send("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
        const loaded = nextEvent("Page.loadEventFired");
        await send("Page.navigate", { url: base + path });
        await loaded;
        await evaluate(`new Promise((resolve, reject) => {
            let n = 0;
            function ready() {
                if (window.GAME?.viewport) {
                    GAME.hud.hideStory(); GAME.hud.closePanel(true); GAME.sessionReady = true; resolve(true);
                } else if (n++ > 600) reject('boot timeout'); else requestAnimationFrame(ready);
            } ready();
        })`);
        await frames();
        // Freeze only the review scene; avoid perpetual GPU work during captures.
        await evaluate("GAME.loop.stop()");
        const metrics = await evaluate(`(() => {
            const selectors = ['#stage','#game','#hud','.hudTop','.needsCard','.skyCard','.objectiveBar','.hotbar','.sessionControls','.touchStick',
                ...Array.from(document.querySelectorAll('.sessionControls button')).map(el => '.' + el.className)];
            const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height, shown:getComputedStyle(el).display !== 'none' }; };
            return { mode:GAME.controlMode, elements:Object.fromEntries(selectors.map(s => [s,rect(document.querySelector(s))])),
                targets:Array.from(document.querySelectorAll('.hotbar button,.sessionControls button')).map(rect) };
        })()`);
        assert.equal(metrics.mode, touch ? "touch" : "desktop", name);
        for (const s of ["#stage", "#game", "#hud"]) {
            assert.equal(metrics.elements[s].w, width, `${name}: ${s} width`);
            assert.equal(metrics.elements[s].h, height, `${name}: ${s} height`);
        }
        for (const s of [".touchStick", ".control-journal", ".control-action"])
            assert.equal(metrics.elements[s].shown, touch, `${name}: ${s} visibility`);
        const shown = metrics.targets.filter((r) => r.shown);
        for (const r of shown) {
            assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= width + 1 && r.y + r.h <= height + 1, `${name}: clipped control`);
            assert.ok(r.w >= 44 && r.h >= 44, `${name}: small control`);
        }
        for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
            const a = shown[i], b = shown[j];
            assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${name}: controls overlap`);
        }
        summary.push({ name, ...metrics }); await screenshot(name);
        // Real click consumes a berry and preserves the tool; empty slots are gone.
        if (name === "phone" || name === "desktop") {
            const before = await evaluate("({food:GAME.needs.food,n:GAME.inventory.count('berry'),active:GAME.inventory.activeSlot})");
            await evaluate("document.querySelector('#eatItem').click(); GAME.update(0)");
            const after = await evaluate("({food:GAME.needs.food,n:GAME.inventory.count('berry'),active:GAME.inventory.activeSlot})");
            assert.equal(after.n, before.n - 1); assert.equal(after.active, before.active); assert.ok(after.food > before.food);
            await evaluate("document.querySelector('#needSummary').click()"); await frames();
            assert.equal(await evaluate("document.querySelector('#needSummary').getAttribute('aria-expanded')"), "true");
            const details = await evaluate("document.querySelector('#needsDetails').getBoundingClientRect().toJSON()");
            assert.ok(details.x >= 0 && details.right <= width && details.bottom <= height, name + ': needs disclosure bounds');
            await screenshot(name + '-needs');
            await evaluate("document.querySelector('#conditionButton').click()"); await frames();
            assert.equal(await evaluate("GAME.hud.panelOpen"), "condition");
            await screenshot(name + '-condition');
            await evaluate("GAME.hud.closePanel(true)");
        }
        if (name === "landscape" || name === "small-phone") {
            await evaluate("GAME.sessionButtons.menu.click()"); await frames();
            const panel = await evaluate(`(() => {
                const body = document.querySelector('.panelBody'); body.scrollTop = body.scrollHeight;
                const panel = document.querySelector('.panel').getBoundingClientRect();
                const last = body.lastElementChild.getBoundingClientRect(), bounds = body.getBoundingClientRect();
                return { top:panel.top, bottom:panel.bottom, lastVisible:last.bottom <= bounds.bottom + 1 };
            })()`);
            assert.ok(panel.top >= 0 && panel.bottom <= height && panel.lastVisible, `${name}: panel scroll`);
            await screenshot(`${name}-menu`);
            await evaluate(`GAME.hud.closePanel(true); GAME.hud.showStory({title:'Проверка прокрутки',text:'Длинная история. '.repeat(150)});
                document.querySelector('.storyCard').scrollTop = document.querySelector('.storyCard').scrollHeight`);
            await frames();
            const button = await evaluate("document.querySelector('#storyOk').getBoundingClientRect().toJSON()");
            assert.ok(button.top >= 0 && button.bottom <= height, `${name}: story close unreachable`);
            await screenshot(`${name}-story`);
        }
        if (name === "desktop") {
            assert.equal(await evaluate("GAME.viewport.toggleFullscreen()", true), true);
            assert.equal(await evaluate("document.fullscreenElement === document.querySelector('#stage')"), true);
            assert.equal(await evaluate("GAME.viewport.toggleFullscreen()", true), true);
            const walk = await evaluate("({x:GAME.player.x,y:GAME.player.y,h:GAME.zone.playableRelief.heightAt(GAME.player.x,GAME.player.y)})");
            await evaluate("document.activeElement?.blur(); GAME.input.releaseAll(); GAME.loop.start()");
            await send("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyW", key: "w", windowsVirtualKeyCode: 87 });
            await evaluate("new Promise(resolve => setTimeout(resolve, 3500))");
            await send("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyW", key: "w", windowsVirtualKeyCode: 87 });
            await frames(); await evaluate("GAME.loop.stop(); GAME.input.releaseAll()");
            const end = await evaluate("({x:GAME.player.x,y:GAME.player.y,h:GAME.zone.playableRelief.heightAt(GAME.player.x,GAME.player.y),fits:GAME.fitsAt(GAME.player.x,GAME.player.y)})");
            assert.ok(end.y < walk.y - 30 && end.h > walk.h + 5 && end.fits, "real keyboard climb in normal game");
            fs.writeFileSync(`${out}/keyboard-climb.json`, JSON.stringify({start:walk,end}, null, 2));
            await screenshot("desktop-climb");
        }
    }
    assert.equal(errors.length, 0, "browser exceptions");
    console.log(`PASS: ${summary.length} browser layouts, control bounds/separation, menus, story scrolling, stage fullscreen, food use, needs disclosure and real keyboard climb; no runtime exceptions.`);
} finally {
    fs.writeFileSync(`${out}/browser.json`, JSON.stringify({ summary, errors }, null, 2));
    for (const p of pending.values()) clearTimeout(p.timer);
    for (const e of events.values()) clearTimeout(e.timer);
    ws.close();
}
