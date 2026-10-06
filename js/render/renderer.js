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
import { paintTile, paintEdges, paintProp, paintFlames, paintSpitItem, setSun, setFireLights, setShadowOrigin, propHeight } from "./tilesart.js";
import { drawCharacter, drawSleeping } from "./character.js";
import { LightMap, LIGHT } from "./lighting.js";
import { itemEmoji } from "../sandbox/items.js";

/**
 * Occlusion fade. A hero who disappears behind a pine is a lost hero: the
 * player stops steering and starts guessing. So anything tall that covers
 * him goes part-way transparent — never off, because then the forest loses
 * its depth, and never instantly, because a popping tree is worse than a
 * hidden hero.
 */
export const OCCLUDE = {
    minHeight: 22,     // u — only things taller than the hero can hide him
    spread: 0.34,      // crown half-width as a fraction of the prop's height
    bodyHalf: 5,       // u — half the hero's own shoulders
    headroom: 6,       // u above the crown that still counts
    alpha: 0.35,       // how much of the prop is left when it covers him
    ramp: 2.2,         // how fast the fade reaches full across the overlap
    fadeIn: 6.5,       // 1/s — how fast it gets out of the way
    fadeOut: 3.0       // 1/s — and how slowly it comes back
};

/**
 * Water, in numbers. The baked ground gives the colour; everything here is
 * the movement on top of it. Phases are computed in WORLD space so a swell
 * crosses tile borders instead of restarting at every seam.
 */
export const WATER = {
    swellLines: 2,          // crests per tile
    swellSpeed: 0.45,       // 1/s — travel of the first crest
    swellSpeedStep: 0.2,    // each further crest travels a little faster
    swellKx: 0.055,         // world-space frequency, x
    swellKy: 0.085,         // world-space frequency, y
    swellDark: 0.13,        // α of the trough line
    swellLight: 0.12,       // α of the crest line
    glintRows: 2,           // specular dots per water tile
    caveTint: 0.55,         // α of the darkness over underground water
    glintA: 0.5,            // α of a glint at full daylight
    glintSize: 1.5,         // u
    glintSpeed: 1.9,        // 1/s — twinkle rate
    skyBandA: 0.09,         // α of the sky reflected off the far bank
    skyBandSteps: 4,        // soft steps of that reflection (no gradients)
    skyBandH: 0.5,          // fraction of a tile the reflection covers
    foamBase: 0.22,         // α of surf at rest
    foamPulse: 0.16,        // ± breathing of the surf
    foamSpeed: 1.6,         // 1/s
    foamWobble: 4.6,        // u — how far the foam line wanders
    foamSeg: 8,             // segments of the foam polyline
    foamFlecks: 3,          // specks of spray thrown past the foam line
    foamFleckA: 0.3,
    shelfA: 0.2,            // reserved: the shallow shelf is baked, see paintEdges
    fireStreakA: 0.4,       // α of a flame reflected in the water
    fireStreakSeg: 3,       // broken pieces of that reflection
    fireStreakLen: 0.5      // fraction of a tile each piece covers
};

/**
 * Weather, in numbers. Three depth layers so rain and snow have volume, all
 * of them world-anchored (they drift with the camera) and all drawn from
 * pools built once — zero allocation per frame.
 */
export const SKY = {
    layers: 3,
    rainPerLayer: [70, 54, 38],   // near → far
    rainLen: [16, 11, 7],         // px at zoom 1
    rainSpeed: [1500, 1080, 760], // px/s
    rainA: [0.42, 0.3, 0.2],
    rainW: [1.3, 1, 0.8],
    stormBoost: 2,              // more drops, harder slant in a storm
    rainSlant: 0.22,              // base lean, rad
    splashes: 26,                 // ground hits per frame
    splashA: 0.22,
    snowPerLayer: [70, 56, 40],
    snowSize: [2.6, 1.9, 1.3],
    snowSpeed: [78, 54, 36],
    snowSway: [26, 17, 10],       // px of side-to-side drift
    snowA: [0.85, 0.6, 0.4],
    fogBands: 6,
    fogA: 0.17,                    // α per band at the bottom of the screen
    fogTop: 0.26,                 // fog thins to this factor at the top
    fogSpeed: 9,                  // px/s drift of the nearest band
    lightningEvery: 7.5,          // s between strikes in a storm
    lightningA: 0.34
};

