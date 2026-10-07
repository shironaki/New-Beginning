/** Opt-in daytime gameplay pilot. Real Game/Player/inventory/fire systems;
 * separate in-memory save and one bounded height field, never a world rewrite. */
import { Game } from "../main.js";
import { MemoryStorage } from "../core/save.js";
import { TileMap } from "../world/tilemap.js";
import { T } from "../world/tiles.js";
import { Zone } from "../world/worldgen.js";
import { ReliefPatch, RELIEF, RELIEF_PROPS } from "../world/relief.js";
import { reliefMesh, drawRelief } from "../render/relief.js";
import { itemDef } from "../sandbox/items.js";

export class ReliefTrialGame extends Game {
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
        this.zone = zone;
        this._prepareZone(zone);
        this.player.x = zone.spawn.x; this.player.y = zone.spawn.y;
        this.player.dir = "up";
        this.clock.day = 10; this.clock.minute = 11 * 60;
        // This first pilot deliberately tests daytime height/interaction, not
        // seasonal relief textures, weather or the main light-map projection.
        this.clock.update = () => 0;
        this.weather.current = "clear"; this.weather.groundWet = 0;
        this.weather.update = () => 0;
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
    start() {
        this.hud.hideStory();
        this.hud.toast("Поднимитесь по склону, соберите хворост [E], разожгите костёр наверху.", "⛰️");
        this.loop.start();
        return this;
    }
    update(dt) {
        super.update(dt);
        const lit = [...this.localFires.values()].some((f) => f.lit);
        this.hud.els.objective.textContent = lit
            ? "✓ Хворост и костёр проверены. Спуститесь и попробуйте пройти через отвесный край."
            : this.trialCollected ? "🎯 Подойдите к костру наверху: E → хворост → разжечь."
                : "🎯 Поднимитесь по светлому склону и подберите хворост наверху [E].";
    }
    render(dt = 1 / 60) {
        const p = this.player, active = this.inventory.active, def = active && itemDef(active.id);
        const tool = def && (def.tool || def.tags.includes("light"))
            ? { id: active.id, tool: def.tool || "torch" } : null;
        drawRelief(this.renderer.ctx, this.relief, { ...p, phase: p.anim, time: this.elapsed }, {
            mesh: this.mesh, guides: false, objects: this.zone.objects.filter((o) => !o.removed),
            character: { ...p, phase: p.anim, tool, idleTime: this.elapsed, look: this.look },
            fires: this.localFires
        });
        if (this.trialStatus) {
            const lit = [...this.localFires.values()].some((f) => f.lit);
            this.trialStatus.textContent = `${this.trialCollected ? "✓" : "○"} Хворост → ${lit ? "✓" : "○"} Костёр · высота ${this.relief.heightAt(p.x, p.y).toFixed(0)} · E: ${this.interact ? this.interactLabel(this.interact) : "подойти к предмету"}`;
        }
    }
}
