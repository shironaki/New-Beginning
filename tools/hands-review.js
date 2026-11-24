/** Two-hand/cookware/ice native review (disposable Chromium required). No packages, browser download, or server launch.
 * Start a disposable Chromium with --remote-debugging-port=9222 and the game
 * server separately; Node 22+: node tools/hands-review.js [baseURL] [cdpURL].
 * Never point this at a personal browser profile: it drives the current tab.
 * Emulation verifies layout, not physical browser chrome or iOS fullscreen. */
import fs from "node:fs";
import assert from "node:assert/strict";
const base = process.argv[2] || "http://127.0.0.1:3000";
const cdp = process.argv[3] || "http://127.0.0.1:9222";
const out = process.env.REVIEW_OUT || ".artifacts/stage65/scenes";
fs.mkdirSync(out, { recursive: true });
const targets = await (await fetch(`${cdp}/json/list`)).json();
const target = targets.find((t) => t.type === "page");
if (!target) throw Error("Open a disposable browser tab first");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map(), events = new Map(), errors = [];
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
    await evaluate("new Promise(r=>setTimeout(r,350))");
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(`${out}/${name}.png`, Buffer.from(shot.data, "base64"));
}
try {
    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    const loaded = nextEvent("Page.loadEventFired"); await send("Page.navigate", { url: base }); await loaded;
    await evaluate(`new Promise(resolve => { function ready(){ if(!window.GAME?.viewport) return requestAnimationFrame(ready);
        GAME.loop.stop(); GAME.hud.closePanel(true); GAME.hud.hideStory(); GAME.sessionReady=true; GAME.paused=false; resolve(true); } ready(); })`);
    await evaluate(`(() => { const g=GAME; g.inventory.add('torch'); g.inventory.equipHand('left',g.inventory.slots.findIndex(s=>s?.id==='torch'));
        g.clock.minute=12*60; g.camera.zoom=5; g.camera.snapTo(g.player.x,g.player.y); g.update(0); })()`);
    for (const dir of ['down','left','up','right']) {
        await evaluate(`GAME.player.dir='${dir}'; GAME.render()`); await screenshot('hands-'+dir);
    }
    const meal = await evaluate(`(async()=>{ const {startMeal}=await import('./js/ui/hands.js'); const g=GAME; g.player.dir='down';
        startMeal(g,'berry'); g.update(0); g.render(); return {left:g.inventory.hands.left.id,right:g.inventory.hands.right.id,n:g.inventory.count('berry')}; })()`);
    assert.deepEqual(meal,{left:'torch',right:'berry',n:3}); await screenshot('hands-eating');
    await evaluate("GAME.update(1); GAME.render()"); assert.equal(await evaluate("GAME.inventory.hands.right.id"),'knife');
    await evaluate("GAME.openBackpack(); GAME.render()"); await screenshot('bag');
    const pot = await evaluate(`(() => { const g=GAME; g.hud.closePanel(); g.inspectHearth(g.zone.objects.find(o=>o.kind==='hearth_ruin'));
        return {count:g.inventory.count('pot'), offered:document.querySelector('#panel').textContent.includes('Забрать котелок')}; })()`);
    assert.equal(pot.count,0); assert.equal(pot.offered,true); await screenshot('hearth-cookware');
    const states=[];
    for(const [name,day,minute,weather] of [['ice-night',85,21*60+22,'cloudy'],['ice-snow',85,12*60,'snow'],['thaw',85,12*60,'clear']]) {
        const state=await evaluate(`(async()=>{ const {waterIce}=await import('./js/world/water-state.js');const g=GAME;
            g.storyNotices.length=0;g.hud.closePanel(true);g.hud.hideStory();g.clock.day=${day};g.clock.minute=${minute};g.weather.current='${weather}';
            if(g.zone.id!=='shore')g.enterZone('shore',null,true);g.camera.zoom=3;g.update(0);g.placeSafely(2065,945);g.camera.snapTo(2110,945);g.render();
            return {storyOpen:g.hud.isStoryOpen,temperature:g.zone.map.waterState.temperature,lake:waterIce(g.zone.map,2225,865),sea:waterIce(g.zone.map,2002,922)};})()`);
        states.push({name,...state}); await screenshot(name);
    }
    assert.ok(states.every(s=>!s.storyOpen));
    assert.equal(states[0].lake.walkable,true); assert.equal(states[0].sea.blocked,true); assert.equal(states[0].sea.broken,true);
    assert.equal(states[2].lake.cover,0); assert.equal(errors.length,0);
    fs.writeFileSync(`${out}/review.json`,JSON.stringify({meal,pot,states,errors},null,2));
    console.log('PASS: native anatomical hands, timed meal, bag, attainable cookware offer and visible ice states; no runtime exceptions.');
} finally {
    for(const p of pending.values()) clearTimeout(p.timer);
    for(const e of events.values()) clearTimeout(e.timer);
    ws.close();
}