/** Grading, in numbers. */
export const GRADE = {
    vignetteDay: 0.14,
    vignetteNight: 0.26,
    sunWashA: 0.1
};

export class Renderer {
    constructor(canvas, camera) {
        // Weather pools: positions are fractions of the screen, generated once
        // from a fixed sequence so the sky looks random but never reallocates
        // and never flickers when the window is resized.
        this._sky = [];
        for (let l = 0; l < SKY.layers; l++) {
            const n = Math.max(SKY.rainPerLayer[l], SKY.snowPerLayer[l]);
            const arr = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                arr[i * 3] = frac(i * 0.754877 + l * 0.31);      // x
                arr[i * 3 + 1] = frac(i * 0.569840 + l * 0.17);  // y
                arr[i * 3 + 2] = frac(i * 0.123456 + l * 0.71);  // personal phase
            }
            this._sky.push(arr);
        }
        this._flash = 0;
        this._gradCache = { key: "", vignette: null, sun: null };
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
    drawWater(zone, daylight = 1, hour = 12, underground = false) {
        const cam = this.camera;
        const ctx = this.ctx;
        const t = this.time;
        const x0 = Math.floor(cam.x / TILE_SIZE) - 1, y0 = Math.floor(cam.y / TILE_SIZE) - 1;
        const x1 = Math.ceil((cam.x + cam.viewW) / TILE_SIZE) + 1;
        const y1 = Math.ceil((cam.y + cam.viewH) / TILE_SIZE) + 1;
        // Glints are the sun on the ripples: gold low in the sky, white at
        // noon, gone at night.
        const low = Math.max(0, 1 - Math.abs(hour - 13) / 6.5);
        const warm = Math.max(0, 1 - Math.min(Math.abs(hour - 7.5), Math.abs(hour - 18.5)) / 3);
        const glintA = WATER.glintA * daylight * (0.35 + low * 0.65);
        const glintCol = warm > 0.3 ? "255,228,168" : "255,255,255";
        ctx.save();
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                if (!zone.map.inBounds(tx, ty)) continue;
                const id = zone.map.get(tx, ty);
                const info = TILES[id];
                if (!info || !info.liquid) continue;
                const s = cam.worldToScreen(tx * TILE_SIZE, ty * TILE_SIZE);
                const z = cam.zoom, S = TILE_SIZE * z;
                const wx = tx * TILE_SIZE, wy = ty * TILE_SIZE;
                if (underground) {
                    // There is no sky down here: a mine puddle is black
                    // water with a sheen, not a bright blue square.
                    ctx.fillStyle = `rgba(10,16,24,${WATER.caveTint})`;
                    ctx.fillRect(s.x, s.y, S + 1, S + 1);
                    continue;
                }
                // Swell: crests travel across the whole body of water. The
                // phase is world-space, so nothing breaks at a tile seam.
                ctx.lineCap = "round";
                for (let k = 0; k < WATER.swellLines; k++) {
                    const sp = WATER.swellSpeed + k * WATER.swellSpeedStep;
                    const phase = t * sp + wx * WATER.swellKx + wy * WATER.swellKy + k * 1.7;
                    const yy = s.y + ((Math.sin(phase) * 0.5 + 0.5) * 0.66 + k * 0.2) * S;
                    const w = (0.4 + 0.3 * Math.abs(Math.cos(phase * 1.3))) * S;
                    const sx = s.x + (frac(Math.sin(tx * 12.9898 + ty * 78.233) * 43758.5453)) * 0.4 * S;
                    ctx.strokeStyle = k
                        ? `rgba(255,255,255,${WATER.swellLight})`
                        : `rgba(10,40,60,${WATER.swellDark})`;
                    ctx.lineWidth = Math.max(1, 1.2 * z);
                    ctx.beginPath();
                    ctx.moveTo(sx, yy);
                    ctx.quadraticCurveTo(sx + w * 0.5, yy - 1.6 * z, sx + w, yy + 0.4 * z);
                    ctx.stroke();
                }
                // Glints: short sparks that wink in and out on the crests.
                if (glintA > 0.02) {
                    for (let g = 0; g < WATER.glintRows; g++) {
                        const ph = t * WATER.glintSpeed + wx * 0.21 + wy * 0.37 + g * 2.3;
                        const tw = Math.sin(ph);
                        if (tw < 0.55) continue;
                        const gx = s.x + (0.2 + frac(Math.sin(tx * 3.7 + ty * 9.1 + g) * 1731.3) * 0.6) * S;
                        const gy = s.y + (0.2 + frac(Math.sin(tx * 8.3 + ty * 2.9 + g) * 917.7) * 0.6) * S
                                 + Math.sin(ph * 0.7) * 1.5 * z;
                        ctx.fillStyle = `rgba(${glintCol},${(glintA * (tw - 0.55) / 0.45).toFixed(3)})`;
                        ctx.fillRect(gx, gy, WATER.glintSize * z, Math.max(1, 0.8 * z));
                    }
                }
                // Fire reflected in the water: a broken warm streak that
                // wobbles with the swell. Night by the lake should look wet.
                for (const L of this._lights || []) {
                    const d = Math.hypot(L.x - (wx + 16), L.y - (wy + 16));
                    if (d > L.r * 0.9) continue;
                    const fade = (1 - d / (L.r * 0.9)) * WATER.fireStreakA * L.i * (1 - daylight * 0.8);
                    if (fade < 0.02) continue;
                    const ls = cam.worldToScreen(L.x, L.y);
                    ctx.fillStyle = `rgba(255,186,96,${fade.toFixed(3)})`;
                    for (let i = 0; i < WATER.fireStreakSeg; i++) {
                        const f = (i + 0.5) / WATER.fireStreakSeg;
                        const yy = s.y + f * S;
                        const sway = Math.sin(t * 2.1 + f * 6 + wy * 0.2) * 2.2 * z;
                        const len = WATER.fireStreakLen * S * (0.5 + 0.5 * Math.abs(Math.cos(t + f * 3)));
                        ctx.fillRect(ls.x - len / 2 + sway, yy, len, Math.max(1, 1.1 * z));
                    }
                }
                // The bank reflects the sky: a pale band hugging the shore on
                // the near side of land that sits above this tile.
                const above = TILES[zone.map.get(tx, ty - 1)];
                if (above && !above.liquid) {
                    const steps = WATER.skyBandSteps;
                    for (let i = 0; i < steps; i++) {
                        const a = WATER.skyBandA * daylight * (1 - i / steps);
                        ctx.fillStyle = `rgba(214,232,246,${a.toFixed(3)})`;
                        ctx.fillRect(s.x, s.y + (i / steps) * S * WATER.skyBandH,
                                     S, S * WATER.skyBandH / steps + 1);
                    }
                }
                // Puddles (three or four land neighbours) get no surf at all:
                // waves need a body of water to come from.
                let landAround = 0;
                for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nb = TILES[zone.map.get(tx + ddx, ty + ddy)];
                    if (!nb || !nb.liquid) landAround++;
                }
                if (landAround >= 3) continue;

