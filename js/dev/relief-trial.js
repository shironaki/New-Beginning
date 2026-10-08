/** Opt-in daytime gameplay pilot. Real Game/Player/inventory/fire systems;
 * separate in-memory save and one bounded height field, never a world rewrite. */
import { Game } from "../main.js";
import { MemoryStorage } from "../core/save.js";
import { TileMap } from "../world/tilemap.js";
import { T } from "../world/tiles.js";
import { Zone } from "../world/worldgen.js";
import { ReliefPatch, RELIEF, RELIEF_PROPS } from "../world/relief.js";
import { syncWaterState } from "../world/water-state.js";
import { toolAttachment } from "../render/character.js";
import { reliefAttachment, reliefView, reliefMesh, drawRelief } from "../render/relief.js";
import { itemDef } from "../sandbox/items.js";

export class ReliefTrialGame extends Game {
    get isTrial() { return true; }
    constructor(options) {
        super(options);
        this.relief = new ReliefPatch();
        this.mesh = reliefMesh(this.relief);
        const map = new TileMap(20, 14, T.GRASS);
        const zone = new Zone({ id: "relief_trial", name: "Рельеф · игровой участок", biome: "meadow", links: [] }, map);
        zone.objects = [...RELIEF_PROPS.map((o) => ({ ...o })),
            { kind: "campfire", x: 490, y: 180, tx: 15, ty: 5, block: 0 }];
        for (const o of zone.objects) if (o.block) zone.addSolid(o, o.block);
        zone.spawn = { x: 408, y: 410 };
        map.solidAt = (x, y) => x < 0 || y < 0 || x >= RELIEF.width || y >= RELIEF.height
            || Math.abs(this.relief.heightAt(x, y) - (this._standHeight ?? this.relief.heightAt(this.player.x, this.player.y))) > RELIEF.maxStep;
        map.speedAt = (x, y) => {
            const a = this.input.axis();
            const rise = (this.relief.heightAt(x + a.x * 4, y + a.y * 4) - this.relief.heightAt(x, y)) / 4;
            return Math.max(0.55, 1 - Math.max(0, rise) * 0.6);
        };
        this.world.zones.set(zone.id, zone);
        this.zone = zone; zone.relief = this.relief;
        this.fires.clear();
        this._prepareZone(zone);
        this.player.x = zone.spawn.x; this.player.y = zone.spawn.y;
        this.player.dir = "up";
        this.clock.day = 10; this.clock.minute = 11 * 60;
        this.weather.current = "clear"; this.weather.groundWet = 0;
        this.inventory.add("torch", 1);
        this.save.register("trial", () => this.zone.objects.map((o) => ({ removed: !!o.removed, hits: o.hits })), (data) => {
            if (!Array.isArray(data) || data.length !== this.zone.objects.length) throw new Error("Некорректный пилот");
            data.forEach((state, i) => {
                const o = this.zone.objects[i]; o.removed = !!state.removed;
                if (state.hits === undefined) delete o.hits; else o.hits = state.hits;
                this.zone.removeSolid(o); if (!o.removed && o.block) this.zone.addSolid(o, o.block);
            });
            this.trialCollected = this.zone.objects.some((o) => o.kind === "firewood" && o.removed);
        });
        this.camera.setBounds(RELIEF.width, RELIEF.height).snapTo(this.player.x, this.player.y);
        this.trialCollected = false;
        this.bus.on("world:harvest", ({ kind }) => { if (kind === "firewood") this.trialCollected = true; });
    }
    _setupSave() {
        super._setupSave();
        this.save.storage = new MemoryStorage();
        this.save.key = "relief_trial_session";
    }
    enterZone(id, ...args) {
        if (id !== "relief_trial") return this;
        return super.enterZone(id, ...args);
    }
    fitsAt(x, y, radius = this.player.radius) {
        if (!this.relief) return super.fitsAt(x, y, radius);
        // Spawn/load/diagnostic placement validates around the candidate's
        // height; ordinary movement still compares against the current foot.
        this._standHeight = this.relief.heightAt(x, y);
        try { return super.fitsAt(x, y, radius); }
        finally { this._standHeight = null; }
    }
    findInteractable() {
        if (!this.relief) return super.findInteractable();
        const fp = this.player.facingPoint(16);
        let best = null, distance = 30;
        for (const obj of this.zone.objects) {
            if (obj.removed || Math.abs(this.relief.heightAt(obj.x, obj.y) - this.relief.heightAt(this.player.x, this.player.y)) > RELIEF.maxStep) continue;
            const d = Math.hypot(obj.x - fp.x, obj.y - fp.y);
            if (d < distance) { best = obj; distance = d; }
        }
        return best;
    }
    fireWarmthNear(x, y) {
        // Do not transmit heat through the terrace face to the lower level.
        if (this.relief && Math.abs(this.relief.heightAt(x, y) - RELIEF.platform) > RELIEF.maxStep) return 0;
        return super.fireWarmthNear(x, y);
    }
    setConditions(kind) {
        this.clock.day = kind === "winter" ? 86 : 10;
        this.clock.minute = kind === "night" ? 22 * 60 : 11 * 60;
        this.weather.current = kind === "winter" ? "snow" : kind === "rain" ? "rain" : "clear";
        this.weather.groundWet = ["winter", "rain"].includes(kind) ? 1 : 0;
        this.clock._acc = 0; this._meshKey = null;
        this.hud.closePanel(); this.hud.hideStory();
    }
    openTrialConditions() {
        this.hud.openPanel("Рельеф · условия проверки", [
            ...[["day", "День"], ["night", "Ночь"], ["rain", "Дождь"], ["winter", "Зима и лёд"]].map(([key, label]) => ({ label, action: () => this.setConditions(key) })),
            { label: "Взять факел в правую руку", action: () => {
                const i = this.inventory.slots.findIndex((s) => s?.id === "torch");
                if (i >= 0) this.inventory.setActive(i);
                this.hud.closePanel();
            } }
        ], "trial-conditions");
    }
    start() {
        this.hud.hideStory();
        this.hud.toast("Поднимитесь по склону, соберите хворост, разожгите костёр наверху.", "⛰️");
        this.loop.start();
        return this;
    }
    update(dt) {
        super.update(dt);
        const lit = [...this.localFires.values()].some((f) => f.lit);
        this.hud.els.objective.textContent = lit
            ? "✓ Хворост и костёр проверены. Спуститесь и попробуйте пройти через отвесный край."
            : this.trialCollected ? "🎯 Подойдите к костру наверху: хворост → разжечь."
                : "🎯 Поднимитесь по светлому склону и подберите хворост наверху.";
    }
    render(dt = 1 / 60) {
        const p = this.player, active = this.inventory.active, def = active && itemDef(active.id);
        const tool = def && (def.tool || def.tags.includes("light"))
            ? { id: active.id, tool: def.tool || "torch" } : null;
        const renderer = this.renderer, canvas = renderer.canvas, clock = this.clock;
        renderer.time = this.elapsed;
        const water = syncWaterState(this.zone, clock, this.weather.current);
        const key = `${clock.season.key}:${Math.round(this.weather.groundWet * 8)}:${water.temperature <= 0}`;
        if (key !== this._meshKey) {
            this.mesh = reliefMesh(this.relief, { season: clock.season.key, wet: this.weather.groundWet,
                zone: this.zone, freezing: clock.season.key === "winter" && water.temperature <= 0 });
            this._meshKey = key;
        }
        const dpr = canvas.width / (parseFloat(canvas.style?.width) || canvas.width);
        const view = reliefView(canvas.width, canvas.height, this.relief.project(p.x, p.y), canvas.width / dpr < 700 ? 1.6 * dpr : 0);
        const lights = renderer.lightMap; lights.begin();
        const add = (actor, offset, radius, intensity, flicker = 1) => {
            const point = reliefAttachment(this.relief, actor, offset);
            lights.add(view.x + point.x * view.zoom, view.y + point.y * view.zoom, radius * view.zoom,
                { intensity, warmth: 0.88, flicker, glow: flicker === 0 ? 0.45 : 1 });
        };
        for (const o of this.zone.objects) if (o.kind === "campfire" && !o.removed) {
            const f = this.fires.get(this.fireKey(this.zone, o));
            if (f?.lit) add(o, { x: 0, y: -9 }, f.lightRadius, f.intensity);
        }
        const character = { ...p, phase: p.anim, tool, idleTime: this.elapsed, look: this.look,
            torchWind: Math.cos(this.weather.windAngle) * (this.windStrength || 0) };
        if (def?.light) {
            const flame = toolAttachment(character); add(p, flame, def.light, flame.intensity, 0);
        }
        drawRelief(this.renderer.ctx, this.relief, { ...p, phase: p.anim, time: this.elapsed }, {
            mesh: this.mesh, guides: false, objects: this.zone.objects.filter((o) => !o.removed),
            character, view, hour: clock.minute / 60, daylight: clock.daylight,
            season: clock.season.key, tracks: this.tracks, fires: this.localFires
        });
        renderer.drawWeather(this.weather.current, dt, this.weather.windAngle);
        lights.render(renderer.ctx, { hour: clock.minute / 60, daylight: clock.daylight, weather: this.weather.current,
            time: this.elapsed, day: clock.day, torch: !!def?.light });
        renderer.grade(clock, this.weather.current);
        if (this.trialStatus) {
            const lit = [...this.localFires.values()].some((f) => f.lit);
            this.trialStatus.textContent = `${this.trialCollected ? "✓" : "○"} Хворост → ${lit ? "✓" : "○"} Костёр · высота ${this.relief.heightAt(p.x, p.y).toFixed(0)} · ${this.interact ? this.interactLabel(this.interact) : "подойти к предмету"}`;
        }
    }
}
