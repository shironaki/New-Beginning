/**
 * v3 — «Пепел и Зерно». Bootstrap and orchestration.
 *
 * This file wires systems together and owns the player's *intent* (what E does
 * right now). All rules live in their own modules; nothing here should grow
 * into v2's thousand-line main.js.
 */
import { EventBus } from "./core/events.js";
import { GameClock } from "./core/time.js";
import { GameLoop } from "./core/loop.js";
import { RNG, hashSeed } from "./core/rng.js";
import { SaveManager } from "./core/save.js";
import { Input } from "./engine/input.js";
import { Camera } from "./engine/camera.js";
import { WorldMap } from "./world/worldgen.js";
import { WeatherSystem } from "./world/weather.js";
import { UI, pixelRatio } from "./ui/uispec.js";
import { START_ZONE, biomeDef, oppositeEdge } from "./world/regions.js";
import { TILE_SIZE, tileInfo } from "./world/tiles.js";
import { bodyBlocked } from "./world/tilemap.js";
import { Player } from "./entities/player.js";
import { Inventory } from "./sandbox/inventory.js";
import { itemDef, itemEmoji, itemName, foodValue } from "./sandbox/items.js";
import { propDef, rollDrops, requiredTool, toolHint } from "./sandbox/gather.js";
import { Needs } from "./survival/needs.js";
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
        this.tracks = new Tracks();
        this.fires = new Map();          // `${zoneId}:${tx},${ty}` -> Campfire
        this.look = { skin: "#e2b48a", hair: "#3f2d20", shirt: "#77684a", pants: "#524636", accent: "#8a4b32" };

        this.zone = this.world.get(START_ZONE);
        this.player = new Player({ x: this.zone.spawn.x, y: this.zone.spawn.y, bus: this.bus });

        this.camera = new Camera({ width: canvas.width, height: canvas.height,
                                  zoom: UI.baseZoom * (canvas.width > 1700 ? 2 : 1) });
        this.camera.followReducedMotion();
        this.camera.setBounds(this.zone.map.widthPx, this.zone.map.heightPx);
        this.camera.snapTo(this.player.x, this.player.y);

        this.renderer = new Renderer(canvas, this.camera);
        this.input = new Input({ target: window });
        this.hud = new HUD(hudRoot, {
            onHotbar: (i) => this.inventory.setActive(i),
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
            render: () => this.render()
        });
    }

    /* ===================== setup ===================== */

    _startingKit() {
        // Everything the prologue gives you: a knife, flint, and almost nothing else.
        this.inventory.add("knife", 1);
        this.inventory.add("flint", 1);
        this.inventory.add("berry", 3);
        this.inventory.setActive(0);
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
        bus.on("story:step", (s) => { this.hud.showStory(s); this.paused = true; });
        bus.on("needs:warn", ({ text, icon }) => this.hud.toast(text, icon));
        bus.on("cook:discovered", ({ name, emoji }) => this.hud.toast(`Новое блюдо: ${name}`, emoji));
        bus.on("fire:lit", () => {
            this.hud.toast("Костёр разгорелся", "🔥");
            this.particles.sparks(this.lastFireObj ? this.lastFireObj.x : this.player.x,
                                  this.lastFireObj ? this.lastFireObj.y : this.player.y, 14);
        });
        bus.on("fire:out", () => this.hud.toast("Костёр погас", "💨"));
        bus.on("weather:change", ({ info }) => this.hud.toast(`${info.emoji} ${info.name}`));
        bus.on("player:collapse", () => this.onCollapse());
        this.hud.onAction = () => { this.paused = false; };
    }

    _bindTouch(canvas) {
        // Analogue joystick on the left half, action tap on the right.
        let id = null, ox = 0, oy = 0;
        const start = (e) => {
            for (const t of e.changedTouches) {
                if (t.clientX < window.innerWidth * 0.5 && id === null) {
                    id = t.identifier; ox = t.clientX; oy = t.clientY;
                } else {
                    this.input.tap("action");
                }
            }
        };
        const move = (e) => {
            for (const t of e.changedTouches) {
                if (t.identifier !== id) continue;
                this.input.setStick((t.clientX - ox) / 55, (t.clientY - oy) / 55);
            }
            e.preventDefault();
        };
        const end = (e) => {
            for (const t of e.changedTouches) {
                if (t.identifier === id) { id = null; this.input.setStick(0, 0); }
            }
        };
        // A native drag or a context menu steals the key release that ends a
        // step; neither does anything useful over the game surface.
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        canvas.addEventListener("dragstart", (e) => e.preventDefault());
        canvas.addEventListener("touchstart", start, { passive: true });
        canvas.addEventListener("touchmove", move, { passive: false });
        canvas.addEventListener("touchend", end, { passive: true });
        canvas.addEventListener("touchcancel", end, { passive: true });
    }

    _setupSave() {
        this.save = new SaveManager({ bus: this.bus });
        this.save.register("clock", () => this.clock.toJSON(), (d) => this.clock.load(d));
        this.save.register("needs", () => this.needs.toJSON(), (d) => this.needs.load(d));
        this.save.register("inv", () => this.inventory.toJSON(), (d) => this.inventory.load(d));
        this.save.register("player", () => ({ zone: this.zone.id, p: this.player.toJSON() }),
            (d) => {
                if (d.zone) this.enterZone(d.zone, null, true);
                this.player.load(d.p);
            });
        this.save.register("story", () => this.story.toJSON(), (d) => this.story.load(d));
        this.save.register("cook", () => this.cookJournal.toJSON(), (d) => this.cookJournal.load(d));
        this.save.register("weather", () => this.weather.toJSON(), (d) => this.weather.load(d));
        this.save.register("seed", () => this.seed, () => {});
        this.save.register("fires", () => {
            const out = {};
            for (const [k, f] of this.fires) out[k] = f.toJSON();
            return out;
        }, (d) => {
            for (const [k, data] of Object.entries(d || {})) {
                const f = this.fires.get(k) || new Campfire({ bus: this.bus });
                f.load(data);
                this.fires.set(k, f);
            }
        });
        this.bus.on("time:newday", () => { this.save.write({ day: this.clock.day }); this.hud.toast("Игра сохранена", "💾"); });
    }

    /* ===================== world ===================== */

    /**
     * Is there room for the player's body at this spot? Mirrors the probe
     * pattern of `moveAndCollide`, so "free" here means "can actually move".
     */
    fitsAt(x, y, radius = this.player.radius) {
        const zone = this.zone;
        return !bodyBlocked(
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
            if (obj.removed) continue;
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
        if (def.interact === "fire") {
            const f = this.fires.get(this.fireKey(this.zone, obj));
            return f && f.lit ? "Костёр · E" : "Разжечь костёр · E";
        }
        if (def.interact === "sleep") return "Спать · E";
        if (def.interact === "read") return "Прочитать · E";
        if (def.interact === "story") return "Осмотреть · E";
        if (def.interact === "loot") return obj.looted ? "Пусто" : "Обыскать · E";
        const tool = requiredTool(obj.kind);
        const have = tool ? this.inventory.findTool(tool) : true;
        if (!have) return toolHint(obj.kind);
        return `${def.name} · E`;
    }

    doInteract() {
        const obj = this.interact;
        if (!obj) return;
        const def = propDef(obj.kind);
        if (!def) return;

        if (def.interact === "fire") return this.openFire(obj);
        if (def.interact === "sleep") return this.sleep(obj);
        if (def.interact === "read" || def.interact === "story") {
            if (obj.story) this.story.setFlag(obj.story);
            if (def.interact === "read") {
                this.inventory.add("diary_burnt", 1);
                obj.removed = true;
            }
            this.particles.emote(obj.x, obj.y - 20, "❓");
            return;
        }
        if (def.interact === "loot") return this.lootChest(obj);
        return this.harvest(obj);
    }

    harvest(obj) {
        const def = propDef(obj.kind);
        const tool = requiredTool(obj.kind);
        if (tool && !this.inventory.findTool(tool)) {
            this.hud.toast(toolHint(obj.kind), "✋");
            return;
        }
        this.player.swing("tool");
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
        let dy = 0;
        for (const d of drops) {
            const left = this.inventory.add(d.id, d.n);
            const got = d.n - left;
            if (got > 0) {
                this.particles.text(obj.x, obj.y - 18 - dy, `+${got} ${itemEmoji(d.id)}`, { color: "#ffe6a8" });
                dy += 12;
            }
            if (left > 0) this.hud.toast("Рюкзак полон", "🎒");
        }
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
        obj.removed = true;
        this.zone.removeSolid(obj);              // its footprint goes with it
        this.bus.emit("world:harvest", { kind: obj.kind, drops });
    }

    lootChest(obj) {
        if (obj.looted) return;
        obj.looted = true;
        const table = [["coin", 3], ["flint", 2], ["fiber", 3], ["charcoal", 2], ["old_key", 1]];
        const id = this.rng.weighted(table) || "fiber";
        const n = id === "coin" ? this.rng.int(3, 12) : this.rng.int(1, 3);
        this.inventory.add(id, n);
        this.particles.text(obj.x, obj.y - 20, `+${n} ${itemEmoji(id)}`, { color: "#ffe6a8" });
        this.hud.toast(`Найдено: ${itemName(id)} ×${n}`, itemEmoji(id));
    }

    /* ---- the campfire panel ---- */

    openFire(obj) {
        const key = this.fireKey(this.zone, obj);
        let fire = this.fires.get(key);
        if (!fire) { fire = new Campfire({ bus: this.bus }); this.fires.set(key, fire); }
        this.lastFireObj = obj;
        const refresh = () => this.openFire(obj);
        this.hud.openPanel("Костёр", fireRows(fire, this.inventory, {
            canCook: (id) => isCookable(id),
            addFuel: (id) => {
                if (this.inventory.remove(id, 1) && fire.addFuel(id)) {
                    this.particles.sparks(obj.x, obj.y - 6, 5);
                }
                refresh();
            },
            light: () => {
                const ok = fire.light({ hasFlint: this.inventory.has("flint") });
                if (!ok) this.hud.toast("Нужен кремень и топливо", "🪨");
                refresh();
            },
            putOnSpit: (id) => {
                if (fire.putOnSpit(id) >= 0) this.inventory.remove(id, 1);
                else this.hud.toast("Вертел занят", "🍢");
                refresh();
            },
            takeFromSpit: (i) => {
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

    openPot(fire, back) {
        if (fire.pot && fire.pot.done) {
            const id = fire.takePot();
            this.inventory.add(id, 1);
            this.cookJournal.discover(id);
            this.hud.toast(`Готово: ${itemName(id)}`, itemEmoji(id));
            return back();
        }
        const edible = this.inventory.list().filter((s) => {
            const d = itemDef(s.id);
            return d && (d.tags.includes("food") || d.tags.includes("herb"));
        });
        const chosen = [];
        const rows = [{ html: "<b>Котелок</b><br><small>Выбери 2–3 ингредиента — что получится, узнаешь сам.</small>" }];
        for (const e of edible.slice(0, 8)) {
            rows.push({
                icon: itemEmoji(e.id), label: itemName(e.id), hint: `×${e.n}`,
                action: () => {
                    chosen.push(e.id);
                    this.hud.toast(`В котелок: ${itemName(e.id)}`, itemEmoji(e.id));
                    if (chosen.length >= 2) {
                        const res = fire.startPot(chosen);
                        chosen.forEach((id) => this.inventory.remove(id, 1));
                        if (!res) this.hud.toast("Из этого ничего не выйдет", "🤔");
                        back();
                    }
                }
            });
        }
        this.hud.openPanel("Котелок", rows, "pot");
    }

    /* ---- backpack ---- */

    openBackpack() {
        const rows = [{ html: `<b>Рюкзак</b> · ${this.inventory.used}/${this.inventory.size} · ${this.inventory.weight} кг` }];
        for (const s of this.inventory.list()) {
            const d = itemDef(s.id);
            const edible = foodValue(s.id);
            rows.push({
                icon: itemEmoji(s.id),
                label: `${itemName(s.id)} ×${s.n}`,
                hint: edible ? `съесть · +${edible.food}🍖` : (d.tool ? "инструмент" : ""),
                action: edible ? () => { this.eat(s.id); this.openBackpack(); } : () => {}
            });
        }
        this.hud.openPanel("Рюкзак", rows, "bag");
    }

    eat(id) {
        const val = foodValue(id);
        if (!val) return;
        if (!this.inventory.remove(id, 1)) return;
        this.needs.consume(val);
        this.particles.text(this.player.x, this.player.y - 26, `+${val.food} 🍖`, { color: "#b7e37a" });
        this.hud.toast(`Съедено: ${itemName(id)}`, itemEmoji(id));
    }

    openJournal() {
        const rows = [{ html: `<b>Акт ${this.story.act}</b> · ${this.story.objective}` }];
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

    /** Advance world systems by `minutes` in-game minutes. */
    simulateMinutes(minutes, sleeping = false) {
        const seconds = minutes * 60;
        for (const [, fire] of this.fires) fire.update(seconds / this.weather.fuelPenalty);
        this.needs.update(minutes, {
            ambient: this.ambient,
            fireWarmth: this.fireWarmthNear(this.player.x, this.player.y),
            insulation: this.inventory.has("cloak") ? 6 : 0,
            sheltered: sleeping || this.shelteredAt(this.player.x, this.player.y),
            sleeping,
            activity: sleeping ? 0.3 : this.player.activity(),
            company: false
        });
        if (this.weather.isWet && !sleeping && !this.shelteredAt(this.player.x, this.player.y)) {
            this.needs.wet = Math.min(1, this.needs.wet + 0.004 * minutes);
        }
    }

    update(dt) {
        this.elapsed += dt;
        const uiBlocking = this.hud.isPanelOpen || this.paused;

        // Clock & derived systems.
        const minutes = uiBlocking ? 0 : this.clock.update(dt);
        if (minutes > 0) this.simulateMinutes(minutes);

        // Input → movement. The sanity pass runs first: a key whose `keyup`
        // never arrived (focus lost to a click outside the frame) is dropped
        // here instead of walking the hero away on its own.
        this.input.update(dt);
        const axis = uiBlocking ? { x: 0, y: 0 } : this.input.axis();
        this.player.update(dt, axis, this.zone, {
            speedFactor: this.needs.speedFactor(),
            wantRun: this.input.pressed("sprint")
        });
        // Safety net: if anything ever leaves the hero inside a solid thing
        // (a prop built on top of them, a bad teleport), walk them out instead
        // of letting the game wedge.
        if (!this.player.sleeping && !this.fitsAt(this.player.x, this.player.y)) {
            this.placeSafely(this.player.x, this.player.y);
        }

        // A foot planted: kick up dust the colour of the ground it landed on.
        // Driven by the leg phase, so the puff is always under the boot.
        if (this.player.stepEvent) {
            this.player.stepEvent = false;
            this.bus.emit("player:footstep", { side: this.player.stepSide });
            const info = this.zone.map.get(
                Math.floor(this.player.x / TILE_SIZE), Math.floor(this.player.y / TILE_SIZE));
            const def = tileInfo(info);
            if (def.liquid) {
                // Wading: the boot throws water, not dust.
                this.particles.splash(this.player.x + this.player.stepSide * 2.5, this.player.y + 2,
                                      this.player.running ? 1.25 : 0.85);
                this.player.wet = TRACK.wetLife;
            } else {
                // Soft ground keeps the boot: sand, snow, mud, ash. Soaked
                // boots print on hard ground too, until they dry out.
                this.tracks.add(this.player.x, this.player.y + 2,
                                this.player.faceX, this.player.faceY,
                                this.player.stepSide, info, this.player.wet > 0);
                this.particles.dust(this.player.x + this.player.stepSide * 2.5, this.player.y + 3,
                    this.player.running ? FX.dust.run : FX.dust.walk, dustColor(def));
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

        // Hotbar keys.
        for (let i = 1; i <= 6; i++) {
            if (this.input.justPressed("slot" + i)) this.inventory.setActive(i - 1);
        }
        if (this.input.justPressed("inventory")) {
            this.hud.isPanelOpen ? this.hud.closePanel() : this.openBackpack();
        }
        if (this.input.justPressed("journal")) {
            this.hud.isPanelOpen ? this.hud.closePanel() : this.openJournal();
        }
        if (this.input.justPressed("cancel")) {
            if (this.hud.isStoryOpen) this.hud.hideStory();
            else this.hud.closePanel();
        }

        // Interaction.
        this.interact = uiBlocking ? null : this.findInteractable();
        if (!uiBlocking && this.input.justPressed("action")) this.doInteract();
        else if (uiBlocking && this.input.justPressed("action") && this.hud.isStoryOpen) this.hud.hideStory();

        // Zone travel.
        if (!uiBlocking) {
            const portal = this.zone.portalAt(this.player.x, this.player.y);
            if (portal) this.enterZone(portal.target, portal.edge);
        }

        // Ambience: smoke from lit fires, sparks now and then.
        if (!uiBlocking && Math.random() < dt * 6) {
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

        this.hud.update({
            needs: this.needs,
            clock: this.clock,
            weather: this.weather,
            inventory: this.inventory,
            objective: this.story.objective,
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

    render() {
        const active = this.inventory.active;
        const activeDef = active ? itemDef(active.id) : null;
        this.renderer.render({
            zone: this.zone,
            player: this.player,
            clock: this.clock,
            weather: this.weather.current,
            windAngle: this.weather.windAngle,
            windStrength: this.windStrength === undefined ? WIND_BY_WEATHER.clear : this.windStrength,
            particles: this.particles,
            tracks: this.tracks,
            fires: this.localFires,
            look: this.look,
            tool: activeDef && (activeDef.tool || activeDef.tags.includes("light"))
                ? { id: active.id, tool: activeDef.tool || (activeDef.tags.includes("light") ? "torch" : "") }
                : null,
            interact: this.interact ? { target: this.interact, label: this.interactLabel(this.interact) } : null,
            playerLight: activeDef && activeDef.light ? activeDef.light : 0,
            underground: !!this.zone.def.underground,
            entities: []
        }, 1 / 60);
    }

    start() {
        // Opening narration, then the loop.
        this.bus.emit("story:step", {
            title: "Пепел и Зерно",
            text: "Неделю назад долина выгорела за одну ночь. Ты вернулся к тому, что было " +
                  "твоим домом: печь, балки и зола по колено. До темноты — пара часов. " +
                  "Палатка стоит, костёр — холодный.",
            next: this.story.objective
        });
        this.loop.start();
        return this;
    }
}

/* --------------------------------------------------------------------------
 * Browser bootstrap
 * ----------------------------------------------------------------------- */
if (typeof document !== "undefined" && typeof window !== "undefined") {
    window.addEventListener("DOMContentLoaded", () => {
        const canvas = document.getElementById("game");
        const hudRoot = document.getElementById("hud");
        if (!canvas || !hudRoot) return;

        // The canvas is sized in CSS pixels but drawn at the display's real
        // pixel density: on a retina screen the old code rendered 1× and let
        // the browser upscale, which is exactly the blur `image-rendering:
        // pixelated` was supposed to prevent. Zoom is multiplied by the same
        // ratio, so the world keeps its apparent size on every display.
        const fit = (game) => {
            const w = Math.min(window.innerWidth, 1600);
            const h = Math.min(window.innerHeight, 1000);
            const dpr = pixelRatio(window);
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            canvas.style.width = w + "px"; canvas.style.height = h + "px";
            if (game) {
                game.renderer.resize(canvas.width, canvas.height);
                game.camera.zoom = UI.baseZoom * dpr;
            }
        };
        fit(null);

        const game = new Game({ canvas, hudRoot, seed: "ashes-and-grain" });
        window.GAME = game;
        window.addEventListener("resize", () => fit(game));
        game.start();
    });
}