                // Surf. The foam follows the shoreline and rounds off inner
                // corners instead of stopping dead at the tile border.
                const neighbours = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                for (const [dx, dy] of neighbours) {
                    const n = zone.map.get(tx + dx, ty + dy);
                    const ni = TILES[n];
                    if (!ni || ni.liquid) continue;
                    // Every stretch of shore breathes at its own rate, so the
                    // waterline never reads as a drawn rectangle.
                    const seed = frac(Math.sin(tx * 41.3 + ty * 17.7) * 3571.9);
                    const pulse = WATER.foamBase + WATER.foamPulse
                        * Math.sin(t * WATER.foamSpeed * (0.7 + seed * 0.6) + tx * 0.8 + ty * 0.5);
                    const amp = WATER.foamWobble * (0.6 + seed * 0.8);
                    ctx.strokeStyle = `rgba(255,255,255,${pulse.toFixed(3)})`;
                    ctx.lineWidth = Math.max(1, 1.6 * z);
                    ctx.beginPath();
                    const seg = WATER.foamSeg;
                    for (let i = 0; i <= seg; i++) {
                        const f = i / seg;
                        // World-space wobble: the line continues into the next
                        // tile instead of restarting at the seam.
                        const u = dy ? tx + f : ty + f, v = dy ? ty : tx;
                        const wob = (Math.sin(t * 1.3 + u * 3.1 + v * 2.3) * 0.34
                                   + Math.sin(t * 0.7 + u * 7.9 + v * 1.1) * 0.16 + 0.5) * amp * z;
                        let X, Y;
                        if (dy < 0) { X = s.x + f * S; Y = s.y + 1.5 * z + wob; }
                        else if (dy > 0) { X = s.x + f * S; Y = s.y + S - 1.5 * z - wob; }
                        else if (dx < 0) { X = s.x + 1.5 * z + wob; Y = s.y + f * S; }
                        else { X = s.x + S - 1.5 * z - wob; Y = s.y + f * S; }
                        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
                    }
                    ctx.stroke();
                    // Spray: a few specks thrown past the line of foam.
                    ctx.fillStyle = `rgba(255,255,255,${WATER.foamFleckA})`;
                    for (let i = 0; i < WATER.foamFlecks; i++) {
                        const f = frac(seed * 7 + i * 0.37);
                        const life = frac(t * 0.9 + seed * 5 + i * 0.41);
                        if (life > 0.5) continue;
                        const push = (1.5 + life * 5) * z;
                        let X, Y;
                        if (dy < 0) { X = s.x + f * S; Y = s.y + push; }
                        else if (dy > 0) { X = s.x + f * S; Y = s.y + S - push; }
                        else if (dx < 0) { X = s.x + push; Y = s.y + f * S; }
                        else { X = s.x + S - push; Y = s.y + f * S; }
                        ctx.fillRect(X, Y, Math.max(1, z), Math.max(1, z));
                    }
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
    drawObjects(state, dt = 0) {
        const { zone, player, fires } = state;
        const cam = this.camera;
        const ctx = this.ctx;
        const drawables = [];

        for (const obj of zone.objects) {
            if (obj.removed) continue;
            if (!cam.isVisible(obj.x, obj.y, 70)) continue;
            drawables.push({ y: obj.y, x: obj.x, ord: drawables.length, kind: "prop", obj });
        }
        for (const ent of (state.entities || [])) {
            if (!cam.isVisible(ent.x, ent.y, 70)) continue;
            drawables.push({ y: ent.y, x: ent.x, ord: drawables.length, kind: "entity", obj: ent });
        }
        if (!player.sleeping) {
            drawables.push({ y: player.y, x: player.x, ord: drawables.length, kind: "player", obj: player });
        }

        // Painter's order. The key is the foot line, not the centre, and ties
        // are broken by x and then by identity: two props on the same row used
        // to swap places between frames (sort is only stable for equal keys of
        // the same shape) and the overlap flickered.
        drawables.sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.ord - b.ord));
        this.stats.propsDrawn = drawables.length;

