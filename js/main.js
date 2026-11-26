import { normalizeLook, openAppearance } from "./ui/appearance.js";
import { handCapacity } from "./sandbox/carry.js";
import { startMeal, tickHands, handRender, useHand, openBag, startPickup, openCraft } from "./ui/hands.js";
import { canReceive, startPotFromInventory } from "./survival/cooking-actions.js";
/**
 * «Новое начало». Bootstrap and orchestration.
 *
 * This file wires systems together and owns the player's *intent* (what E does
 * right now). All rules live in their own modules; nothing here should grow
 * into a thousand-line God file.
 */
import { syncWaterState, waterIce } from "./world/water-state.js";
import { EventBus } from "./core/events.js";
import { GameClock } from "./core/time.js";
import { GameLoop } from "./core/loop.js";
import { RNG, hashSeed } from "./core/rng.js";
import { snapshotWorld, restoreWorld } from "./world/persistence.js";
import { installSession, sessionTick, openSessionMenu, bindSessionLifecycle } from "./ui/session.js";
import { conditionRows } from "./survival/condition.js";
import { bindTouch } from "./ui/touch.js";
import { SaveManager } from "./core/save.js";
import { Input } from "./engine/input.js";
import { Camera } from "./engine/camera.js";
import { WorldMap } from "./world/worldgen.js";
import { WeatherSystem } from "./world/weather.js";
import { surfaceTile, SURFACE, frozenPuddleAt } from "./world/surface.js";
import { UI } from "./ui/uispec.js";
import { installViewport } from "./ui/viewport.js";
import { START_ZONE, biomeDef, oppositeEdge, zoneDef } from "./world/regions.js";
import { T, TILE_SIZE, tileInfo } from "./world/tiles.js";
import { bodyBlocked } from "./world/tilemap.js";
import { Player } from "./entities/player.js";
import { Inventory } from "./sandbox/inventory.js";
import { itemDef, itemEmoji, itemName, foodValue } from "./sandbox/items.js";
import { propDef, rollDrops, requiredTool, toolHint } from "./sandbox/gather.js";
import { Needs } from "./survival/needs.js";
import { DebrisField, shardFan, unsupportedBy } from "./world/debris.js";
import { loadStyle, saveStyle, styleKey } from "./ui/styleflags.js";
import { ambientTemperature } from "./survival/temperature.js";
import { Campfire } from "./survival/campfire.js";
import { CookingJournal, isCookable } from "./survival/cooking.js";
import { Renderer } from "./render/renderer.js";
import { Particles, FX, MATERIAL, materialOf } from "./render/particles.js";
import { Tracks, TRACK } from "./render/tracks.js";
import { propHeight, BEND } from "./render/tilesart.js";
import { StoryEngine } from "./story/acts.js";
import { HUD, fireRows } from "./ui/hud.js";

/**
 * How hard it blows, by weather. One number feeds everything the wind
 * touches: smoke, rain slant, the sway of the trees and the lean of the
 * grass — so a gust looks like one gust and not four unrelated animations.
 */
/** Anything with a crown a gust can strip. */
const TREE_KINDS = new Set(["pine", "spruce", "oak", "birch", "willow", "palm", "ancient_oak"]);

export const WIND_BY_WEATHER = {
    clear: 0.35, cloudy: 0.5, fog: 0.15, rain: 0.7, snow: 0.45, wind: 1.1, storm: 1.4
};

/** Dust takes the ground's own mid tone, so sand puffs pale and loam dark. */
function dustColor(def) {
    const hex = (def.colors && def.colors[1]) || "#b0a38c";
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((n >> 16) & 255) + 18);
    const g = Math.min(255, ((n >> 8) & 255) + 16);
    const b = Math.min(255, (n & 255) + 14);
    return `rgba(${r},${g},${b},0.5)`;
}

export class Game {
    get isTrial() { return false; }
    constructor({ canvas, hudRoot, seed = Date.now() & 0xffff } = {}) {
        this.bus = new EventBus();
        this.seed = typeof seed === "string" ? hashSeed(seed) : seed;
        this.rng = new RNG(this.seed);

        this.clock = new GameClock({ bus: this.bus, minute: 16 * 60 + 40, day: 1 });
        this.weather = new WeatherSystem({ bus: this.bus, seed: this.seed, clock: this.clock });
        this.world = new WorldMap(this.seed);
        this.needs = new Needs({ bus: this.bus, difficulty: "normal" });
        this.inventory = new Inventory({ bus: this.bus });
        this.cookJournal = new CookingJournal({ bus: this.bus });
        this.particles = new Particles();
        // Тела, у которых есть последствия: поваленное бревно, осыпь, кусок
        // стены. Секунды жизни, в сейв не пишутся — world/debris.js.
        this.debris = new DebrisField();
        this.tracks = new Tracks();
        this.fires = new Map();          // `${zoneId}:${tx},${ty}` -> Campfire
        this.look = normalizeLook();

        this.zone = this.world.get(START_ZONE);
        this.player = new Player({ x: this.zone.spawn.x, y: this.zone.spawn.y, bus: this.bus });

        this.camera = new Camera({ width: canvas.width, height: canvas.height,
                                  zoom: UI.baseZoom * (canvas.width > 1700 ? 2 : 1) });
        this.camera.followReducedMotion();
        this.camera.surface = this.zone.playableRelief || null;
        this.camera.setBounds(this.zone.map.widthPx, this.zone.map.heightPx);
        this.camera.snapTo(this.player.x, this.player.y);

        this.renderer = new Renderer(canvas, this.camera);
        this.input = new Input({ target: window });
        this.hud = new HUD(hudRoot, {
            onHand: (side) => useHand(this, side),
            onBag: () => { if (this.sessionReady !== false) this.openBackpack(); },
            onCondition: () => this.openCondition(),
            onAction: () => {}
        });
        this.story = new StoryEngine({ bus: this.bus, game: this });

        this.sleepTarget = null;
        this.paused = false;
        this.interact = null;
        this.elapsed = 0;

        this._startingKit();
        this._prepareZone(this.zone);
        this._bindEvents();
        this._bindTouch(canvas);
        this._setupSave();

        this.loop = new GameLoop({
            update: (dt) => this.update(dt),
            render: (_alpha, dt) => this.render(dt)
        });
        installSession(this);
    }

    /* ===================== setup ===================== */

    _startingKit() {
        // Everything the prologue gives you: a knife, flint, and almost nothing else.
        this.inventory.add("knife", 1);
        this.inventory.add("flint", 1);
        this.inventory.add("berry", 3);
        this.inventory.setActive(0);
        this.inventory.enableHands();
    }

    /** Instantiate live objects (campfires) for a freshly entered zone. */
    _prepareZone(zone) {
        for (const obj of zone.objects) {
            if (obj.kind !== "campfire") continue;
            const key = this.fireKey(zone, obj);
            if (!this.fires.has(key)) {
                const fire = new Campfire({ bus: this.bus });
                if (obj.fuel) fire.addFuel("firewood");
                this.fires.set(key, fire);
            }
        }
    }

    fireKey(zone, obj) { return `${zone.id}:${obj.tx},${obj.ty}`; }

    /** Fires in the current zone, keyed the way the renderer expects. */
    get localFires() {
        const out = new Map();
        for (const obj of this.zone.objects) {
            if (obj.kind !== "campfire" || obj.removed) continue;
            const f = this.fires.get(this.fireKey(this.zone, obj));
            if (f) out.set(`${obj.tx},${obj.ty}`, f);
        }
        return out;
    }

    _bindEvents() {
        const bus = this.bus;
        this.storyNotices = [];
        this.nextStory = () => {
            if (this.inventory.handAction || this.hud.isStoryOpen || this.hud.isPanelOpen || !this.storyNotices.length) return;
            this.hud.showStory(this.storyNotices.shift());
        };
        bus.on("story:step", (s) => { this.storyNotices.push(s); this.nextStory(); });
        bus.on("save:restored", () => { this.storyNotices.length = 0; this.story.recover(); });
        bus.on("needs:warn", ({ text, icon }) => this.hud.toast(text, icon));
        bus.on("cook:discovered", ({ name, emoji }) => this.hud.toast(`Новое блюдо: ${name}`, emoji));
        bus.on("fire:lit", () => {
            this.hud.toast("Костёр разгорелся", "🔥");
            this.particles.sparks(this.lastFireObj ? this.lastFireObj.x : this.player.x,
                                  this.lastFireObj ? this.lastFireObj.y : this.player.y, 14);
        });
        bus.on("fire:out", ({ reason }) => this.hud.toast(reason === "rain" ? "Дождь залил угли. Добавь сухое топливо и разожги снова" : "Костёр погас", "💨"));
        bus.on("weather:change", ({ info }) => this.hud.toast(`${info.emoji} ${info.name}`));
        bus.on("player:collapse", () => this.onCollapse());
        bus.on("player:slipped", () => this.hud.toast("Поскользнулся! По льду лучше идти шагом", "🧊"));
        this.hud.onAction = () => { this.paused = false; this.nextStory(); };
    }

