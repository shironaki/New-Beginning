/**
 * v3 render — the frame.
 *
 * Five layers, in order:
 *   1. ground      — baked per 16×16 chunk into offscreen canvases (static)
 *   2. decals      — paths, edges, tilled soil (baked with the ground)
 *   3. objects     — props, characters, buildings; y-sorted every frame
 *   4. weather     — rain, snow, fog in screen space
 *   5. light       — the light map, composited last
 *
 * Only visible chunks are drawn, and a chunk is re-baked only when a tile in
 * it changes. That is the whole performance story for a 96×72 zone.
 */
import { CHUNK } from "../world/tilemap.js";
import { TILE_SIZE, TILES } from "../world/tiles.js";
import { paintTile, paintEdges, paintProp, paintFlames, paintSpitItem, setSun } from "./tilesart.js";
import { drawCharacter, drawSleeping } from "./character.js";
import { LightMap } from "./lighting.js";
import { itemEmoji } from "../sandbox/items.js";

export class Renderer {
    constructor(canvas, camera) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", { alpha: false });
        this.ctx.imageSmoothingEnabled = false;
        this.camera = camera;
        this.chunkCache = new Map();     // `${zoneId}:${key}` -> canvas
        this.lightMap = new LightMap(canvas.width, canvas.height);
        this.time = 0;
        this.stats = { chunksDrawn: 0, propsDrawn: 0, baked: 0 };
        this.season = "spring";
    }

    resize(w, h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.ctx.imageSmoothingEnabled = false;
        this.camera.resize(w, h);
        this.lightMap.resize(w, h);
        return this;
    }

    /** Throw away baked chunks (zone change, season change). */
    invalidate(zoneId = null) {
        if (!zoneId) this.chunkCache.clear();
        else for (const k of Array.from(this.chunkCache.keys())) {
            if (k.startsWith(zoneId + ":")) this.chunkCache.delete(k);
        }
        return this;
    }

    /** Bake one chunk's ground into an offscreen canvas. */
    bakeChunk(zone, cx, cy) {
        const size = CHUNK * TILE_SIZE;
        const cv = document.createElement("canvas");
        cv.width = size; cv.height = size;
        const c = cv.getContext("2d");
        c.imageSmoothingEnabled = false;
        for (let ty = 0; ty < CHUNK; ty++) {
            for (let tx = 0; tx < CHUNK; tx++) {
                const wx = cx * CHUNK + tx, wy = cy * CHUNK + ty;
                if (!zone.map.inBounds(wx, wy)) continue;
                const id = zone.map.get(wx, wy);
                paintTile(c, id, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, wx, wy, this.season);
            }
        }
        // Second pass so edges blend over finished neighbours.
        for (let ty = 0; ty < CHUNK; ty++) {
            for (let tx = 0; tx < CHUNK; tx++) {
                const wx = cx * CHUNK + tx, wy = cy * CHUNK + ty;
                if (!zone.map.inBounds(wx, wy)) continue;
                paintEdges(c, zone.map, wx, wy, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE);
            }
        }
        this.stats.baked++;
        return cv;
    }

    drawGround(zone) {
        const cam = this.camera;
        const ctx = this.ctx;
        const chunks = zone.map.chunksInRect(cam.x, cam.y, cam.viewW, cam.viewH);
        this.stats.chunksDrawn = 0;
        for (const ch of chunks) {
            const key = `${zone.id}:${ch.key}`;
            if (zone.map.dirtyChunks.has(ch.key)) {
                this.chunkCache.delete(key);
                zone.map.dirtyChunks.delete(ch.key);
            }
            let cv = this.chunkCache.get(key);
            if (!cv) { cv = this.bakeChunk(zone, ch.cx, ch.cy); this.chunkCache.set(key, cv); }
            const wx = ch.cx * CHUNK * TILE_SIZE;
            const wy = ch.cy * CHUNK * TILE_SIZE;
            const s = cam.worldToScreen(wx, wy);
            const size = CHUNK * TILE_SIZE * cam.zoom;
            ctx.drawImage(cv, Math.round(s.x), Math.round(s.y), Math.ceil(size), Math.ceil(size));
            this.stats.chunksDrawn++;
        }
        return this;
    }

    /**
     * Live water: the baked ground gives the colour, this adds the movement —
     * travelling swell, glints and foam along the shore. Cheap: only the
     * visible tiles, two strokes each.
     */
    drawWater(zone) {
        const cam = this.camera;
        const ctx = this.ctx;
        const t = this.time;
        const x0 = Math.floor(cam.x / TILE_SIZE) - 1, y0 = Math.floor(cam.y / TILE_SIZE) - 1;
        const x1 = Math.ceil((cam.x + cam.viewW) / TILE_SIZE) + 1;
        const y1 = Math.ceil((cam.y + cam.viewH) / TILE_SIZE) + 1;
        ctx.save();
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                if (!zone.map.inBounds(tx, ty)) continue;
                const id = zone.map.get(tx, ty);
                const info = TILES[id];
                if (!info || !info.liquid) continue;
                const s = cam.worldToScreen(tx * TILE_SIZE, ty * TILE_SIZE);
                const z = cam.zoom, S = TILE_SIZE * z;
                // Swell: curved crests drifting across the tile.
                ctx.lineCap = "round";
                for (let k = 0; k < 2; k++) {
                    const phase = t * (0.45 + k * 0.2) + tx * 0.35 + ty * 0.7 + k;
                    const yy = s.y + ((Math.sin(phase) * 0.5 + 0.5) * 0.7 + k * 0.18) * S;
                    const w = (0.35 + 0.3 * Math.abs(Math.cos(phase * 1.3))) * S;
                    const x0 = s.x + ((tx * 7 + ty * 3) % 5) * z;
                    ctx.strokeStyle = k ? "rgba(255,255,255,0.12)" : "rgba(10,40,60,0.13)";
                    ctx.lineWidth = Math.max(1, 1.2 * z);
                    ctx.beginPath();
                    ctx.moveTo(x0, yy);
                    ctx.quadraticCurveTo(x0 + w * 0.5, yy - 1.6 * z, x0 + w, yy + 0.4 * z);
                    ctx.stroke();
                }
                // Surf where the water meets land: a wobbling line of foam
                // that breathes, not a rectangle glued to the tile edge.
                const neighbours = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                for (const [dx, dy] of neighbours) {
                    const n = zone.map.get(tx + dx, ty + dy);
                    const ni = TILES[n];
                    if (!ni || ni.liquid) continue;
                    const pulse = 0.22 + 0.16 * Math.sin(t * 1.6 + tx * 0.8 + ty * 0.5);
                    ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
                    ctx.lineWidth = Math.max(1, 1.6 * z);
                    ctx.beginPath();
                    const seg = 6;
                    for (let i = 0; i <= seg; i++) {
                        const f = i / seg;
                        const wob = (Math.sin(t * 1.3 + (tx + f) * 3.1 + ty * 2.3) * 0.5 + 0.5) * 3.2 * z;
                        let X, Y;
                        if (dy < 0) { X = s.x + f * S; Y = s.y + 1.5 * z + wob; }
                        else if (dy > 0) { X = s.x + f * S; Y = s.y + S - 1.5 * z - wob; }
                        else if (dx < 0) { X = s.x + 1.5 * z + wob; Y = s.y + f * S; }
                        else { X = s.x + S - 1.5 * z - wob; Y = s.y + f * S; }
                        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
                    }
                    ctx.stroke();
                }
            }
        }
        ctx.restore();
        return this;
    }

    /**
     * Objects layer: props + characters, sorted by their base Y so a hero
     * walking behind a pine is actually behind it.
     */
    drawObjects(state) {
        const { zone, player, fires } = state;
        const cam = this.camera;
        const ctx = this.ctx;
        const drawables = [];

        for (const obj of zone.objects) {
            if (obj.removed) continue;
            if (!cam.isVisible(obj.x, obj.y, 70)) continue;
            drawables.push({ y: obj.y, kind: "prop", obj });
        }
        for (const ent of (state.entities || [])) {
            if (!cam.isVisible(ent.x, ent.y, 70)) continue;
            drawables.push({ y: ent.y, kind: "entity", obj: ent });
        }
        if (!player.sleeping) drawables.push({ y: player.y, kind: "player", obj: player });

        drawables.sort((a, b) => a.y - b.y);
        this.stats.propsDrawn = drawables.length;

        for (const d of drawables) {
            const o = d.obj;
            const s = cam.worldToScreen(o.x, o.y);
            ctx.save();
            ctx.translate(Math.round(s.x), Math.round(s.y));
            ctx.scale(cam.zoom, cam.zoom);
            if (d.kind === "prop") {
                paintProp(ctx, o, this.time, this.season);
                if (o.kind === "campfire") {
                    const fire = fires && fires.get(o.id != null ? o.id : `${o.tx},${o.ty}`);
                    paintFlames(ctx, fire ? fire.intensity : 0, this.time, fire ? fire.stack : []);
                    if (fire) {
                        fire.spit.forEach((slot, i) => {
                            if (slot) paintSpitItem(ctx, i, slot.state, itemEmoji(slot.itemId), slot.itemId);
                        });
                        if (fire.lit) {
                            // Spit frame.
                            ctx.strokeStyle = "#4a3a28"; ctx.lineWidth = 1.2;
                            ctx.beginPath(); ctx.moveTo(-12, -4); ctx.lineTo(-9, -22); ctx.stroke();
                            ctx.beginPath(); ctx.moveTo(12, -4); ctx.lineTo(9, -22); ctx.stroke();
                            ctx.beginPath(); ctx.moveTo(-10, -21); ctx.lineTo(10, -21); ctx.stroke();
                        }
                    }
                }
            } else if (d.kind === "player") {
                drawCharacter(ctx, {
                    dir: o.dir, phase: o.anim, gait: o.gait, runBlend: o.runBlend,
                    moving: o.moving, look: state.look,
                    actionTimer: o.actionTimer, tool: state.tool, idleTime: this.time
                });
            } else {
                drawCharacter(ctx, {
                    // Settlers and travellers share the hero's locomotion contract:
                    // whatever advances their `anim`/`gait` gets the same walk.
                    dir: o.dir || "down", phase: o.anim || 0,
                    gait: o.gait != null ? o.gait : (o.moving ? 1 : 0),
                    runBlend: o.runBlend || 0,
                    moving: !!o.moving, look: o.look, idleTime: this.time
                });
            }
            ctx.restore();
        }
        return this;
    }

    /** Highlight the thing the player is about to interact with. */
    drawInteractHint(target, label) {
        if (!target) return this;
        const cam = this.camera;
        const ctx = this.ctx;
        const s = cam.worldToScreen(target.x, target.y);
        ctx.save();
        ctx.strokeStyle = "rgba(255,226,150,0.85)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -this.time * 12;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, 16 * cam.zoom, 8 * cam.zoom, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        if (label) {
            ctx.save();
            ctx.font = `${Math.round(7 * cam.zoom)}px "Segoe UI", system-ui, sans-serif`;
            ctx.textAlign = "center";
            const w = ctx.measureText(label).width + 16;
            const y = s.y - 34 * cam.zoom;
            ctx.fillStyle = "rgba(18,16,14,0.82)";
            roundRect(ctx, s.x - w / 2, y - 16, w, 22, 6);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,210,130,0.5)";
            ctx.lineWidth = 1;
            roundRect(ctx, s.x - w / 2, y - 16, w, 22, 6);
            ctx.stroke();
            ctx.fillStyle = "#ffe6b0";
            ctx.fillText(label, s.x, y);
            ctx.restore();
        }
        return this;
    }

    /** Screen-space weather. */
    drawWeather(weather, dt) {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;
        if (weather === "rain" || weather === "storm") {
            ctx.save();
            ctx.strokeStyle = weather === "storm" ? "rgba(170,195,225,0.5)" : "rgba(170,195,225,0.35)";
            ctx.lineWidth = 1;
            const n = weather === "storm" ? 220 : 140;
            for (let i = 0; i < n; i++) {
                const x = (i * 97 + this.time * 420) % W;
                const y = (i * 131 + this.time * 900) % H;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x - 3, y + 12);
                ctx.stroke();
            }
            ctx.restore();
        } else if (weather === "snow") {
            ctx.save();
            ctx.fillStyle = "rgba(255,255,255,0.75)";
            for (let i = 0; i < 120; i++) {
                const x = (i * 83 + Math.sin(this.time * 0.6 + i) * 30 + this.time * 20) % W;
                const y = (i * 61 + this.time * 60) % H;
                ctx.fillRect(x, y, 2, 2);
            }
            ctx.restore();
        } else if (weather === "fog") {
            ctx.save();
            ctx.fillStyle = "rgba(190,195,200,0.18)";
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }
        return this;
    }

    /**
     * Colour grading: a cheap wash that gives each hour its own mood, plus a
     * vignette so the frame has a centre. Runs after the light map.
     */
    grade(clock, weather) {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;
        const hour = clock ? clock.minute / 60 : 12;
        const daylight = clock ? clock.daylight : 1;

        // Warm, low sun at dawn and dusk; cold blue at night; neutral at noon.
        const dawn = Math.max(0, 1 - Math.abs(hour - 6.5) / 2.6);
        const dusk = Math.max(0, 1 - Math.abs(hour - 19.5) / 2.8);
        const noon = Math.max(0, 1 - Math.abs(hour - 13) / 5);

        ctx.save();
        if (dawn > 0) {
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = `rgba(120,80,50,${0.1 * dawn})`;
            ctx.fillRect(0, 0, W, H);
        }
        if (dusk > 0) {
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = `rgba(140,70,30,${0.12 * dusk})`;
            ctx.fillRect(0, 0, W, H);
        }
        if (noon > 0 && weather === "clear") {
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = `rgba(112,96,56,${0.11 * noon})`;
            ctx.fillRect(0, 0, W, H);
            // Sunlight comes from the upper left: let the frame feel it.
            const sun = ctx.createLinearGradient(0, 0, W * 0.9, H);
            sun.addColorStop(0, `rgba(255,236,186,${0.1 * noon})`);
            sun.addColorStop(0.55, "rgba(255,236,186,0)");
            ctx.fillStyle = sun;
            ctx.fillRect(0, 0, W, H);
        }
        // Daylight itself: a bright sky bounce that makes noon read as noon
        // instead of "grey and gloomy".
        if (daylight > 0.25) {
            const d = (daylight - 0.25) / 0.75;
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = `rgba(118,122,116,${0.1 * d})`;      // sunlight
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = `rgba(74,104,150,${0.05 * d})`;      // sky bounce
            ctx.fillRect(0, 0, W, H);
        }
        ctx.globalCompositeOperation = "source-over";
        if (daylight < 0.6) {                      // moonlight cools the shadows
            ctx.fillStyle = `rgba(20,30,60,${0.1 * (1 - daylight)})`;
            ctx.fillRect(0, 0, W, H);
        }

        // Vignette — barely there in daylight, heavy at night.
        const vig = 0.16 + 0.26 * (1 - daylight);
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34,
                                           W / 2, H / 2, Math.max(W, H) * 0.75);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(6,6,10,${vig})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        return this;
    }

    /**
     * Full frame.
     * @param {object} state { zone, player, clock, weather, particles, fires, interact, look, toolEmoji, entities }
     * @param {number} dt
     */
    render(state, dt = 0) {
        this.time += dt;
        this.season = state.clock ? state.clock.season.key : "spring";
        setSun(state.clock ? state.clock.minute / 60 : 12, state.clock ? state.clock.daylight : 1);
        const ctx = this.ctx;
        ctx.fillStyle = "#0a0c10";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.drawGround(state.zone);
        this.drawWater(state.zone);
        this.drawObjects(state);
        if (state.particles) state.particles.draw(ctx, this.camera);
        if (state.player.sleeping) {
            const s = this.camera.worldToScreen(state.player.x, state.player.y);
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.scale(this.camera.zoom, this.camera.zoom);
            drawSleeping(ctx, this.time);
            ctx.restore();
        }
        this.drawInteractHint(state.interact && state.interact.target, state.interact && state.interact.label);
        this.drawWeather(state.weather, dt);

        // --- lights ---------------------------------------------------------
        const cam = this.camera;
        this.lightMap.begin();
        if (state.fires) {
            for (const [key, fire] of state.fires) {
                if (!fire.lit) continue;
                const obj = state.zone.objects.find((o) => (o.id != null ? o.id : `${o.tx},${o.ty}`) === key);
                if (!obj || !cam.isVisible(obj.x, obj.y, 200)) continue;
                const s = cam.worldToScreen(obj.x, obj.y);
                this.lightMap.add(s.x, s.y, fire.lightRadius * cam.zoom,
                    { intensity: 0.55 + fire.intensity * 0.45, warmth: 0.9, flicker: 1 });
            }
        }
        // Underground the eye adjusts: a weak glow so galleries are readable
        // even without a torch (a torch is still far brighter).
        if (state.underground) {
            const s2 = cam.worldToScreen(state.player.x, state.player.y - 8);
            this.lightMap.add(s2.x, s2.y, 70 * cam.zoom, { intensity: 0.42, warmth: 0.35 });
        }
        if (state.playerLight > 0) {
            const s = cam.worldToScreen(state.player.x, state.player.y - 8);
            this.lightMap.add(s.x, s.y, state.playerLight * cam.zoom, { intensity: 0.8, warmth: 0.85, flicker: 1 });
        }
        for (const L of state.extraLights || []) {
            const s = cam.worldToScreen(L.x, L.y);
            this.lightMap.add(s.x, s.y, L.r * cam.zoom, { intensity: L.i || 0.7, warmth: L.w !== undefined ? L.w : 0.6 });
        }
        this.lightMap.render(ctx, {
            daylight: state.clock ? state.clock.daylight : 1,
            weather: state.weather,
            underground: !!(state.zone.def && state.zone.def.underground),
            time: this.time
        });

        this.grade(state.clock, state.weather);

        return this;
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
