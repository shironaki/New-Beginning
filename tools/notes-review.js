/** Optional note/cooking browser regression review. No packages, browser download, or server launch.
 * Start a disposable Chromium with --remote-debugging-port=9222 and the game
 * server separately; Node 22+: node tools/viewport-review.js [baseURL] [cdpURL].
 * Never point this at a personal browser profile: it drives the current tab.
 * Emulation verifies layout, not physical browser chrome or iOS fullscreen. */
import fs from "node:fs";
import assert from "node:assert/strict";
const base = process.argv[2] || "http://127.0.0.1:3000";
const cdp = process.argv[3] || "http://127.0.0.1:9222";
const out = process.env.REVIEW_OUT || ".artifacts/stage64";
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
    await send("Emulation.setDeviceMetricsOverride", { width: 1092, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    const loaded = nextEvent("Page.loadEventFired"); await send("Page.navigate", { url: base + "/" }); await loaded;
    await evaluate(`new Promise(resolve => {
        function ready() { if (!window.GAME) return requestAnimationFrame(ready); GAME.loop.stop(); GAME.hud.hideStory(); GAME.hud.closePanel(true); GAME.sessionReady = true; resolve(); } ready();
    })`);
    const seam = await evaluate(`(async () => {
        const {Renderer} = await import('./js/render/renderer.js');
        const {projectGround} = await import('./js/render/projected-ground.js');
        const field = GAME.zone.playableRelief;
        const chunks=[{cx:1,cy:1,key:'a'},{cx:2,cy:1,key:'b'},{cx:1,cy:2,key:'c'},{cx:2,cy:2,key:'d'}];
        const make = inset => chunks.map(ch => {
            const source=document.createElement('canvas'); source.width=source.height=512+2*inset;
            const c=source.getContext('2d'); c.fillStyle='#808080'; c.fillRect(0,0,source.width,source.height);
            const cv=projectGround(source,field,ch.cx*512-inset,ch.cy*512-inset); cv.groundInset=inset; return cv;
        });
        const old=make(0), fixed=make(8);
        const screen=document.createElement('canvas'); screen.width=320; screen.height=240;
        const ctx=screen.getContext('2d'); ctx.imageSmoothingEnabled=false;
        let oldDark=0,fixedDark=0;
        for(const zoom of [1.25,2.4,3.1,4.8]) for(const fraction of [.1,.33,.5,.73]) {
            const camera={x:990+fraction,y:950+fraction,offsetX:0,offsetY:0,zoom,viewW:320/zoom,viewH:240/zoom};
            const zone={id:'test',playableRelief:field,map:{dirtyChunks:new Set(),chunksInRect:()=>chunks}};
            const count=()=>{ const d=ctx.getImageData(0,0,320,240).data; let n=0; for(let i=0;i<d.length;i+=4) if(d[i]!==128)n++; return n; };
            ctx.fillStyle='#000'; ctx.fillRect(0,0,320,240);
            chunks.forEach((ch,i)=>{ const cv=old[i]; ctx.drawImage(cv,(ch.cx*512-camera.x)*zoom,(ch.cy*512-cv.groundLift-camera.y)*zoom,cv.width*zoom,cv.height*zoom); });
            oldDark+=count();
            ctx.fillRect(0,0,320,240);
            const renderer={camera,ctx,stats:{},chunkCache:new Map(chunks.map((ch,i)=>['test:'+ch.key,fixed[i]]))};
            Renderer.prototype.drawGround.call(renderer,zone); fixedDark+=count();
        }
        return {oldDark,fixedDark};
    })()`);
    // Uniform fills verify coverage, not every native texture-edge sampling artifact.
    console.log('Projected coverage', seam);
    assert.equal(seam.fixedDark,0,'gutters cover projected seams at all sampled positions');
    await evaluate(`(() => {
        const g=GAME; g.clock.day=1; g.clock.minute=18*60+19; g.weather.current='cloudy';
        g.placeSafely(1136,1160); g.camera.zoom=2.4; g.camera.x=881.1; g.camera.y=945;
        g.update(0); g.render();
    })()`);
    await evaluate(`(async()=>{
        const {bakeTerrain}=await import('./js/render/terrain.js');
        const {projectGround}=await import('./js/render/projected-ground.js');
        const r=GAME.renderer; r._savedBake=r.bakeChunk;
        r.bakeChunk=function(zone,cx,cy){const cv=document.createElement('canvas');cv.width=cv.height=512;
            bakeTerrain(cv.getContext('2d'),zone,cx,cy,512,this.season);
            return projectGround(cv,zone.playableRelief,cx*512,cy*512);};
        r.invalidate(); GAME.render();
    })()`); await screenshot('note026-without-gutter');
    await evaluate('GAME.renderer.bakeChunk=GAME.renderer._savedBake; GAME.renderer.invalidate(); GAME.render()');
    await screenshot('note026-seam');
    const cooking = await evaluate(`(() => {
        const g=GAME; g.inventory.clear(); g.inventory.add('knife'); g.inventory.add('meat_raw'); g.inventory.add('herb_mint'); g.inventory.add('log'); g.inventory.add('flint');
        const obj=g.zone.objects.find(o=>o.kind==='campfire'); g.placeSafely(obj.x,obj.y+24); g.openFire(obj);
        const click=text=>{const row=[...document.querySelectorAll('.panelRow')].find(r=>r.querySelector('.rowLabel').textContent===text); if(!row)throw Error('Missing '+text); row.click();};
        click('Подбросить бревно'); click('Разжечь костёр'); click('На вертел: сырое мясо'); click('Оставить готовиться');
        const fire=g.fires.get(g.fireKey(g.zone,obj)); let ticks=0;
        while(fire.spit[0].state!=='done' && ticks++<20000) { if(g.hud.isStoryOpen) document.querySelector('#storyOk').click(); g.update(1/60); }
        if(fire.spit[0].state!=='done')throw Error('Cooking stalled');
        g.openFire(obj); click('Готово — снять');
        fire.installPot(); g.openFire(obj); click('Котелок'); click('Мята'); click('Готовить');
        while(!fire.pot.done && ticks++<30000) { if(g.hud.isStoryOpen) document.querySelector('#storyOk').click(); g.update(1/60); }
        if(!fire.pot.done)throw Error('Pot stalled');
        g.openFire(obj); click('Котелок'); g.render();
        return {roast:g.inventory.count('meat_roast'),tea:g.inventory.count('herb_tea'),ticks,raw:g.inventory.count('meat_raw'),herb:g.inventory.count('herb_mint')};
    })()`);
    assert.equal(cooking.roast,1); assert.equal(cooking.tea,1); assert.equal(cooking.raw,0); assert.equal(cooking.herb,0);
    await screenshot('cooking-collected');
    const seasons=[];
    for(const [name,day,minute,weather] of [
        ['winter-night',85,21*60+22,'cloudy'], ['winter-noon',85,12*60,'clear'],
        ['winter-snow',85,12*60,'snow'], ['spring',1,12*60,'clear']
    ]) {
        const result=await evaluate(`(async()=>{
            const {waterIce}=await import('./js/world/water-state.js'); const g=GAME;
            g.hud.closePanel(true); g.hud.hideStory(); g.clock.day=${day}; g.clock.minute=${minute}; g.weather.current=${JSON.stringify(weather)};
            if(g.zone.id!=='shore')g.enterZone('shore',null,true);
            g.update(0); g.placeSafely(2180,965); g.camera.snapTo(2180,965); g.render();
            return {season:g.clock.season.key,temperature:g.zone.map.waterState.temperature,
                lake:waterIce(g.zone.map,2225,865),sea:waterIce(g.zone.map,2008,926),objects:g.zone.objects.length};
        })()`);
        seasons.push({name,...result}); await screenshot('season-'+name);
    }
    assert.equal(seasons[0].lake.walkable,true); assert.equal(seasons[1].lake.walkable,false);
    assert.equal(seasons[3].lake.cover,0); assert.ok(seasons.every(s=>s.objects===321 && !s.sea.walkable));
    assert.equal(errors.length,0);
    fs.writeFileSync(`${out}/notes-review.json`,JSON.stringify({seam,cooking,seasons,errors},null,2));
    console.log('PASS: native projected coverage and gutter review; DOM fire→spit→cook→collect and one-ingredient pot→cook→collect',JSON.stringify({seam,cooking,seasons}));
} finally {
    for (const p of pending.values()) clearTimeout(p.timer);
    for (const e of events.values()) clearTimeout(e.timer);
    ws.close();
}
