/** Notes 021–024: exhaustion, ice bodies, falls and opt-in gameplay relief. */
import { test, assert, run } from "./tiny.js";
import { installDOM } from "./dom-harness.js";
import { Player } from "../js/entities/player.js";
import { ATTACH, fallPose } from "../js/render/charspec.js";
import { posture, toolAttachment } from "../js/render/character.js";
import { TileMap } from "../js/world/tilemap.js";
import { T } from "../js/world/tiles.js";
import { generateZone } from "../js/world/worldgen.js";
import { waterIce, syncWaterState } from "../js/world/water-state.js";
import { frozenPuddleAt, surfacePuddle, ICE } from "../js/world/surface.js";
import { GameClock } from "../js/core/time.js";
const dom = installDOM();
const { Game } = await import("../js/main.js");
const { ReliefTrialGame } = await import("../js/dev/relief-trial.js");
const boot = (Type = Game) => new Type({ canvas: dom.doc.getElementById("game"), hudRoot: dom.doc.getElementById("hud"), seed: 1066618561 });
const tick = (p, t, options = {}, axis = { x: Math.SQRT1_2, y: Math.SQRT1_2 }) => {
    for (let i = 0; i < t * 120; i++) p.update(1 / 120, axis, null, options);
};
for (const stamina of [6.05, 100]) test(`holding Shift never restarts an exhausted sprint (${stamina})`, () => {
    const p = new Player(); p.stamina = stamina;
    tick(p, 10, { wantRun: true });
    assert.ok(p.sprintLocked); assert.not(p.running);
    tick(p, 20, { wantRun: true });
    assert.not(p.running); assert.eq(p.stamina, 100);
    tick(p, 1 / 120, { wantRun: false }); tick(p, 1 / 120, { wantRun: true });
    assert.ok(p.running);
});
test("fall suppression is not mistaken for physical Shift release", () => {
    const p = new Player(); p.sprintLocked = true; p.fallTimer = 1; p.stamina = 80;
    tick(p, 0.5, { wantRun: true }); assert.ok(p.sprintLocked);
});
test("fall curve starts and ends upright without a pose jump", () => {
    const start = fallPose({ fallTimer: ATTACH.fallTime }), end = fallPose({ fallTimer: 0.000001 });
    assert.near(start.angle, 0); assert.near(end.angle, 0, 1e-8);
    assert.gt(fallPose({ fallTimer: 0.9 }).amount, 0.99);
    let last = start, max = 0;
    for (let t = ATTACH.fallTime; t > 0; t -= 1 / 120) {
        const p = fallPose({ fallTimer: t }); max = Math.max(max, Math.abs(last.angle - p.angle)); last = p;
    }
    assert.lt(max, 0.06);
});
test("fall turns with momentum and torch/body share the same transform", () => {
    assert.lt(fallPose({ fallTimer: 0.9, fallDirX: -1 }).angle, 0);
    assert.gt(fallPose({ fallTimer: 0.9, fallDirX: 1 }).angle, 0);
    for (const dir of ["left", "right", "up", "down"]) for (let t = 0.01; t <= ATTACH.fallTime; t += 0.07) {
        const a = toolAttachment({ dir, fallTimer: t, gait: 1, runBlend: 1, tool: "torch" });
        assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
    }
});
test("falling coasts without advancing the walking cycle", () => {
    const p = new Player(); p.fallTimer = 1.6; p.mvx = 100; p.anim = 0.4;
    tick(p, 0.5, { surfaceAt: () => ({ ice: true }) });
    assert.gt(p.x, 25); assert.near(p.anim, 0.4); assert.gt(p.mvx, 30);
});
test("fall velocity survives saving; old saves do not retain stale fall state", () => {
    const p = new Player(); p.fallTimer = 1; p.mvx = 85; p.mvy = -10; p.iceCarry = 0.2;
    const copy = new Player().load(p.toJSON());
    assert.near(copy.mvx, 85); assert.near(copy.mvy, -10); assert.near(copy.iceCarry, 0.2);
    copy.load({ x: 4, y: 5 }); assert.eq(copy.fallTimer, 0); assert.eq(copy.mvx, 0);
});
test("ice braking persists briefly beyond a small patch", () => {
    const p = new Player(); p.mvx = 100;
    tick(p, 0.1, { surfaceAt: () => ({ ice: true }) }, { x: 0, y: 0 });
    const before = p.mvx;
    tick(p, 0.05, { surfaceAt: () => ({ ice: false }) }, { x: 0, y: 0 });
    assert.gt(p.mvx / before, 0.9); assert.gt(p.iceCarry, 0);
});
test("larger puddles have matching collision beyond their origin tile", () => {
    const z = generateZone("ashfall", 1066618561); let found = false;
    for (let y = 4; y < z.h - 4 && !found; y++) for (let x = 4; x < z.w - 4 && !found; x++) {
        const p = surfacePuddle(z, x, y, 1); if (!p || p.rx < 20) continue;
        for (const sign of [-1, 1]) {
            const xx = p.x + p.rx * 0.7 * sign;
            if (Math.floor(xx / 32) === x) continue;
            assert.ok(frozenPuddleAt(z, xx, p.y, "winter", 1));
            assert.not(frozenPuddleAt(z, xx, p.y, "winter", 1, 2)); found = true;
        }
    }
    assert.ok(found);
});
test("broad puddle edges do not extend under a tent roof", () => {
    const z = generateZone("ashfall", 1066618561); let p = null, tx = 0, ty = 0;
    for (let y = 4; y < z.h - 4 && !p; y++) for (let x = 4; x < z.w - 4 && !p; x++) {
        const candidate = surfacePuddle(z, x, y, 1);
        if (candidate?.rx > 20) { p = candidate; tx = x; ty = y; }
    }
    assert.ok(p);
    z.objects.push({ kind: "tent", x: p.x + p.rx + 20, y: p.y });
    assert.eq(surfacePuddle(z, tx, ty, 1), null);
});
const winter = (daylight = 0) => ({ season: { key: "winter" }, daylight });
function lake() {
    const map = new TileMap(10, 10, T.GRASS);
    map.set(4, 4, T.DEEP); map.set(0, 8, T.DEEP); map.set(1, 8, T.WATER);
    return { map, def: { biome: "shore" } };
}
test("isolated lakes freeze; boundary-connected sea remains non-load-bearing", () => {
    const z = lake(); syncWaterState(z, winter(), "snow");
    assert.ok(waterIce(z.map, 144, 144).walkable); assert.not(z.map.solidAt(144, 144));
    const sea = waterIce(z.map, 16, 272);
    assert.ok(sea.marine); assert.gt(sea.cover, 0); assert.not(sea.walkable); assert.ok(z.map.solidAt(16, 272));
    assert.eq(z.map.speedAt(144, 144), 1);
});
test("daylight, weather and season change ice without changing raw tiles", () => {
    const z = lake(), data = Array.from(z.map.data);
    syncWaterState(z, winter(), "snow"); const cold = z.map.waterState.fresh;
    syncWaterState(z, winter(1), "clear"); assert.lt(z.map.waterState.fresh, cold); assert.ok(z.map.solidAt(144, 144));
    syncWaterState(z, winter(1), "snow"); assert.gt(z.map.waterState.fresh, 0);
    syncWaterState(z, { season: { key: "spring" }, daylight: 0 }, "snow");
    assert.eq(z.map.waterState.fresh, 0); assert.deep(Array.from(z.map.data), data);
});
test("same temperature bin does not dirty chunks each frame; a thaw does", () => {
    const z = lake(); syncWaterState(z, winter(), "cloudy"); z.map.dirtyChunks.clear();
    syncWaterState(z, winter(), "cloudy"); assert.eq(z.map.dirtyChunks.size, 0);
    syncWaterState(z, winter(1), "clear"); assert.gt(z.map.dirtyChunks.size, 0);
});
test("editing connectivity rebuilds the marine classification", () => {
    const z = lake(); syncWaterState(z, winter(), "snow");
    for (let x = 0; x <= 4; x++) z.map.set(x, 4, T.DEEP);
    syncWaterState(z, winter(), "snow");
    assert.ok(waterIce(z.map, 144, 144).marine); assert.ok(z.map.solidAt(144, 144));
});
test("cave pools never freeze", () => {
    const z = lake(); z.def.underground = true;
    syncWaterState(z, winter(), "snow"); assert.eq(z.map.waterState.fresh, 0);
});
test("note 022 lake freezes; every raw marine DEEP cell stays blocked; resources unchanged", () => {
    const z = generateZone("shore", 1066618561), props = JSON.stringify(z.objects), data = Array.from(z.map.data);
    syncWaterState(z, new GameClock({ day: 85, minute: 21 * 60 + 22 }), "cloudy");
    assert.ok(waterIce(z.map, 2225, 865).walkable);
    const g = boot();
    assert.not(g.renderer._inWater(z, 2225, 865));
    syncWaterState(z, winter(1), "clear"); assert.ok(g.renderer._inWater(z, 2225, 865));
    syncWaterState(z, new GameClock({ day: 85, minute: 21 * 60 + 22 }), "cloudy");
    const state = z.map.waterState; let count = 0;
    for (let i = 0; i < state.marine.length; i++) if (state.marine[i] && data[i] === T.DEEP) {
        const x = (i % z.w) * 32 + 16, y = Math.floor(i / z.w) * 32 + 16;
        if (z.map.at(x, y) === T.DEEP) { assert.ok(z.map.solidAt(x, y)); count++; }
    }
    assert.gt(count, 1000); assert.eq(JSON.stringify(z.objects), props); assert.deep(Array.from(z.map.data), data);
});
test("HUD shows stamina separately from sleep fatigue without control tutorials", () => {
    const g = boot(); g.player.stamina = 8; g.player.sprintLocked = true; g.needs.fatigue = 10;
    g.update(1 / 60);
    assert.lt(Number(g.hud.needRows.stamina.getAttribute("aria-valuenow")), 10);
    assert.gt(Number(g.hud.needRows.fatigue.getAttribute("aria-valuenow")), 80);
    g.player.sprintLocked = true;
    g.hud.update({ needs: g.needs, player: g.player, clock: g.clock, weather: g.weather, inventory: g.inventory });
    assert.not(g.hud.els.staminaHint);
    assert.not(g.hud.root.innerHTML.includes("staminaHint"));
});
test("real Player climbs relief ramp and cannot cross terrace face", () => {
    const g = boot(ReliefTrialGame); g.input.setStick(0, -1);
    for (let i = 0; i < 180; i++) g.update(1 / 60);
    assert.eq(g.relief.heightAt(g.player.x, g.player.y), 44);
    assert.ok(g.hud.els.objective.textContent.includes("склону"));
    assert.ok(g.fitsAt(466, 260));
    g.player.x = 300; g.player.y = 310; g.player.mvx = g.player.mvy = 0;
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    assert.gt(g.player.y, 280); assert.eq(g.relief.heightAt(g.player.x, g.player.y), 0);
    g.render();
});
test("pilot blocks reaching across a height difference", () => {
    const g = boot(ReliefTrialGame), wood = g.zone.objects.find((o) => o.kind === "firewood");
    wood.x = 300; wood.y = 275; g.player.x = 300; g.player.y = 292; g.player.faceX = 0; g.player.faceY = -1;
    assert.not(g.findInteractable());
});
test("pilot wood uses real inventory and real campfire", () => {
    const g = boot(ReliefTrialGame), wood = g.zone.objects.find((o) => o.kind === "firewood");
    g.player.x = wood.x; g.player.y = wood.y + 16; g.player.faceX = 0; g.player.faceY = -1;
    g.interact = g.findInteractable(); assert.eq(g.interact, wood); g.doInteract();
    assert.ok(g.inventory.has("firewood")); assert.ok(wood.removed); assert.ok(g.trialCollected);
    const fire = [...g.localFires.values()][0];
    fire.addFuel("firewood"); g.inventory.remove("firewood", 1); assert.ok(fire.light({ hasFlint: g.inventory.has("flint") }));
    g.render();
});
test("pilot manual/autosave cannot overwrite main storage", () => {
    const g = boot(ReliefTrialGame), main = boot();
    assert.not(g.save.storage === main.save.storage);
    const old = main.save.storage.getItem(main.save.key);
    g.save.write(); g.bus.emit("time:newday", {});
    assert.eq(main.save.storage.getItem(main.save.key), old);
    assert.ok(g.save.has()); g.enterZone("shore"); assert.eq(g.zone.id, "relief_trial");
});
test("021/023 dry-ground four-diagonal body oscillation stays bounded", () => {
    const zone = generateZone("ashfall", 1066618561);
    for (const [x, y, stamina] of [[792, 1079, 100], [824, 965, 6.05]]) {
        for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
            const p = new Player({ x, y }); p.stamina = stamina; let last = null;
            for (let n = 0; n < 480; n++) {
                p.update(1 / 120, { x: dx, y: dy }, zone, { wantRun: true });
                const pose = posture(p);
                if (last !== null) assert.lt(Math.abs(pose.bob - last), 0.13);
                last = pose.bob;
            }
        }
    }
});
test("fallen knees are bent and the vertical momentum selects the fall side", () => {
    const pose = posture({ fallTimer: 0.8, dir: "right" });
    assert.gt(pose.liftN, 3); assert.gt(pose.liftF, 1);
    assert.lt(fallPose({ fallTimer: 0.8, fallDirY: -1 }).angle, 0);
    assert.gt(fallPose({ fallTimer: 0.8, fallDirY: 1 }).angle, 0);
});
await run("winter-trial");
