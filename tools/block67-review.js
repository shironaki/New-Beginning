/** Hero/creator/terrace/carry/cookware native review (disposable Chromium required).
 * Stages camera, poses and cookware directly; not an end-to-end acquisition test.
 * No packages, browser download, or server launch.
 * Start a disposable Chromium with --remote-debugging-port=9222 and the game
 * server separately; Node 22+: node tools/block67-review.js [baseURL] [cdpURL].
 * Never point this at a personal browser profile: it drives the current tab.
 * Emulation verifies layout, not physical browser chrome or iOS fullscreen. */
import fs from "node:fs";
import assert from "node:assert/strict";
const base = process.argv[2] || "http://127.0.0.1:3000";
const cdp = process.argv[3] || "http://127.0.0.1:9222";
const out = process.env.REVIEW_OUT || ".artifacts/block67/scenes";
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
    await send("Page.enable");await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride",{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    const loaded=nextEvent("Page.loadEventFired");await send("Page.navigate",{url:base});await loaded;
    await evaluate(`new Promise(r=>{function ready(){if(!window.GAME?.viewport)return requestAnimationFrame(ready);GAME.loop.stop();GAME.hud.closePanel(true);GAME.hud.hideStory();GAME.storyNotices.length=0;GAME.sessionReady=true;r();}ready();})`);
    await evaluate(`(()=>{const g=GAME;g.clock.minute=12*60;g.camera.zoom=4;g.camera.snapTo(g.player.x,g.player.y);g.inventory.swapHands();g.update(0);g.render();})()`);
    for(const dir of ['down','left','up','right']) {await evaluate(`GAME.player.dir='${dir}';GAME.render()`);await screenshot('hero-left-knife-'+dir);}
    await evaluate(`(async()=>{const{openAppearance}=await import('./js/ui/appearance.js');openAppearance(GAME);})()`);await screenshot('appearance');
    await evaluate(`(()=>{const g=GAME;g.hud.closePanel();g.look.gender='female';g.look.hairStyle='braid';g.look.coat='#785044';g.look.stubble=false;g.player.dir='down';g.render();})()`);await screenshot('hero-female');
    await evaluate(`(()=>{const g=GAME;g.camera.zoom=2.4;g.placeSafely(1072,1190);g.camera.snapTo(1072,1120);g.render();})()`);await screenshot('home-terrace');
    await evaluate(`(()=>{const g=GAME;g.camera.zoom=4;const o=g.zone.objects.find(o=>o.kind==='campfire');g.placeSafely(o.x+30,o.y+30);g.camera.snapTo(o.x,o.y);const f=g.fires.get(g.fireKey(g.zone,o));f.installPot();g.render();})()`);await screenshot('pot-cold');
    await evaluate(`(()=>{const g=GAME;const o=g.zone.objects.find(o=>o.kind==='campfire'),f=g.fires.get(g.fireKey(g.zone,o));f.addFuel('log');f.light({hasFlint:true});f.startPot(['berry','berry']);g.render();})()`);await screenshot('pot-hot');
    await evaluate(`(()=>{const g=GAME;g.openBackpack();})()`);await screenshot('inventory-grid');
    await evaluate(`(async()=>{const{tickHands}=await import('./js/ui/hands.js');const g=GAME;g.hud.closePanel();g.storyNotices.length=0;g.hud.hideStory();const o=g.zone.objects.find(o=>o.kind==='firewood'&&!o.removed);g.player.x=o.x;g.player.y=o.y+18;g.harvest(o);tickHands(g,1);g.camera.snapTo(g.player.x,g.player.y);g.update(0);g.render();})()`);await screenshot('carried-wood');
    assert.equal(errors.length,0);fs.writeFileSync(`${out}/review.json`,JSON.stringify({errors},null,2));console.log('PASS: hero, creator, real terrace, cold/hot pot, inventory and physical bundle.');
} finally {for(const p of pending.values())clearTimeout(p.timer);for(const e of events.values())clearTimeout(e.timer);ws.close();}