    _bindTouch(canvas) {
        this.touch = bindTouch(this, canvas);
    }

    _setupSave() {
        this.save = new SaveManager({ bus: this.bus });
        this.save.register("seed", () => this.seed, (seed) => {
            if (!Number.isInteger(seed)) throw new Error("Некорректный сид");
            this.seed = seed; this.rng = new RNG(seed); this.weather.seed = seed;
            if (!this.isTrial) { this.world = new WorldMap(seed); this.fires.clear(); }
        });
        if (!this.isTrial) this.save.register("world", () => snapshotWorld(this.world), (data) => {
            this.world = restoreWorld(this.seed, data);
            for (const z of this.world.zones.values()) this._prepareZone(z);
        });
        this.save.register("rng", () => this.rng.state, (state) => {
            if (!Number.isInteger(state)) throw new Error("Некорректное состояние генератора");
            this.rng.state = state >>> 0;
        });
        this.save.register("clock", () => this.clock.toJSON(), (d) => this.clock.load(d));
        this.save.register("needs", () => this.needs.toJSON(), (d) => this.needs.load(d));
        this.save.register("inv", () => this.inventory.toJSON(), (d) => this.inventory.load(d));
        this.save.register("look", () => ({ ...this.look }), (d) => { this.look = normalizeLook(d); });
        this.save.register("weather", () => this.weather.toJSON(), (d) => this.weather.load(d));
        this.save.register("player", () => ({ zone: this.zone.id, p: this.player.toJSON() }),
            (d) => {
                if ((!this.isTrial && !zoneDef(d.zone)) || !Number.isFinite(d.p?.x) || !Number.isFinite(d.p?.y))
                    throw new Error("Некорректная позиция героя");
                if (d.zone) this.enterZone(d.zone, null, true);
                this.player.load(d.p);
                syncWaterState(this.zone, this.clock, this.weather.current);
                if (!this.placeSafely(this.player.x, this.player.y)) this.placeSafely(this.zone.spawn.x, this.zone.spawn.y);
            });
        this.save.register("story", () => this.story.toJSON(), (d) => this.story.load(d));
        this.save.register("cook", () => this.cookJournal.toJSON(), (d) => this.cookJournal.load(d));
        this.save.register("fires", () => {
            const out = {};
            for (const [k, f] of this.fires) out[k] = f.toJSON();
            return out;
        }, (d) => {
            this.fires.clear();
            for (const [k, data] of Object.entries(d || {})) {
                const id = k.split(":")[0];
                if (!this.isTrial && !zoneDef(id)) throw new Error("Неизвестная локация костра");
                const f = this.fires.get(k) || new Campfire({ bus: this.bus });
                f.load(data);
                this.fires.set(k, f);
            }
        });
        // Save after the whole minute has simulated, not midway through a
        // clock event (before fuel/needs have advanced).
        this.bus.on("time:newday", () => { this._saveDue = true; });
        this.save.validate = ({ parts }) => {
            if (!parts.player || !parts.clock || !parts.inv || !parts.needs || !Number.isInteger(parts.seed)) throw new Error("Неполное сохранение игры");
            const c = parts.clock;
            if (!Number.isInteger(c.day) || c.day < 1 || !Number.isFinite(c.minute) || c.minute < 0 || c.minute >= 1440)
                throw new Error("Некорректные часы");
            if (c.scale !== undefined && (!Number.isFinite(c.scale) || c.scale < 0 || c.scale > 100)) throw new Error("Некорректный масштаб времени");
            const p = parts.player.p;
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.stamina) || p.stamina < 0 || p.stamina > 100
                || !["left", "right", "up", "down"].includes(p.dir)) throw new Error("Некорректный герой");
            const inv = parts.inv;
            if (!Array.isArray(inv.slots) || !Number.isInteger(inv.size) || inv.size < 1 || inv.size > 100 || inv.slots.length > inv.size
                || !Number.isInteger(inv.activeSlot) || inv.activeSlot < 0 || inv.activeSlot >= inv.size)
                throw new Error("Некорректный рюкзак");
            for (const slot of inv.slots) if (slot && (!itemDef(slot.id) || !Number.isInteger(slot.n) || slot.n < 1 || slot.n > itemDef(slot.id).stack))
                throw new Error("Некорректный предмет в рюкзаке");
            if (inv.hands) {
                if (!["left", "right"].includes(inv.dominant)) throw Error("Некорректная ведущая рука");
                for (const side of ["left", "right"]) {
                    const h = inv.hands[side];
                    if (h && (!itemDef(h.id) || !Number.isInteger(h.n) || h.n < 1 || h.n > handCapacity(h.id))) throw Error("Некорректный предмет в руке");
                }
                const a = inv.handAction;
                if (a && a.type === "eat" && (a.type !== "eat" || !["left", "right"].includes(a.side) || !foodValue(a.id)
                    || inv.hands[a.side]?.id !== a.id || !Number.isFinite(a.remaining) || a.remaining < 0 || a.remaining > .9
                    || (a.previous && !itemDef(a.previous))
                    || (a.previousN !== undefined && (!Number.isInteger(a.previousN) || a.previousN < 1 || a.previousN > handCapacity(a.previous))))) throw Error("Некорректное действие рук");
            }
            const action = inv.handAction;
            if (action && !["eat", "pickup"].includes(action.type)) throw Error("Неизвестное действие рук");
            if (action?.type === "pickup" && (!inv.hands || !["left","right"].includes(action.side)
                || !itemDef(action.id) || !Number.isInteger(action.n) || action.n < 1 || action.n > handCapacity(action.id)
                || !Number.isInteger(action.index) || action.index < 0 || (!this.isTrial && !zoneDef(action.zone))
                || !Number.isFinite(action.remaining) || action.remaining < 0 || action.remaining > .6)) throw Error("Некорректный подбор");
            for (const key of ["food", "warmth", "health", "fatigue", "spirit"]) if (parts.needs &&
                (!Number.isFinite(parts.needs[key]) || parts.needs[key] < 0 || parts.needs[key] > 100)) throw new Error("Некорректные нужды");
        };
    }

    /* ===================== world ===================== */

    /**
     * Is there room for the player's body at this spot? Mirrors the probe
     * pattern of `moveAndCollide`, so "free" here means "can actually move".
     */
    fitsAt(x, y, radius = this.player.radius) {
        const zone = this.zone;
        return (!zone.playableRelief || zone.playableRelief.canStand(x,y,radius)) && !bodyBlocked(
            (wx, wy) => zone.map.solidAt(wx, wy) ||
                        zone.isBlockedTile(Math.floor(wx / TILE_SIZE), Math.floor(wy / TILE_SIZE)),
            x, y, radius,
            (px, py, r) => zone.propBlocksBody(px, py, r));
    }

    /**
     * Put the player at (x, y), or at the nearest spot where their body
     * actually fits. Standing inside a solid prop used to wedge the hero
     * permanently — every teleport (sleep, collapse, zone change) goes
     * through here now.
     */
    placeSafely(x, y) {
        if (this.fitsAt(x, y)) { this.player.x = x; this.player.y = y; return true; }
        const step = this.player.radius;      // nudge out, do not fling across the field
        for (let ring = 1; ring <= 12; ring++) {
            // Prefer straight below the target (in front of a tent, say),
            // then the other directions, then the diagonals.
            const offsets = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
            for (const [ox, oy] of offsets) {
                const nx = x + ox * ring * step, ny = y + oy * ring * step;
                if (this.fitsAt(nx, ny)) { this.player.x = nx; this.player.y = ny; return true; }
            }
        }
        this.player.x = x; this.player.y = y;
        return false;
    }

    enterZone(zoneId, fromEdge = null, silent = false) {
        const zone = this.world.get(zoneId);
        this.zone = zone;
        this.tracks.clear();        // prints belong to the ground we left
        this._prepareZone(zone);
        this.camera.surface = zone.playableRelief || null;
        this.camera.setBounds(zone.map.widthPx, zone.map.heightPx);
        if (fromEdge) {
            const edge = oppositeEdge(fromEdge);
            const link = (zone.def.links || []).find((l) => l.edge === edge);
            if (link) {
                const mid = Math.floor((link.from + link.to) / 2);
                if (edge === "north") this.placeSafely(mid * TILE_SIZE, 3.5 * TILE_SIZE);
                else if (edge === "south") this.placeSafely(mid * TILE_SIZE, (zone.h - 4) * TILE_SIZE);
                else if (edge === "west") this.placeSafely(3.5 * TILE_SIZE, mid * TILE_SIZE);
                else this.placeSafely((zone.w - 4) * TILE_SIZE, mid * TILE_SIZE);
            } else {
                this.placeSafely(zone.spawn.x, zone.spawn.y);
            }
        }
        this.camera.snapTo(this.player.x, this.player.y);
        this.renderer.invalidate();
        if (!silent) {
            this.hud.toast(zone.def.name, "🧭");
            this.bus.emit("zone:enter", { zone: zone.id, name: zone.def.name });
        }
        return this;
    }

    get ambient() {
        const biome = biomeDef(this.zone.def.biome);
        return ambientTemperature({
            season: this.clock.season.key,
            daylight: this.clock.daylight,
            weather: this.weather.current,
            biomeTemp: biome.temp || 0,
            underground: !!this.zone.def.underground
        });
    }

    /** Warmth contributed by nearby lit fires. */
    fireWarmthNear(x, y) {
        let best = 0;
        for (const obj of this.zone.objects) {
            if (obj.kind !== "campfire" || obj.removed) continue;
            const f = this.fires.get(this.fireKey(this.zone, obj));
            if (!f || !f.lit) continue;
            const d = Math.hypot(obj.x - x, obj.y - y);
            if (d < 90) best = Math.max(best, f.warmth * (1 - d / 90));
        }
        return best;
    }

    fireEnvironment(zone, obj) {
        const sheltered = !!zone.def.underground || !!obj?.sheltered;
        return { weather: this.weather.current, season: this.clock.season.key, sheltered };
    }

    /** Is the player under a roof (tent, later: a house)? */
    shelteredAt(x, y) {
        for (const obj of this.zone.objects) {
            if (obj.kind !== "tent" || obj.removed) continue;
            if (Math.hypot(obj.x - x, obj.y - y) < 34) return true;
        }
        return false;
    }

    /* ===================== interaction ===================== */

    findInteractable() {
        const fp = this.player.facingPoint(16);
        let best = null, bestD = 30;
        for (const obj of this.zone.objects) {
            if (obj.removed || (this.zone.playableRelief && !this.zone.playableRelief.canReach(this.player, obj))) continue;
            const def = propDef(obj.kind);
            if (!def) continue;
            if (!def.interact && !Array.isArray(def.drops)) continue;
            const d = Math.hypot(obj.x - fp.x, obj.y - fp.y);
            if (d < bestD) { bestD = d; best = obj; }
        }
        return best;
    }

    interactLabel(obj) {
        if (!obj) return null;
        const def = propDef(obj.kind);
        if (!def) return null;
        if (obj.loot?.length) return "Подобрать добычу";
        if (def.interact === "fire") {
            const f = this.fires.get(this.fireKey(this.zone, obj));
            return f && f.lit ? "Костёр" : "Разжечь костёр";
        }
        if (def.interact === "sleep") return "Спать";
        if (def.interact === "read") return "Прочитать";
        if (def.interact === "story") return "Осмотреть";
        if (def.interact === "loot") return obj.looted ? "Пусто" : "Обыскать";
        const tool = requiredTool(obj.kind);
        const have = tool ? this.inventory.findTool(tool) : true;
        if (!have) return toolHint(obj.kind);
        return def.name;
    }

    doInteract() {
        const obj = this.interact;
        if (!obj || obj.removed || this.inventory.handAction) return;
        const def = propDef(obj.kind);
        if (!def) return;

        if (obj.loot?.length) return startPickup(this, obj);
        if (def.interact === "fire") return this.openFire(obj);
        if (def.interact === "sleep") return this.sleep(obj);
        if (obj.kind === "hearth_ruin") return this.inspectHearth(obj);
        if (def.interact === "read" || def.interact === "story") {
            if (def.interact === "read") {
                obj.loot = [{ id: "diary_burnt", n: 1 }];
                startPickup(this, obj); return;
            }
            if (obj.story) this.story.setFlag(obj.story);
            this.particles.emote(obj.x, obj.y - 20, "❓");
            return;
        }
        if (def.interact === "loot") return this.lootChest(obj);
        return this.harvest(obj);
    }

    harvest(obj) {
        if (obj.loot?.length) return startPickup(this, obj);
        if (obj.removed) return;
        const def = propDef(obj.kind);
        const tool = requiredTool(obj.kind);
        if (tool && !this.inventory.findTool(tool)) {
            this.hud.toast(toolHint(obj.kind, { how: true }), "✋");
            return;
        }
        if (this.inventory.handAction) return;
        if (tool) {
            const found = this.inventory.findTool(tool);
            if (!found.hand && !this.inventory.equipHand(this.inventory.dominant, found.index)) {
                this.hud.toast("Нужно освободить руку для инструмента", "✋"); return;
            }
            this.player.actionHand = found.hand || this.inventory.dominant;
        }
        if (!tool) this.player.actionHand = this.inventory.dominant;
        // Вид замаха — это не косметика: топор врубается в ствол по дуге рубки,
        // кирка бьёт вниз по камню, а куст собирают рукой. actionKind читает
        // спрайтовый герой (js/render/hero3d.js), чтобы анимация совпала с глаголом.
        this.player.swing(tool === "axe" ? "chop" : tool ? "mine" : "gather");
        if (obj.hits === undefined) obj.hits = def.hits || 1;
        obj.hits -= 1 + (tool ? (this.inventory.findTool(tool).tier - 1) * 0.5 : 0);

        // What flies off depends on what the thing is made of, and the camera
        // feels every blow — a hit with no weight behind it reads as a miss.
        const mat = materialOf(obj.kind);
        this.particles.chips(obj.x, obj.y - 10, mat.chip, mat.chips);
        if (mat.leaf) this.particles.leaves(obj.x, obj.y - 14, mat.leaf, 3);
        this.camera.shake(FX.shake.hit, FX.shake.hitTime);
        this.needs.fatigue = Math.min(100, this.needs.fatigue + 0.35);

        if (obj.hits > 0) return;

        const drops = rollDrops(obj, this.rng);
        obj.loot = drops.map(d => ({ ...d }));
        // Felling something tall: a ring of dust, a drift of leaves and a
        // thud in the camera, scaled by how big the thing was.
        const tall = propHeight(obj.kind, obj.size || 1);
        if (tall >= 20) {
            const heft = Math.min(1.4, tall / 40);
            this.particles.impact(obj.x, obj.y + 2, Math.round(8 + heft * 8));
            if (mat.leaf || def.shade) this.particles.leaves(obj.x, obj.y - tall * 0.5,
                                                            mat.leaf || "#7fa24f", Math.round(6 + heft * 8));
            this.camera.shake(FX.shake.fell * heft, FX.shake.fellTime);
        }
        // Развал. Куда падать, решает рельеф: ствол валится под уклон, а если
        // площадка ровная — от героя наружу (он стоял со той стороны, с которой
        // бил). Осколки идут веером по той же оси и ложатся там, где упали.
        this.breakIntoDebris(obj, def, tall);
        obj.depleted = true;
        this.collapseSupports(obj);               // то, что стояло на этом пропаде, падает
        this.zone.removeSolid(obj);              // its footprint goes with it
        this.bus.emit("world:harvest", { kind: obj.kind, drops });
        startPickup(this, obj);
    }

    /**
     * Уклон в точке, как направление «вниз по склону» в экранных координатах.
     * Берётся из того же playableRelief, по которому renderer сортирует кадр и
     * по которому герой съезжает с горы: второй модели рельефа здесь не нужно.
     * На ровном месте возвращает null — тогда направление задаёт удар.
     */
    downhillAt(x, y) {
        const relief = this.zone?.playableRelief;
        if (!relief || !relief.heightAt) return null;
        const e = 10;
        const gx = relief.heightAt(x + e, y) - relief.heightAt(x - e, y);
        const gy = relief.heightAt(x, y + e) - relief.heightAt(x, y - e);
        const len = Math.hypot(gx, gy);
        if (len < 0.5) return null;                      // площадка, не склон
        return { x: -gx / len, y: -gy / len, steep: Math.min(1, len / (2 * e)) };
    }

    /**
     * Проп рассыпается на тела. `tall` — высота в пикселях: она задаёт, откуда
     * летят куски (сверху ствола) и насколько они тяжёлые.
     */
    breakIntoDebris(obj, def, tall, opts = {}) {
        if (!this.debris) return 0;
        const drops = (def.drops || []).map((d) => d[0]);
        // Камень рассыпается в осыпь — это то, ради чего физика вообще что-то
        // меняет в мире: у разбитого валуна остаётся то, что можно подобрать
        // руками. Дерево не оставляет ничего: лежачего бревна в PROPS нет, а
        // «бревно-проп» без kind либо не имел бы коллизии, либо стал бы
        // бесконечным источником брёвен. Дырка в каталоге, а не в физике.
        const stone = drops.includes("stone");
        const wood = drops.includes("log") || drops.includes("plank") || drops.includes("hay");
        const slope = this.downhillAt(obj.x, obj.y);
        // Направление падения: склон важнее удара — так дерево, поваленное на
        // косогоре, честно уходит вниз, а не висит над обрывом.
        let dx, dy;
        if (slope) { dx = slope.x; dy = slope.y; }
        else {
            // Удар: от героя прочь. Иначе поваленное дерево каждый раз падает
            // тому на ноги, кто его валит, а это не физика, а наказание.
            const ax = obj.x - this.player.x, ay = (obj.y - this.player.y) * 0.6;
            const al = Math.hypot(ax, ay) || 1;
            dx = ax / al; dy = ay / al;
        }
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const mass = Math.max(0.4, Math.min(4, tall / 30));
        const shards = shardFan([], obj.x, obj.y - tall * 0.62, {
            // Кусков немного, но каждый — крупный: четыре щепки от сосны читаются
            // как конфетти, два полена — как распад ствола.
            count: wood ? 3 : 3,
            dir: Math.atan2(dy, dx),
            spread: slope ? 0.5 : 0.9,
            power: 90 + mass * 55,
            lift: 70 + tall * 1.4,
            scale: Math.max(0.5, Math.min(1.15, tall / 46)),
            mass,
            kind: wood ? "log" : "scree",
            becomes: stone && obj.kind !== "beach_pebbles" ? "scree" : null,
            hit: tall >= 34 && wood ? { radius: 30, damage: 5 + mass * 4 } : null,
            rng: this.rng
        });
        for (const s of shards) this.debris.spawn(s.x, s.y, s);
        this.bus.emit("world:collapse", { kind: obj.kind, x: obj.x, y: obj.y, shards: shards.length });
        return shards.length;
    }

    /**
     * Опора ушла — деталь падает. Крыша на месте снесённой стены была главным
     * «летающим объектом» во дворе, поэтому правило живёт здесь, а не в
     * раскладке: оно работает и для загрузки из сейва, и для любой постройки,
     * которую игрок разберёт сам. `on` проставляет worldgen.
     */
    collapseSupports(obj) {
        if (!this.zone || !obj) return 0;
        // Правило «что именно падает» живёт в world/debris.js рядом с физикой
        // осколков — там же, где оно покрывается тестом без игрового цикла.
        const doomed = unsupportedBy(this.zone.objects, obj);
        for (const o of doomed) {
            o.lift = 0;
            o.fallen = true;
            const def = propDef(o.kind);
            const tall = propHeight(o.kind, o.size || 1);
            this.particles.impact(o.x, o.y + 2, Math.round(6 + tall / 8));
            this.camera.shake(FX.shake.fell * 0.7, FX.shake.fellTime);
            if (def) this.breakIntoDebris(o, def, tall);
        }
        if (doomed.length) this.bus.emit("world:support-lost", { kind: obj.kind, dropped: doomed.length });
        return doomed.length;
    }

    /**
     * Тело легло: тяжёлое остаётся в мире пропом, лёгкое поднимает пыль и
     * исчезает. Отдельный метод — потому что «что оставляет после себя обломок»
     * это правило мира, а не физики.
     */
    settleDebris(body) {
        const kind = body.becomes;
        body.becomes = null;
        this.particles.dust(body.x, body.y, 3, "rgba(150,138,116,0.7)");
        if (!kind || !this.zone) return;
        const tx = Math.floor(body.x / TILE_SIZE), ty = Math.floor(body.y / TILE_SIZE);
        if (this.zone.objects.some((o) => !o.removed && o.tx === tx && o.ty === ty)) return;
        const def = propDef(kind);
        const obj = { kind, tx, ty, x: body.x, y: body.y, variant: 0, fallen: true, lift: 0 };
        this.zone.objects.push(obj);
        if (def && def.block) this.zone.addSolid(obj, Math.max(6, def.block * 0.6));
        this.bus.emit("world:debris-rested", { kind, x: body.x, y: body.y });
    }

    /**
     * Шаг физики. На паузе (панель, сон, фон вкладки) тела не падают: иначе
     * открытая сумка превращает спил дерева в «бревно прилетело, пока ты
     * выбирал верёвку», и это было бы уже не игра, а лотерея.
     */
    stepDebris(dt, paused = false) {
        if (paused || !this.debris || this.debris.count === 0) return;
        const map = this.zone && this.zone.map;
        this.debris.step(dt, {
            relief: this.zone && this.zone.playableRelief ? this.zone.playableRelief : null,
            isWater: map ? (x, y) => tileInfo(map.at(x, y)).liquid : null,
            player: this.player,
            splash: (x, y) => this.particles.chips(x, y, "rgba(196,222,238,0.85)", 6),
            onHitPlayer: (body, dmg) => {
                const took = this.needs.hurt(dmg, "debris");
                if (took <= 0) return;
                this.particles.emote(this.player.x, this.player.y - 26, "💢");
                this.hud.toast(`Тебя задел обломок (−${Math.round(took)})`, "🪵");
                this.camera.shake(FX.shake.hit, FX.shake.hitTime);
            },
            onRest: (body) => this.settleDebris(body)
        });
    }

    lootChest(obj) {
        if (obj.looted) return;
        obj.looted = true;
        const table = [["coin", 3], ["flint", 2], ["fiber", 3], ["charcoal", 2], ["old_key", 1]];
        const id = this.rng.weighted(table) || "fiber";
        const n = id === "coin" ? this.rng.int(3, 12) : this.rng.int(1, 3);
        obj.loot = [{ id, n }]; startPickup(this, obj);
    }

    /* ---- the campfire panel ---- */

    openFire(obj) {
        const key = this.fireKey(this.zone, obj);
        let fire = this.fires.get(key);
        if (!fire) { fire = new Campfire({ bus: this.bus }); this.fires.set(key, fire); }
        this.lastFireObj = obj;
        fire.setExposure(this.fireEnvironment(this.zone, obj));
        const refresh = () => this.openFire(obj);
        this.hud.openPanel("Костёр", fireRows(fire, this.inventory, {
            canCook: (id) => isCookable(id),
            installPot: () => {
                if (!fire.hasPot && !this.inventory.handAction && this.inventory.remove("pot", 1)) fire.installPot();
                refresh();
            },
            addFuel: (id) => {
                if (this.inventory.has(id) && fire.addFuel(id) && this.inventory.remove(id, 1)) {
                    this.particles.sparks(obj.x, obj.y - 6, 5);
                }
                refresh();
            },
            light: () => {
                const ok = fire.light({ hasFlint: this.inventory.has("flint") });
                if (!ok) this.hud.toast(fire.lastFailure || "Нужен кремень и топливо", "🪨");
                refresh();
            },
            resume: () => this.hud.closePanel(),
            putOnSpit: (id) => {
                if (!this.inventory.has(id) || !isCookable(id) || !fire.lit) return;
                if (fire.putOnSpit(id) >= 0) this.inventory.remove(id, 1);
                else this.hud.toast("Вертел занят", "🍢");
                refresh();
            },
            takeFromSpit: (i) => {
                const slot = fire.spit[i];
                if (!slot) return;
                if (!canReceive(this.inventory, slot.ready ? slot.result : slot.itemId)) {
                    this.hud.toast("Рюкзак полон — еда остаётся на вертеле", "🎒"); return;
                }
                const got = fire.takeFromSpit(i);
                if (got) {
                    this.inventory.add(got.id, 1);
                    if (got.state === "done") {
                        this.cookJournal.discover(got.id);
                        this.particles.text(obj.x, obj.y - 24, `${itemEmoji(got.id)} готово!`, { color: "#ffd27a" });
                    } else if (got.state === "burnt") {
                        this.hud.toast("Сгорело дотла", "🪨");
                    }
                }
                refresh();
            },
            openPot: () => this.openPot(fire, refresh)
        }), "fire");
    }

    openPot(fire, back, chosen = [], water = true) {
        if (fire.pot?.done) {
            if (!canReceive(this.inventory, fire.pot.result)) {
                this.hud.toast("Рюкзак полон — блюдо остаётся в котелке", "🎒"); return back();
            }
            const id = fire.takePot();
            this.inventory.add(id, 1);
            this.cookJournal.discover(id);
            this.hud.toast(`Готово: ${itemName(id)}`, itemEmoji(id));
            return back();
        }
        if (fire.pot) {
            this.hud.openPanel("Котелок", [
                { html: `Варится · ${Math.min(100, Math.round(fire.pot.progress / fire.pot.time * 100))}%` },
                { label: "Оставить готовиться", action: () => this.hud.closePanel() },
                { label: "К костру", action: back }
            ], "pot");
            return;
        }
        const refresh = () => this.openPot(fire, back, chosen, water);
        const ids = [...new Set(this.inventory.list().map((s) => s.id))].filter((id) => {
            const d = itemDef(id);
            return d && (d.tags.includes("food") || d.tags.includes("herb"));
        });
        const rows = [{ html: `<b>В котелке: ${chosen.length}/3</b><br>${chosen.map(itemName).join(", ") || "Пусто"}` }];
        for (const id of ids) {
            const left = this.inventory.count(id) - chosen.filter((x) => x === id).length;
            rows.push({ icon: itemEmoji(id), label: itemName(id), hint: `осталось ×${left}`,
                disabled: chosen.length >= 3 || left <= 0,
                action: () => { if (chosen.length < 3 && left > 0) chosen.push(id); refresh(); } });
        }
        rows.push({ label: water ? "Вода: добавлена" : "Без воды", action: () => { water = !water; refresh(); } },
            { label: "Очистить выбор", disabled: !chosen.length, action: () => { chosen.length = 0; refresh(); } },
            { label: "Готовить", disabled: !chosen.length || !fire.lit, action: () => {
                if (!fire.lit || !startPotFromInventory(fire, this.inventory, chosen, { water })) {
                    this.hud.toast("Не получилось — продукты не потрачены", "🫕"); refresh(); return;
                }
                this.hud.closePanel();
            } },
            { label: "К костру", action: back });
        this.hud.openPanel("Котелок", rows, "pot");
    }

    /* ---- backpack ---- */

    openCondition() {
        if (this.sessionReady === false) return;
        this.input.releaseAll(); this.touch?.reset();
        this.hud.setNeedsExpanded(false);
        this.hud.openPanel("Состояние · что влияет сейчас", conditionRows(this), "condition");
    }

    openBackpack() { openBag(this); }

    /** Панель ремесла — «B» на клавиатуре и вкладка в рюкзаке на телефоне. */
    openCraft() { openCraft(this); }

    /**
     * Горящий костёр в пределах вытянутой руки. Нужен не для красоты: у
     * pot and torch recipes the fire is the tool, и «разожечь потом» здесь
     * не работает — смолу и медь греют сейчас.
     */
    nearLitFire() {
        for (const o of this.zone.objects) {
            if (o.kind !== "campfire" || o.removed) continue;
            const dx = o.x - this.player.x, dy = (o.y - this.player.y) * 1.4;
            if (dx * dx + dy * dy > 58 * 58) continue;
            const fire = this.fires.get(this.fireKey(this.zone, o));
            if (fire && fire.lit) return { obj: o, fire };
        }
        return null;
    }

    /**
     * Поставить построенный объект перед героем. Возвращает null, а не бросает:
     * материалы уже списаны, и решение (вернуть или нет) принимает вызывающий.
     * Тайл проверяется руками того же `fitsAt`, что и герой, — иначе шалаш
     * встал бы в воду, а столик из камней остался бы невредим.
     */
    buildProp(kind) {
        const def = propDef(kind);
        if (!def) return null;
        const at = this.player.facingPoint(22);
        const tx = Math.floor(at.x / TILE_SIZE), ty = Math.floor(at.y / TILE_SIZE);
        // Единственный вопрос «свободна ли клетка» в мире уже есть, и он знает
        // про воду, обрывы и границы карты. Свои две проверки сюда добавляться
        // не должны: они неминуемо отстают от isFree.
        if (!this.zone.isFree(tx, ty)) return null;
        if (this.zone.objects.some((o) => !o.removed && o.tx === tx && o.ty === ty && propDef(o.kind)?.interact))
            return null;      // два костра в одной яме — это один костёр с двумя панелями
        const obj = { kind, tx, ty, x: at.x, y: at.y, built: true };
        this.zone.objects.push(obj);
        if (def.block) this.zone.addSolid(obj, def.block);
        if (def.interact === "fire") this.fires.set(this.fireKey(this.zone, obj), new Campfire({ bus: this.bus }));
        this.bus.emit("world:built", { kind, tx, ty });
        return obj;
    }

    /**
     * Сменить стиль из меню, а не из адресной строки. Применяется сразу, без
     * перезагрузки: hero3d и props3d — обычные модули с выключателями, а
     * инвалидация чанков заодно чистит кэш кадров под новый свет/тон.
     */
    async setStyle(patch) {
        this.style = { ...this.style || {}, ...patch };
        saveStyle(this.style);
        const props3d = await import("./render/props3d.js");
        props3d.PROPS3D.enabled = this.style.props3d !== "off";
        props3d.setPropTone(this.style.props3dTone || null);
        if (this.style.hero3d !== undefined) {
            const hero3d = await import("./render/hero3d.js");
            hero3d.HERO3D.enabled = this.style.hero3d !== "off";
            // Любой режим, включая «grade», goes through hero3dQuality: иначе
            // возвращение с гладкого листа обратно на грейд молча оставляло
            // игрока на гладком (источник переключает только сама функция).
            if (this.style.hero3d !== "off") {
                const ok = await hero3d.hero3dQuality(this.style.hero3d);
                if (!ok) this.hud.toast(`${hero3d.HERO3D.error || "режим недоступен"} — играет ${hero3d.HERO3D.quality}`, "⚠️");
            }
        }
        this.renderer.invalidate();
        this.hud.toast(`Стиль: ${styleKey(this.style)}`, "🎨");
        return this.style;
    }

    eat(id) { return startMeal(this, id); }

    readDiary() {
        this.hud.openPanel("Обгоревший дневник", [{ html: "<b>Свой почерк</b><br>Последняя запись сделана за день до пожара и обрывается на половине слова: «на гряде снова видели…»" }], "diary");
    }

    inspectHearth(obj) {
        const rows = [{ html: this.story.hasFlag("home_pot_taken") ? "Сажа, зола и остывший кирпич. Посуду ты уже забрал." : "В остывшей печи сохранилась закопчённая посуда." }];
        if (!this.story.hasFlag("home_pot_taken")) rows.push({ icon: "🫕", label: "Забрать котелок", action: () => {
            if (this.story.hasFlag("home_pot_taken")) return;
            obj.loot ||= [{ id: "pot", n: 1 }];
            if (startPickup(this, obj)) this.hud.closePanel();
        } });
        this.hud.openPanel("Обгоревшая печь", rows, "hearth");
        this.story.setFlag("home_hearth");
    }

    openJournal() {
        const rows = [{ html: `<b>Акт ${this.story.act}</b> · ${this.story.objective}` }];
        if (this.story.hasFlag("own_diary")) rows.push({ icon: "📔", label: "Обгоревший дневник · прочитать", action: () => this.readDiary() });
        for (const e of this.story.entries.slice().reverse()) {
            rows.push({ html: `<b>${e.title}</b><br><small>${e.text}</small>` });
        }
        if (this.cookJournal.count) {
            rows.push({ html: `<b>Поварская тетрадь</b><br><small>${this.cookJournal.list().map(itemName).join(", ")}</small>` });
        }
        this.hud.openPanel("Дневник", rows, "journal");
    }

    /* ---- sleeping ---- */

    sleep(tentObj) {
        if (this.inventory.handAction) return;
        if (this.clock.hour > 4 && this.clock.hour < 18) {
            this.hud.toast("Спать посреди дня — роскошь", "😐");
            return;
        }
        this.player.sleeping = true;
        this.sleepTarget = tentObj;
        // Lie down on the bedroll in the mouth of the tent…
        this.player.x = tentObj.x;
        this.player.y = tentObj.y + 6;
        this.hud.toast("Ты засыпаешь…", "😴");
        let guard = 0;
        // Fast-forward to morning, still simulating fires and needs.
        while (guard++ < 2000) {
            this.clock.advanceMinutes(10);
            this.simulateMinutes(10, true);
            if (this.clock.hour >= 6 && this.clock.hour < 12) break;
        }
        this.player.sleeping = false;
        // …and step out of it on waking, never inside the solid tent tile.
        this.placeSafely(tentObj.x, tentObj.y + TILE_SIZE);
        this.sleepTarget = null;
        this.bus.emit("player:slept", { day: this.clock.day });
        this.hud.toast(`Утро. День ${this.clock.day}`, "🌅");
    }

    onCollapse() {
        // Средняя жёсткость: смерть не конец — ты приходишь в себя в лагере.
        this.hud.toast("Ты потерял сознание…", "💀");
        const tent = this.zone.objects.find((o) => o.kind === "tent" && !o.removed);
        if (tent) this.placeSafely(tent.x, tent.y + TILE_SIZE);
        // Lose a slice of what you carried.
        for (const s of this.inventory.list()) {
            if (itemDef(s.id) && itemDef(s.id).tool) continue;
            this.inventory.remove(s.id, Math.ceil(s.n / 2));
        }
        this.clock.advanceMinutes(60 * 8);
        this.needs.revive();
        this.bus.emit("story:step", {
            title: "Ты очнулся",
            text: "Ты пришёл в себя у палатки — продрогший, с пустым животом и половиной " +
                  "того, что нёс. Долина не прощает беспечности, но и не добивает.",
            next: this.story.objective
        });
    }

    /* ===================== loop ===================== */

    needsContext(sleeping = false) {
        return { ambient: this.ambient, fireWarmth: this.fireWarmthNear(this.player.x, this.player.y),
            insulation: this.inventory.has("cloak") ? 6 : 0,
            sheltered: sleeping || this.shelteredAt(this.player.x, this.player.y), sleeping,
            activity: sleeping ? .3 : this.player.activity(), company: false };
    }

    /** Advance world systems by `minutes` in-game minutes. */
    simulateMinutes(minutes, sleeping = false) {
        this.weather.updateSurface(minutes);
        const seconds = minutes * 60;
        for (const [key, fire] of this.fires) {
            const zone = this.world.get(key.split(":")[0]);
            const obj = zone.objects.find((o) => this.fireKey(zone, o) === key);
            fire.update(seconds, this.fireEnvironment(zone, obj));
        }
        this.needs.update(minutes, this.needsContext(sleeping));
        if (this.weather.isWet && !sleeping && !this.shelteredAt(this.player.x, this.player.y)) {
            this.needs.wet = Math.min(1, this.needs.wet + 0.004 * minutes);
        }
    }

    update(dt) {
        this.elapsed += dt;
        this.nextStory?.();
        const worldPaused = this.paused || this.backgrounded || this.sessionReady === false || this.hud.panelPauses;
        if (!worldPaused) tickHands(this, dt);
        const uiBlocking = worldPaused || this.hud.isPanelOpen || this.hud.isStoryOpen;

        // Clock & derived systems.
        const minutes = worldPaused ? 0 : this.clock.update(dt);
        if (minutes > 0) this.simulateMinutes(minutes);

        // Input → movement. The sanity pass runs first: a key whose `keyup`
        // never arrived (focus lost to a click outside the frame) is dropped
        // here instead of walking the hero away on its own.
        this.input.update(dt);
        if (uiBlocking) { this.input.releaseAll(); if (!this.player.fallTimer) this.player.mvx = this.player.mvy = 0; }
        syncWaterState(this.zone, this.clock, this.weather.current);
        const axis = uiBlocking || this.inventory.handAction ? { x: 0, y: 0 } : this.input.axis();
        if (!worldPaused) this.player.update(dt, axis, this.zone, {
            speedFactor: this.needs.speedFactor(),
            wantRun: !uiBlocking && (this.input.pressed("sprint") || (this.input.stick.active && Math.hypot(axis.x, axis.y) > 0.95)),
            surfaceAt: (x, y) => ({
                ice: frozenPuddleAt(this.zone, x, y, this.clock.season.key, this.weather.groundWet, this.ambient)
                    || waterIce(this.zone.map, x, y).walkable
                    || (this.zone.map.at(x, y) === T.WATER && waterIce(this.zone.map, x, y).cover >= 0.55),
                slope: this.zone.terrain?.slope(x, y, axis.x, axis.y) || 1
            })
        });
        // Safety net: if anything ever leaves the hero inside a solid thing
        // (a prop built on top of them, a bad teleport), walk them out instead
        // of letting the game wedge.
        if (!this.player.sleeping && !this.fitsAt(this.player.x, this.player.y)) {
            if (!this.placeSafely(this.player.x, this.player.y)) {
                this.placeSafely(this.zone.spawn.x, this.zone.spawn.y);
                this.hud.toast("Поверхность стала непроходимой — возвращение на безопасную землю.", "⚠️");
            }
        }

        this.stepDebris(dt, worldPaused);

        // A foot planted: kick up dust the colour of the ground it landed on.
        // Driven by the leg phase, so the puff is always under the boot.
        if (this.player.stepEvent) {
            this.player.stepEvent = false;
            this.bus.emit("player:footstep", { side: this.player.stepSide });
            const info = this.zone.map.at(this.player.x, this.player.y);
            const def = tileInfo(info);
            if (def.liquid && waterIce(this.zone.map, this.player.x, this.player.y, info).cover < 0.55) {
                // Wading: the boot throws water, not dust.
                this.particles.splash(this.player.x + this.player.stepSide * 2.5, this.player.y + 1,
                                      this.player.running ? 1.25 : 0.85);
                this.player.wet = TRACK.wetLife;
            } else if (!frozenPuddleAt(this.zone, this.player.x, this.player.y, this.clock.season.key, this.weather.groundWet, this.ambient)
                && waterIce(this.zone.map, this.player.x, this.player.y, info).cover < 0.55) {
                // Soft ground keeps the boot: sand, snow, mud, ash. Soaked
                // boots print on hard ground too, until they dry out.
                // The foot line IS player.y — the print belongs there, not
                // two pixels further down the screen.
                const outside = !this.zone.def.underground && !this.shelteredAt(this.player.x, this.player.y);
                const wet = outside ? this.weather.groundWet : 0;
                const season = this.clock.season.key;
                const ground = surfaceTile(info, season, wet, !outside);
                const snowy = outside && season === "winter";
                if (wet > SURFACE.wetBootsAt) this.player.wet = TRACK.wetLife;
                this.tracks.add(this.player.x, this.player.y,
                                this.player.faceX, this.player.faceY,
                                this.player.stepSide, ground, !snowy && this.player.wet > 0);
                if (wet > SURFACE.wetBootsAt) {
                    this.particles.splash(this.player.x + this.player.stepSide * 2.5, this.player.y + 1, 0.3);
                } else {
                    this.particles.dust(this.player.x + this.player.stepSide * 2.5, this.player.y + 1,
                        this.player.running ? FX.dust.run : FX.dust.walk, dustColor(tileInfo(ground)));
                }
            }
        }

        // Brushing through the undergrowth: the plants bend (renderer side)
        // and give up a leaf or two. Throttled, and only while moving.
        this._rustleAt = (this._rustleAt || 0) - dt;
        if (this.player.moving && !this.player.sleeping && this._rustleAt <= 0) {
            this._rustleAt = FX.rustle.every;
            const R = BEND.radius;
            for (const o of this.zone.objects) {
                if (!BEND.kinds[o.kind]) continue;
                const dx = o.x - this.player.x, dy = (o.y - this.player.y) * 1.4;
                if (dx * dx + dy * dy > R * R) continue;
                this.particles.leaves(o.x, o.y - FX.rustle.up, MATERIAL.plant.leaf, FX.rustle.leaves);
                break;                                   // one plant per tick is plenty
            }
        }

        // The same three controls as the visible hand bar, not hidden bag slots.
        if (!uiBlocking) {
            if (this.input.justPressed("slot1")) useHand(this, "left");
            if (this.input.justPressed("slot2")) useHand(this, "right");
            if (this.input.justPressed("slot3")) this.openBackpack();
        }
        if (this.input.justPressed("inventory")) {
            this.hud.isPanelOpen ? this.hud.closePanel() : this.openBackpack();
        }
        if (this.input.justPressed("build")) {
            this.hud.isPanelOpen ? this.hud.closePanel() : this.openCraft();
        }
        if (this.input.justPressed("journal")) {
            this.hud.isPanelOpen ? this.hud.closePanel() : this.openJournal();
        }
        if (this.input.justPressed("cancel")) {
            if (this.hud.isStoryOpen) this.hud.hideStory();
            else if (this.hud.isPanelOpen) this.hud.closePanel();
            else openSessionMenu(this);
        }

        // Interaction.
        this.interact = uiBlocking ? null : this.findInteractable();
        if (!uiBlocking && this.player.fallTimer <= 0 && this.input.justPressed("action")) this.doInteract();
        else if (uiBlocking && this.input.justPressed("action") && this.hud.isStoryOpen) this.hud.hideStory();

        // Zone travel.
        if (!uiBlocking) {
            const portal = this.zone.portalAt(this.player.x, this.player.y);
            if (portal) this.enterZone(portal.target, portal.edge);
        }

        // Ambience: smoke from lit fires, sparks now and then.
        if (!worldPaused && Math.random() < dt * 6) {
            for (const obj of this.zone.objects) {
                if (obj.kind !== "campfire" || obj.removed) continue;
                const f = this.fires.get(this.fireKey(this.zone, obj));
                if (f && f.lit) {
                    this.particles.smoke(obj.x, obj.y - 10, 1);
                    if (Math.random() < 0.3) this.particles.sparks(obj.x, obj.y - 8, 2);
                }
            }
        }

        // The sky drives the smoke: one call per frame, no per-particle wind.
        this.windStrength = WIND_BY_WEATHER[this.weather.current] !== undefined
            ? WIND_BY_WEATHER[this.weather.current] : WIND_BY_WEATHER.clear;
        this.particles.setWind(this.weather.windAngle, this.windStrength);
        // Thunder: the flash is drawn by the renderer, the ground answers here.
        if (this.weather.current === "storm") {
            const period = 7.5;                     // same beat as the flash
            const was = this._thunderT || 0;
            const now = (was + dt) % period;
            this._thunderT = now;
            if (now < was) this.camera.shake(FX.shake.thunder, FX.shake.thunderTime);
        }
        // Above ground the air has things in it too: pollen and chaff in a
        // low sun, and leaves torn loose when it really blows.
        if (!this.zone.def.underground) this._openAir(dt);

        // Underground atmosphere: dust in the torchlight and water off the
        // roof. Both are spawned around the hero, so the cost is flat.
        if (this.zone.def.underground) this._caveAir(dt);

        // Soaked clothes drip while they dry, and a little harder on the move.
        if (this.player.wet > 0) {
            this.player.wet = Math.max(0, this.player.wet - dt);
            this._dripAt = (this._dripAt || 0) - dt * (this.player.moving ? 1.6 : 1);
            if (this._dripAt <= 0) {
                this._dripAt = FX.drip.every;
                this.particles.drip(this.player.x, this.player.y);
            }
        }
        this.particles.update(dt);
        this.tracks.update(dt);
        this.camera.update(dt);
        this.camera.follow(this.player.x, this.player.y - 8, dt, this.player.vx, this.player.vy);
        this.input.consume();

        this._panelTick = (this._panelTick || 0) + dt;
        if (this.hud.panelOpen === "fire" && this.lastFireObj && this._panelTick > .5) {
            this._panelTick = 0; const y = this.hud.els.panelBody.scrollTop;
            const focus = this.hud._panelRows.indexOf(document.activeElement);
            this.openFire(this.lastFireObj); this.hud.els.panelBody.scrollTop = y;
            this.hud._panelRows[focus]?.focus?.();
        }
        sessionTick(this, dt, worldPaused);
        this.hud.update({
            needs: this.needs, player: this.player,
            clock: this.clock,
            weather: this.weather,
            inventory: this.inventory,
            objective: this.story.done ? "" : this.story.objective,
            zoneName: this.zone.def.name,
            ambient: this.ambient
        });
    }

    /**
     * Air in a gallery: slow motes and the occasional drop off the roof.
     * The pending drops live in a fixed array that is reused, so a frame
     * allocates nothing.
     */
    /**
     * The air above ground: motes hanging in a low sun, and leaves a gust
     * tears off the nearest tree. Both are spawned around the hero only, so
     * the cost does not grow with the size of the zone.
     */
    _openAir(dt) {
        const P = FX.pollen, G = FX.gustLeaf;
        const hour = this.clock.minute / 60;
        const sunLow = Math.abs(hour - 12.5) < P.sunBelow && this.clock.daylight > 0.25;
        const calmEnough = (this.windStrength || 0) <= P.maxWeather * 2;
        if (sunLow && calmEnough) {
            this._pollenAt = (this._pollenAt || 0) - dt;
            if (this._pollenAt <= 0) {
                this._pollenAt = 1 / P.rate;
                const warm = Math.abs(hour - 12.5) > 3.5;   // morning and evening light
                this.particles.pollen(this.player.x + (Math.random() - 0.5) * P.spread,
                                      this.player.y + (Math.random() - 0.5) * P.spread * 0.7,
                                      warm);
            }
        }
        if ((this.windStrength || 0) >= G.minStrength) {
            this._gustAt = (this._gustAt || 0) - dt;
            if (this._gustAt <= 0) {
                this._gustAt = G.every;
                // One tree near the hero gives up a couple of leaves.
                let pick = null, n = 0;
                for (const o of this.zone.objects) {
                    if (!TREE_KINDS.has(o.kind)) continue;
                    const dx = o.x - this.player.x, dy = o.y - this.player.y;
                    if (dx * dx + dy * dy > G.reach * G.reach) continue;
                    n++;
                    if (Math.random() < 1 / n) pick = o;      // reservoir sample
                }
                if (pick) {
                    const season = this.clock.season.key;
                    const color = season === "autumn" ? "#c88a3a"
                                : season === "winter" ? "#9fb0a6" : MATERIAL.plant.leaf;
                    this.particles.leaves(pick.x, pick.y - G.crown, color, G.leaves);
                }
            }
        }
        return this;
    }

    _caveAir(dt) {
        const M = FX.motes, D = FX.ceilingDrip;
        this._moteAt = (this._moteAt || 0) - dt;
        if (this._moteAt <= 0) {
            this._moteAt = 1 / M.rate;
            this.particles.mote(this.player.x + (Math.random() - 0.5) * M.spread,
                                this.player.y + (Math.random() - 0.5) * M.spread * 0.7);
        }
        this._dropAt = (this._dropAt || 0) - dt;
        if (this._dropAt <= 0) {
            this._dropAt = (1 / D.rate) * (1 + (Math.random() * 2 - 1) * D.rateVary);
            // Pick a floor tile near the hero: a drop needs somewhere to land.
            const x = this.player.x + (Math.random() - 0.5) * D.spread;
            const y = this.player.y + (Math.random() - 0.5) * D.spread * 0.7;
            if (!this.zone.isBlockedTile(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))) {
                this.particles.ceilingDrop(x, y - 26);
                this._pendingDrops = this._pendingDrops || [];
                this._pendingDrops.push({ x, y, t: D.life });
            }
        }
        const pend = this._pendingDrops;
        if (pend) {
            for (let i = pend.length - 1; i >= 0; i--) {
                pend[i].t -= dt;
                if (pend[i].t > 0) continue;
                this.particles.dropRing(pend[i].x, pend[i].y);
                pend[i] = pend[pend.length - 1];
                pend.pop();
            }
        }
        return this;
    }

    render(dt = 1 / 60) {
        const active = this.inventory.active;
        const activeDef = active ? itemDef(active.id) : null;
        this.renderer.render({
            zone: this.zone,
            player: this.player,
            hands: handRender(this.inventory),
            clock: this.clock,
            weather: this.weather.current,
            groundWet: this.weather.groundWet,
            windAngle: this.weather.windAngle,
            windStrength: this.windStrength === undefined ? WIND_BY_WEATHER.clear : this.windStrength,
            particles: this.particles,
            debris: this.debris,
            tracks: this.tracks,
            fires: this.localFires,
            look: this.look,
            tool: activeDef && (activeDef.tool || activeDef.tags.includes("light"))
                ? { id: active.id, tool: activeDef.tool || (activeDef.tags.includes("light") ? "torch" : "") }
                : null,
            interact: this.interact ? { target: this.interact, label: this.interactLabel(this.interact) } : null,
            playerLight: Math.max(0, ...Object.values(this.inventory.hands || {}).map((h) => itemDef(h?.id)?.light || 0)),
            underground: !!this.zone.def.underground,
            entities: []
        }, dt);
    }

    start() {
        if (this.save.has()) {
            this.sessionReady = false;
            openSessionMenu(this);
            this.loop.start();
            return this;
        }
        // Opening narration remains readable; first launch includes creation.
        this.bus.emit("story:step", {
            title: "Новое начало",
            text: "Неделю назад долина выгорела за одну ночь. Ты вернулся к тому, что было " +
                  "твоим домом: печь, балки и зола по колено. До темноты — пара часов. " +
                  "Палатка стоит, костёр — холодный.",
            next: this.story.objective
        });
        if (!this.isTrial) { this.hud.hideStory(); openAppearance(this, () => { this.hud.closePanel(true); this.hud.showStory({ title: "Новое начало", text: "Ты вернулся к пепелищу своего дома. До темноты осталось немного времени.", next: this.story.objective }); }, true); }
        this.loop.start();
        return this;
    }
}

