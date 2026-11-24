/** Note 020: temporal regressions, not just a nice still image. */
import { suite, test, assert, run } from "./tiny.js";
import { TerrainField } from "../js/world/terrain.js";
import { Player } from "../js/entities/player.js";
import { generateZone } from "../js/world/worldgen.js";
import { TileMap } from "../js/world/tilemap.js";
import { T } from "../js/world/tiles.js";
import { BODY, MOVE } from "../js/render/charspec.js";
import { posture, toolAttachment } from "../js/render/character.js";
import { Input } from "../js/engine/input.js";
import { ReliefWalker } from "../js/world/relief.js";
import { ReliefGuide } from "../js/dev/relief-guide.js";
const axes = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
function record(x, y, stamina = 100, fps = 120, legacyTerrain = false) {
    const zone = generateZone("ashfall", 1066618561), p = new Player({ x: 137, y: 861 }); p.stamina = stamina;
    // Stage 63 raises the home shelf; this old regression intentionally checks
    // the pre-rollout terrain so art changes cannot silently alter locomotion.
    if (legacyTerrain) zone.terrain.elevation = TerrainField.prototype.elevation;
    const axis = { x: x * Math.SQRT1_2, y: y * Math.SQRT1_2 }, frames = [];
    for (let i = 0; i < fps * 4; i++) {
        p.update(1 / fps, axis, zone, { wantRun: true, surfaceAt: (a, b) => ({ slope: zone.terrain.slope(a, b, x, y) }) });
        frames.push({ running: p.running, dir: p.dir, lean: posture(p).lean });
    }
    return { p, frames };
}
suite("diagonal motion at note 020");
for (const [x, y] of axes) test(`diagonal ${x},${y}: no exhaustion chatter or contact lean jumps`, () => {
    for (const stamina of [100, 6.05]) {
        const { frames } = record(x, y, stamina); let switches = 0, jump = 0;
        frames.forEach((f, i) => {
            assert.eq(f.dir, x > 0 ? "right" : "left");
            if (i && f.running !== frames[i - 1].running) switches++;
            if (i > 30) jump = Math.max(jump, Math.abs(f.lean - frames[i - 1].lean));
        });
        assert.lte(switches, 3); assert.lt(jump, 0.45);
    }
});
test("visual smoothing preserves all four pre-fix paths with a full stamina reserve", () => {
    const expected = [[393.55886492830064, 1112.0081936289366], [9.040813864490463, 1114.7045550587006], [447.12835362266566, 550.8716463773337], [52.78041069896668, 777.3332948191709]];
    axes.forEach(([x, y], i) => { const { p } = record(x, y, 100, 120, true); assert.near(p.x, expected[i][0], 1e-8); assert.near(p.y, expected[i][1], 1e-8); });
});
test("pushing a wall fades the gait and lean instead of holding a raised leg", () => {
    const map = new TileMap(12, 12, T.DIRT); map.fillRect(5, 0, 1, 12, T.CLIFF);
    const z = { map, isBlockedTile: () => false, propContact: () => null }, p = new Player({ x: 140, y: 150 });
    for (let i = 0; i < 360; i++) p.update(1 / 120, { x: 1, y: 0 }, z, { wantRun: true });
    assert.lt(p.x, 160 - p.radius); assert.lt(p.gait, 0.01); assert.lt(Math.abs(posture(p).lean), 0.01);
});
test("both planted ankles stay inside IK reach across directions and running phases", () => {
    const reach = BODY.thigh + BODY.shin - 0.08;
    for (const dir of ["left", "right", "up", "down"]) for (const runBlend of [0, 1]) for (const gait of [0, 0.5, 1]) {
        for (let phase = 0; phase < Math.PI * 2; phase += 0.02) {
            const p = posture({ dir, phase, gait, runBlend, idleTime: 1 });
            for (const [travel, lift] of [[p.sideView ? p.swingN + p.stance : 0, p.liftN], [p.sideView ? p.swingF - p.stance : 0, p.liftF]])
                assert.lte(Math.hypot(travel, BODY.ankleY - lift - (BODY.hipY - p.bob)), reach + 1e-8);
        }
    }
});
test("pose, filtered acceleration and right-hand light agree at 30/60/120 FPS", () => {
    const state = (fps) => {
        const { p } = record(1, 1, 6.05, fps);
        return [p.x, p.y, p.stamina, p.leanAX, p.leanAY, p.anim, p.gait, p.runBlend, toolAttachment({ ...p, idleTime: 4 }).x];
    };
    const a = state(30); for (const fps of [60, 120]) state(fps).forEach((v, i) => assert.near(v, a[i], 1e-8));
});
test("real keyboard chords retain both axes while only the last key auto-repeats", () => {
    for (const [vertical, horizontal, x, y] of [["KeyW", "KeyA", -1, -1], ["KeyW", "KeyD", 1, -1], ["KeyS", "KeyA", -1, 1], ["KeyS", "KeyD", 1, 1]]) {
        const listeners = {}, target = { addEventListener: (k, fn) => { listeners[k] = fn; }, removeEventListener() {}, document: { addEventListener() {} } };
        const input = new Input({ target }), key = (code, repeat = false) => listeners.keydown({ code, repeat, preventDefault() {} });
        key("ShiftLeft"); key(vertical); key(vertical, true); key(horizontal);
        for (let i = 0; i < 180; i++) {
            if (i % 3 === 0) key(horizontal, true);
            input.update(1 / 60);
            assert.near(input.axis().x, x * Math.SQRT1_2); assert.near(input.axis().y, y * Math.SQRT1_2);
            assert.ok(input.pressed("sprint"));
        }
        listeners.blur(); assert.deep(input.axis(), { x: 0, y: 0 });
    }
});
suite("guided relief acceptance");
test("autodemo walks every milestone, including a real blocked cliff, at three rates", () => {
    for (const fps of [30, 60, 120]) {
        const w = new ReliefWalker(), g = new ReliefGuide(), seen = []; g.demo = true;
        for (let i = 0; i < fps * 25 && !g.complete; i++) {
            const before = g.step; w.update(1 / fps, g.demoInput(w)); g.observe(w);
            if (g.step !== before) { seen.push(g.step); if (g.step === 4) assert.ok(w.blocked); }
        }
        assert.deep(seen, [1, 2, 3, 4, 5]); assert.ok(g.collected); assert.not(g.demo);
    }
});
test("debug teleport cannot complete the guided climb", () => {
    const w = new ReliefWalker().reset(true), g = new ReliefGuide(); g.reset(false);
    for (let i = 0; i < 30; i++) g.observe(w);
    assert.eq(g.step, 0); assert.not(g.complete);
});
test("restart clears previous progress, demo and collected item", () => {
    const g = new ReliefGuide(); g.step = 5; g.collected = g.demo = g.demonstrated = true;
    g.reset(); assert.eq(g.step, 0); assert.not(g.collected); assert.not(g.demo); assert.not(g.demonstrated); assert.ok(g.active);
});
test("guide pickup uses physical reach and does not collect twice", () => {
    const w = new ReliefWalker(), g = new ReliefGuide(); assert.not(g.collect(w));
    w.x = 464; w.y = 250; assert.ok(g.collect(w)); assert.not(g.collect(w));
});
test("lab UI boots, completes demo, resets, handles focus and pointer cancellation", async () => {
    const { installDOM, FakeElement } = await import("./dom-harness.js");
    const saved = Object.fromEntries(["document", "window", "requestAnimationFrame", "localStorage"].map((k) => [k, globalThis[k]]));
    try {
        const dom = installDOM(), canvas = new FakeElement("canvas"); canvas.width = 1000; canvas.height = 600;
        dom.elements.set("relief", canvas); const el = dom.doc.getElementById;
        canvas.focus = () => { dom.doc.activeElement = canvas; };
        el("checklist").append = (c) => el("checklist").appendChild(c);
        const touch = new FakeElement("button"); touch.dataset.move = "0,-1"; touch.setPointerCapture = () => {};
        dom.doc.querySelectorAll = () => [touch]; el("guides").checked = true;
        let next, now = 0; globalThis.requestAnimationFrame = (cb) => { next = cb; };
        await import("../js/dev/relief-lab.js");
        const frame = () => { now += 100; next(now); };
        frame(); assert.eq(el("counter").textContent, "0 / 5"); assert.ok(el("focus-tip").hidden);
        el("demo").onclick();
        for (let i = 0; i < 200 && el("counter").textContent !== "5 / 5"; i++) frame();
        assert.eq(el("counter").textContent, "5 / 5"); assert.ok(el("goal-title").textContent.includes("Готово"));
        el("top").onclick(); frame(); assert.eq(el("counter").textContent, "— / 5");
        el("bottom").onclick(); frame(); assert.eq(el("counter").textContent, "0 / 5");
        touch.dispatch("pointerdown", { pointerId: 1, preventDefault() {} });
        for (let i = 0; i < 8; i++) frame();
        touch.dispatch("pointercancel", { pointerId: 1 }); frame(); const z = el("height-value").textContent;
        for (let i = 0; i < 5; i++) frame(); assert.eq(el("height-value").textContent, z);
        dom.doc.activeElement = null; canvas.dispatch("blur"); frame(); assert.not(el("focus-tip").hidden);
        el("demo").onclick(); frame(); dom.win.dispatch("blur"); frame();
        assert.not(el("mode").textContent.includes("Автопоказ"));
        assert.eq(localStorage.getItem("minirpg_v3_save"), null);
    } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } }
});
await run("locomotion-guide");