        for (const d of drawables) {
            const o = d.obj;
            if (d.kind === "prop") this._occlude(o, player, dt);
            const s = cam.worldToScreen(o.x, o.y);
            ctx.save();
            ctx.translate(Math.round(s.x), Math.round(s.y));
            ctx.scale(cam.zoom, cam.zoom);
            if (d.kind === "prop") {
                if (o._fade > 0) ctx.globalAlpha = 1 - (1 - OCCLUDE.alpha) * o._fade;
                paintProp(ctx, o, this.time, this.season);
                ctx.globalAlpha = 1;
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
                setShadowOrigin(o.x, o.y);
                drawCharacter(ctx, {
                    dir: o.dir, phase: o.anim, gait: o.gait, runBlend: o.runBlend,
                    slant: o.slant, moving: o.moving, look: state.look,
                    actionTimer: o.actionTimer, tool: state.tool, idleTime: this.time,
                    wading: this._inWater(state.zone, o.x, o.y)
                });
            } else {
                setShadowOrigin(o.x, o.y);
                drawCharacter(ctx, {
                    wading: this._inWater(state.zone, o.x, o.y),
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

    /**
     * This frame's point lights in WORLD coordinates, pooled. Used twice:
     * by the shadow painter (before the objects layer) and by the light map
     * (after it, converted to screen space), so a fire that lights the ground
     * is always the same fire that throws the shadows.
     */
    _collectLights(state) {
        const out = this._lights || (this._lights = []);
        let n = 0;
        const push = (x, y, r, i) => {
            let L = out[n];
            if (!L) { L = { x: 0, y: 0, r: 0, i: 1, phase: 0 }; out[n] = L; }
            L.x = x; L.y = y; L.r = r; L.i = i;
            // Flicker phase keyed to the world, so two fires are out of step
            // with each other and neither changes beat when the camera moves.
            L.phase = (x * 0.013 + y * 0.029) % 6.283;
            n++;
        };
        if (state.fires) {
            for (const [key, fire] of state.fires) {
                if (!fire.lit) continue;
                const obj = state.zone.objects.find((o) => (o.id != null ? o.id : `${o.tx},${o.ty}`) === key);
                if (!obj) continue;
                push(obj.x, obj.y, fire.lightRadius, 0.55 + fire.intensity * 0.45);
            }
        }
        if (state.playerLight > 0) push(state.player.x, state.player.y - 8, state.playerLight, 0.8);
        for (const L of state.extraLights || []) push(L.x, L.y, L.r, L.i || 0.7);
        out.length = n;
        setFireLights(out);
        return out;
    }

    /** Is this world point standing in water? (Used for the waterline.) */
    _inWater(zone, x, y) {
        if (!zone || !zone.map) return false;
        const info = TILES[zone.map.get(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))];
        return !!(info && info.liquid);
    }

    /**
     * Does this prop stand in front of the hero and cover him? Result is
     * eased into `obj._fade` (0..1) so the prop never pops.
     */
    _occlude(obj, player, dt) {
        const tall = propHeight(obj.kind, obj.size || 1);
        let want = 0;
        if (tall >= OCCLUDE.minHeight && obj.y > player.y) {
            const dx = Math.abs(obj.x - player.x);
            const dy = obj.y - player.y;                 // prop is in front
            // A crown is as wide as the tree is tall, roughly; the overlap
            // that matters is crown half-width plus the hero's shoulders.
            const reach = tall * OCCLUDE.spread + OCCLUDE.bodyHalf;
            // The hero's head reaches ~26 u up; the crown has to be above it.
            if (dx < reach && dy < tall + OCCLUDE.headroom) {
                want = Math.min(1, (1 - dx / reach) * OCCLUDE.ramp);
            }
        }
        const cur = obj._fade || 0;
        const rate = (want > cur ? OCCLUDE.fadeIn : OCCLUDE.fadeOut) * Math.max(0, dt);
        obj._fade = rate >= 1 ? want : cur + (want - cur) * rate;
        return obj._fade;
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

    /**
     * Weather, in screen space but anchored to the world: every layer is
     * offset by the camera times its own parallax, so rain does not slide
     * sideways when the hero walks. Pools are built in the constructor;
     * this draws from them and allocates nothing.
     */
    /**
     * Cached full-screen gradients. Rebuilt only when the canvas changes
     * size — `createRadialGradient` per frame is an allocation per frame.
     */
    _grads(W, H) {
        const key = W + "x" + H;
        const c = this._gradCache;
        if (c.key === key || !this.ctx.createRadialGradient) return c;
        const g = this.ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34,
                                                W / 2, H / 2, Math.max(W, H) * 0.75);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, "rgb(6,6,10)");
        const sun = this.ctx.createLinearGradient(0, 0, W * 0.9, H);
        sun.addColorStop(0, `rgba(255,236,186,${GRADE.sunWashA})`);
        sun.addColorStop(0.55, "rgba(255,236,186,0)");
        c.key = key; c.vignette = g; c.sun = sun;
        return c;
    }

    _vignette(W, H) { return this._grads(W, H).vignette || "rgba(0,0,0,0)"; }

    _sunWash(W, H) { return this._grads(W, H).sun || "rgba(0,0,0,0)"; }

    drawWeather(weather, dt, windAngle = 0) {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;
        const cam = this.camera;
        const t = this.time;
        const wind = Math.cos(windAngle);        // -1 … 1, from the west or east

        if (weather === "rain" || weather === "storm") {
            const storm = weather === "storm";
            const boost = storm ? SKY.stormBoost : 1;
            const slant = (SKY.rainSlant + (storm ? 0.16 : 0)) * (0.4 + wind * 0.6);
            ctx.save();
            ctx.lineCap = "round";
            for (let l = 0; l < SKY.layers; l++) {
                const pool = this._sky[l];
                const n = Math.round(SKY.rainPerLayer[l] * boost);
                const par = 0.25 + l * 0.18;                 // far layers lag behind
                const len = SKY.rainLen[l] * (storm ? 1.25 : 1);
                const sp = SKY.rainSpeed[l] * (storm ? 1.2 : 1);
                ctx.strokeStyle = `rgba(178,202,230,${SKY.rainA[l] * (storm ? 1.15 : 1)})`;
                ctx.lineWidth = SKY.rainW[l];
                ctx.beginPath();
                for (let i = 0; i < n; i++) {
                    const px = pool[i * 3], py = pool[i * 3 + 1], ph = pool[i * 3 + 2];
                    const y = mod(py * H + t * sp, H + len) - len;
                    const x = mod(px * W - cam.x * par + y * slant + ph * 13, W);
                    ctx.moveTo(x, y);
                    ctx.lineTo(x - len * slant, y + len);
                }
                ctx.stroke();
            }
            // Splashes: the rain actually lands somewhere.
            ctx.strokeStyle = `rgba(214,232,246,${SKY.splashA})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            const pool0 = this._sky[0];
            for (let i = 0; i < SKY.splashes; i++) {
                const ph = pool0[i * 3 + 2];
                const life = frac(t * 2.2 + ph * 7);
                if (life > 0.45) continue;
                const r = 1 + life * 5;
                const x = mod(pool0[i * 3] * W - cam.x * 0.4 + ph * 211, W);
                const y = mod(pool0[i * 3 + 1] * H + Math.floor(t * 2.2 + ph * 7) * 137, H);
                ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
            }
            ctx.stroke();
            // Lightning: a short wash over the whole frame, then darkness.
            if (storm) {
                const since = frac(t / SKY.lightningEvery) * SKY.lightningEvery;
                if (since < 0.22) {
                    const k = (1 - since / 0.22) * (since < 0.07 ? 1 : 0.5);
                    ctx.fillStyle = `rgba(226,238,255,${(SKY.lightningA * k).toFixed(3)})`;
                    ctx.fillRect(0, 0, W, H);
                }
            }
            ctx.restore();
        } else if (weather === "snow") {
            ctx.save();
            for (let l = 0; l < SKY.layers; l++) {
                const pool = this._sky[l];
                const n = SKY.snowPerLayer[l];
                const par = 0.2 + l * 0.16;
                const size = SKY.snowSize[l];
                ctx.fillStyle = `rgba(255,255,255,${SKY.snowA[l]})`;
                for (let i = 0; i < n; i++) {
                    const px = pool[i * 3], py = pool[i * 3 + 1], ph = pool[i * 3 + 2];
                    const y = mod(py * H + t * SKY.snowSpeed[l], H + size) - size;
                    const sway = Math.sin(t * (0.5 + ph) + ph * 11) * SKY.snowSway[l];
                    const x = mod(px * W - cam.x * par + sway + wind * t * 14 + ph * 29, W);
                    ctx.fillRect(x, y, size, size);
                }
            }
            ctx.restore();
        } else if (weather === "fog") {
            // Fog lies in the hollows: thick along the bottom of the frame,
            // thin at the top, in slow bands rather than one flat veil.
            ctx.save();
            for (let b = 0; b < SKY.fogBands; b++) {
                const f = b / (SKY.fogBands - 1);
                const bandY = H * (0.18 + f * 0.9);
                const bandH = H * (0.26 + f * 0.2);
                const depth = SKY.fogTop + (1 - SKY.fogTop) * f;
                const drift = mod(-cam.x * (0.1 + f * 0.2) + t * SKY.fogSpeed * (0.4 + f), W * 2) - W * 0.5;
                ctx.fillStyle = `rgba(198,204,208,${(SKY.fogA * depth).toFixed(3)})`;
                ctx.beginPath();
                ctx.moveTo(-W * 0.5, bandY + bandH);
                for (let i = 0; i <= 8; i++) {
                    const x = -W * 0.5 + (i / 8) * W * 2;
                    const y = bandY + Math.sin((x + drift) * 0.004 + b * 1.7) * bandH * 0.3
                            + Math.sin((x + drift) * 0.011 + b) * bandH * 0.12;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(W * 1.5, bandY + bandH);
                ctx.closePath(); ctx.fill();
            }
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
            // Cached: building a gradient every frame is an allocation.
            ctx.fillStyle = this._sunWash(W, H);
            ctx.globalAlpha = noon;
            ctx.fillRect(0, 0, W, H);
            ctx.globalAlpha = 1;
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
        // (The cool wash the night used to get lives in lighting.js now, as
        // moonlight: it belongs with the rest of the light budget.)

        // Vignette — barely there in daylight, present but gentle at night;
        // the old 0.42 at midnight ate the corners of the frame whole.
        const vig = GRADE.vignetteDay + (GRADE.vignetteNight - GRADE.vignetteDay) * (1 - daylight);
        ctx.fillStyle = this._vignette(W, H);
        ctx.globalAlpha = vig;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
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

        // Point lights are collected BEFORE the objects layer: props and
        // characters read them to throw shadows away from the flame, and the
        // light map re-uses the same list afterwards in screen space.
        this._collectLights(state);
        this.drawGround(state.zone);
        this.drawWater(state.zone,
                       state.clock ? state.clock.daylight : 1,
                       state.clock ? state.clock.minute / 60 : 12,
                       !!state.underground);
        if (state.tracks) state.tracks.draw(ctx, this.camera);
        this.drawObjects(state, dt);
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
        this.drawWeather(state.weather, dt, state.windAngle || 0);

        // --- lights ---------------------------------------------------------
        // The very list the shadows were thrown from, now in screen space.
        const cam = this.camera;
        this.lightMap.begin();
        for (const L of this._lights || []) {
            if (!cam.isVisible(L.x, L.y, 200)) continue;
            const s = cam.worldToScreen(L.x, L.y);
            this.lightMap.add(s.x, s.y, L.r * cam.zoom,
                { intensity: L.i, warmth: 0.88, flicker: 1, phase: L.phase || 0 });
        }
        // Underground the eye adjusts: a weak glow so galleries are readable
        // even without a torch (a torch is still far brighter).
        if (state.underground) {
            const s2 = cam.worldToScreen(state.player.x, state.player.y - 8);
            // With a torch in hand the eye stops straining: the ambient glow
            // backs off so the flame is what lights the gallery.
            const eye = LIGHT.presets.caveEye;
            const dim = state.playerLight > 0 ? eye.torchDim : 1;
            this.lightMap.addPreset(s2.x, s2.y, "caveEye", cam.zoom, eye.i * dim);
        }
        this.lightMap.render(ctx, {
            hour: state.clock ? state.clock.minute / 60 : 12,
            daylight: state.clock ? state.clock.daylight : 1,
            weather: state.weather,
            underground: !!(state.zone.def && state.zone.def.underground),
            torch: state.playerLight > 0,
            time: this.time,
            day: state.clock ? state.clock.day : 0
        });

        this.grade(state.clock, state.weather);

        return this;
    }
}

function frac(v) { return v - Math.floor(v); }

function mod(v, m) { const r = v % m; return r < 0 ? r + m : r; }

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