/* --------------------------------------------------------------------------
 * Browser bootstrap
 * ----------------------------------------------------------------------- */
if (typeof document !== "undefined" && typeof window !== "undefined") {
    window.addEventListener("DOMContentLoaded", async () => {
        window.__stage?.("main.js доехал");
        // A blank page tells nobody anything. Если запуск падает — неудачный
        // деплой, недзагруженный файл, старый кэшированный модуль — об этом
        // должно быть сказано на экране, а не оставлен чёрный прямоугольник.
        // Сама ловушка живёт в index.html, до модуля: ошибку линковки ESM здесь
        // поймать уже нельзя, обработчик на window ещё не поставлен.
        const bootFail = (err) => (window.__bootFail
            ? window.__bootFail(err)
            : console.error("[boot]", err));
        const canvas = document.getElementById("game");
        const hudRoot = document.getElementById("hud");
        // Раньше здесь молча стоял `return`, и на телефоне это выглядело ровно
        // как «чёрный экран без объяснений». Нет канваса — значит страница
        // отдалась не та (кэш, битый HTML): так и пишем.
        if (!canvas || !hudRoot) {
            bootFail(Error("в документе нет #game/#hud — страница не та (кэш или битая загрузка)"));
            return;
        }

        // Переходов в рельефные зоны в игровом мире больше нет: `?relief=1`
        // подменял класс игры, и «пилот» уезжал в превью и в сохранение владельца.
        // Лаборатория рельефа живёт отдельно — dev/relief.html (и ReliefTrialGame
        // остаётся доступен только оттуда, для сравнения физики).
        const game = new Game({ canvas, hudRoot, seed: "ashes-and-grain" });
        window.__stage?.("игра собрана");
        // Стиль — и героя, и пропов — берётся из одного места: параметр адреса
        // важнее выбора в меню, меню важнее значения по умолчанию. На телефоне
        // адресной строки нет, поэтому то же самое умеет «Вид мира» в меню игры.
        // Значение по умолчанию — ЖИВОЙ 3D: герой рисуется three.js-сценой, как в
        // лаборатории, а не запечённым листом. Это не «смелый» выбор, а выбор с
        // сеткой безопасности: hero3dLive(false)/отказ WebGL возвращает лист, а
        // причина отказа печатается в штампе, поэтому «чёрный герой» не бывает
        // необъяснимым.
        const style = loadStyle({ hero3d: "live", props3d: "on" }, window.location.search);
        game.style = style;
        // ?hero3d=smooth — тот же 3D-риг, но без пиксельного грейда (14 тонов на
        // дорожку, ни дизеринга, ни обводки); hero3d=off — прежняя векторная
        // фигура. Гладкий модуль весит 643 КБ и приходит только по запросу.
        if (style.hero3d !== "grade") {
            const hero3d = await import("./render/hero3d.js");
            /** Заметка в штамп: пишет и в window, чтобы пережить гонку «штамп ещё
             *  не создан» / «промо уже прилетело». */
            const note = (txt) => {
                window.__heroLiveNote = txt;
                const el = document.getElementById("buildStamp");
                if (el && txt) el.textContent += txt;
            };
            // Ни лист, ни живой слой не ждут в линии запуска. Лист — запасной кадр
            // (без .catch одна сетевая ошибка здесь = чёрный экран), а three.js с
            // пакетом рига — 3.6 МБ: ждать их, это подарить мобильному игроку пустой
            // экран на секунду-другую. Игра стартует листом и «дорастает» до 3D.
            void hero3d.hero3dSheet(game.look).catch((err) => {
                hero3d.HERO3D.sheetError = String((err && err.message) || err).slice(0, 160);
                return false;
            });
            if (style.hero3d === "off") hero3d.HERO3D.enabled = false;
            else {
                void hero3d.hero3dQuality(style.hero3d).then((ok) => {
                    if (ok) {
                        const i = hero3d.hero3dLiveInfo ? hero3d.hero3dLiveInfo() : null;
                        note(style.hero3d === "live"
                            ? ` · live: готов (${i?.parts} частей · ${i?.clips} клипов · кадр ${i?.coverage >= 0 ? `${i.coverage} px` : "ещё не нарисован"})` : "");
                        return;
                    }
                    console.warn(`[hero3d] режим «${style.hero3d}» недоступен: `
                        + `${hero3d.HERO3D.error || "нет такого режима"} — играет «${hero3d.HERO3D.quality}»`);
                    note(` · live: отказ (${hero3d.HERO3D.error || "нет такого режима"})`);
                }, (err) => {
                    // Отказ не молчание: причина и в консоли, и в штампе.
                    hero3d.HERO3D.error = `живой режим упал: ${String((err && err.message) || err).slice(0, 160)}`;
                    hero3d.HERO3D.live = false;
                    console.warn("[hero3d]", hero3d.HERO3D.error);
                    note(` · live: ${hero3d.HERO3D.error}`);
                });
            }
        }
        // Стиль пропов — оттуда же: props3d=off возвращает процедурные кривые,
        // props3d=on заставляет 3D-спрайты даже если среда их не потянула
        // (причина видна в prop3dStatus()). props3dTone=winter|autumn|wet|
        // snowwet|plain — кадр в другом тоне, чем диктует сезон: сравнивать
        // погоду удобно на одном и том же дереве.
        const props3d = await import("./render/props3d.js");
        props3d.PROPS3D.enabled = style.props3d !== "off";
        if (style.props3dTone) props3d.setPropTone(style.props3dTone);
        // Штамп сборки: без него «правки не доехали» и «правки не видно»
        // выглядят одинаково. Здесь ровно то, что реально загрузилось.
        try {
            const st = props3d.prop3dStatus();
            // Статика героя спрашивается динамическим импортом: в «hero3d=off»
            // лист на 627 КБ в графе не нужен вовсе, а здесь он и так уже
            // лежит в кэше модулей (его тянет render/character.js).
            const { HERO3D, hero3dSheetInfo } = await import("./render/hero3d.js");
            // Живой слой поднимается параллельно, поэтому штамп дописывает заметку
            // сам, когда промис режима завершится (note() выше).
            const liveStamp = window.__heroLiveNote || "";
            const stamp = document.createElement("div");
            stamp.id = "buildStamp";
            stamp.textContent = `сборка 79 · 3D-пропы: ${st.enabled ? st.kinds : 0} (${st.reason || "ок"})`
                + ` · свет ${st.sun ? `×${st.sun.amp.toFixed(2)}/${st.sun.amb.toFixed(2)}` : "—"}`
                + ` · тон ${st.tone || "авто"} · ${styleKey(style)}`
                // Герой в штампе обязателен: все три претензии блока (лицо, пол,
                // мокрый слой) сидят в его листе, а лист грузится асинхронно.
                // «Сборка есть, а героя не видно» = лист не доехал.
                + ` · герой: ${HERO3D.ready ? `${HERO3D.quality} · лист ${hero3dSheetInfo().id}` : "лист не загружен"}`
                + liveStamp
                // «Сборка есть, а героя не видно» и «live не включился» обязаны
                // различаться глазами: в штампе кадры живого рендера, размер пакета
                // и причина, по которой игра вернулась на лист.
                + (HERO3D.live ? "" : "")
                + (HERO3D.error ? ` (${HERO3D.error})` : "")
                + (HERO3D.sheetError ? ` (лист: ${HERO3D.sheetError})` : "");
            (document.body || document.documentElement).appendChild(stamp);
        } catch (e) { window.__stage?.(`штамп не выведен: ${e.message}`); /* штамп — не игра */ }
        window.GAME = game;
        window.__stage?.(`стиль применён: ${styleKey(style)}`);
        // The owner's control room. Loaded lazily and locked behind a
        // password, so an ordinary player never sees it and the module costs
        // nothing until it is asked for. Раньше здесь стоял `if (!trial)` —
        // флаг пилота умер вместе с ?relief=1, а проверка осталась: в браузере
        // это ReferenceError до первой отрисовки, то есть чёрный экран (в node
        // блок не исполняется, и тесты его не видели; теперь видят —
        // tests/browser-boot.test.js).
        import("./dev/devtools.js")
            .then((m) => m.installDevTools(game, window))
            // Пульт — дело добровольное, но «молча не загрузился» это тот же
            // чёрный экран по честоте: пусть будет записано в стадии запуска.
            .catch((e) => window.__stage?.(`пульт не загрузился: ${(e && e.message) || e}`));
        game.viewport = installViewport(game, document.getElementById("stage"), window, document);
        bindSessionLifecycle(game, window, document);
        game.start();
        // «start() вызван» ещё ничего не значит: первый кадр — вот настоящее
        // «игра жива». Watchdog из index.html ждёт именно этого флага.
        window.__stage?.("start() вызван");
        requestAnimationFrame(() => {
            window.__boot.started = true;
            window.__stage?.("первый кадр");
        });
    });
}
