/** Natural ground is one continuous surface, baked in world coordinates.
 * No overlapping per-tile coastline/cliff rectangles. Built floors keep their
 * authored square geometry; water animation queries the very same field.
 */
import { T, tileInfo } from "../world/tiles.js";
import { groundPalette, paintTile, paintSnowGround } from "./tilesart.js";
import { woodedEdge } from "../world/edges.js";
import { receivesSnow } from "../world/surface.js";
const built = new Set([T.PLANK, T.COBBLE, T.FARM, T.FARM_WET]);
const parse = (s) => s.startsWith("#") ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) : s.match(/\d+/g).slice(0, 3).map(Number);
const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

/** Continuous optical depth: do not derive colour from the solid/not-solid threshold. */
export function seaColour(distance) {
    const stops = [[0, [160, 177, 146]], [20, [112, 170, 161]], [52, [64, 143, 160]],
        [96, [43, 107, 139]], [180, [29, 67, 99]]];
    const d = Math.max(0, distance || 0);
    for (let i = 1; i < stops.length; i++) if (d <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i];
        let t = (d - a) / (b - a); t = t * t * (3 - 2 * t);
        return ca.map((v, k) => v + (cb[k] - v) * t);
    }
    return stops[stops.length - 1][1].slice();
}

export function terrainColour(field, wx, wy, season, palette) {
    const s = field.sample(wx, wy), water = tileInfo(s.id).liquid;
    let r = 0, g = 0, b = 0, sum = 0;
    for (const [id, w] of s.weights) {
        if (tileInfo(id).liquid !== water || (id === T.CLIFF) !== (s.id === T.CLIFF)) continue;
        const c = palette[id]; r += c[0] * w; g += c[1] * w; b += c[2] * w; sum += w;
    }
    if (sum) { r /= sum; g /= sum; b /= sum; }
    else [r, g, b] = palette[s.id];
    const grain = field.noise(wx, wy, 7, 81) - 0.5;
    let tone = grain * 7 + (field.noise(wx, wy, 57, 82) - 0.5) * 5;
    if (water) {
        if (field.biome === "shore") [r, g, b] = seaColour(s.coast);
        tone *= 0.45;
        if (s.water < 0.58) {
            const foam = (0.58 - s.water) / 0.08 * 0.28;
            r += (215 - r) * foam; g += (225 - g) * foam; b += (202 - b) * foam;
        }
    } else {
        // Actual elevation also affects walking uphill. Hillshade uses the
        // same world-space normal and cannot restart at a chunk edge.
        const dx = (field.elevation(wx + 6, wy) - field.elevation(wx - 6, wy)) / 12;
        const dy = (field.elevation(wx, wy + 6) - field.elevation(wx, wy - 6)) / 12;
        tone += Math.max(-16, Math.min(16, (-dx - dy) * 48));
        if (s.cliff > 0.05 && s.cliff < 0.5) tone -= s.cliff * 23;
        if (s.id === T.CLIFF) {
            const edge = Math.min(wx, wy, field.map.widthPx - wx, field.map.heightPx - wy) < 288;
            if (edge && woodedEdge(field.biome)) {
                [r, g, b] = ["ashfall", "ruins"].includes(field.biome) ? [91, 87, 64] : [72, 88, 55];
            }
            const rock = field.noise(wx, wy, 42, 215);
            tone += Math.sin(wy * 0.15 + rock * 9) * 6;
            // Light rim and dark exposed face follow the contour, not tile rows.
            const below = field.sample(wx, wy + 5).cliff;
            const above = field.sample(wx, wy - 4).cliff;
            const face = Math.max(0, Math.min(1, (s.cliff - below) * 7));
            const rim = Math.max(0, Math.min(1, (0.62 - above) * 6));
            tone += 5 - face * 34 + rim * 18;
        }
        if (season === "winter" && (receivesSnow(s.id) || s.id === T.CLIFF)) {
            const cover = Math.max(0.25, field.noise(wx, wy, 70, 553) * 0.8);
            r += (219 - r) * cover; g += (230 - g) * cover; b += (232 - b) * cover;
        }
        if (s.id === T.SAND && season !== "winter" && s.coast > -18) {
            const wet = Math.max(0, Math.min(1, 1 + s.coast / 18)) * 0.65;
            r += (153 - r) * wet; g += (144 - g) * wet; b += (105 - b) * wet;
        } else if (s.water > 0.12) tone -= s.water * 27;
    }
    return [clamp(r + tone), clamp(g + tone), clamp(b + tone)];
}

export function bakeTerrain(ctx, zone, cx, cy, size, season) {
    const field = zone.terrain, ox = cx * size, oy = cy * size;
    const palette = Object.keys(T).reduce((p, k) => { p[T[k]] = parse(groundPalette(T[k], season)[0]); return p; }, {});
    const pixels = ctx.createImageData(size, size), data = pixels.data;
    const step = 2;
    for (let y = 0; y < size; y += step) for (let x = 0; x < size; x += step) {
        const c = terrainColour(field, ox + x + 1, oy + y + 1, season, palette);
        for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) {
            const at = ((y + dy) * size + x + dx) * 4;
            data[at] = c[0]; data[at + 1] = c[1]; data[at + 2] = c[2]; data[at + 3] = 255;
        }
    }
    ctx.putImageData(pixels, 0, 0);
    // Ground details distributed in world space, never clipped to a tile rim.
    for (let y = ((3 - oy) % 9 + 9) % 9; y < size; y += 9) for (let x = ((3 - ox) % 11 + 11) % 11; x < size; x += 11) {
        const wx = ox + x, wy = oy + y, v = field.noise(wx, wy, 3, 778);
        const s = field.sample(wx, wy);
        if (tileInfo(s.id).liquid || s.id === T.CLIFF || built.has(s.id) || v < 0.63) continue;
        if (zone.def.biome === "shore" && s.id === T.SAND && season !== "winter") {
            const wrack = s.coast > -42 && s.coast < -12;
            if (wrack && v > 0.76) {
                ctx.strokeStyle = "rgba(78,84,45,0.55)"; ctx.lineWidth = 0.7;
                ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x, y - 1.4); ctx.lineTo(x + 4, y + 0.5); ctx.stroke();
            } else if (v > 0.86) {
                ctx.fillStyle = "#eee0b7";
                ctx.beginPath(); ctx.ellipse(x, y, 1.6, 1, v * 3, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "#b9a57c"; ctx.fillRect(x, y - 0.8, 0.5, 1.6);
            }
        }
        const living = [T.GRASS, T.MEADOW, T.MOSS, T.PINE_FLOOR, T.GRASS_DRY].includes(s.id);
        ctx.fillStyle = season === "winter" ? "rgba(242,248,251,0.32)" : living ? "rgba(49,65,28,0.22)" : "rgba(22,21,18,0.14)";
        ctx.fillRect(x + v * 4, y - v * 3, living ? 1 : 2, living ? 2 + v * 2 : 1);
    }
    for (let y = 0; y < size; y += 32) for (let x = 0; x < size; x += 32) {
        const tx = (ox + x) / 32, ty = (oy + y) / 32, id = zone.map.get(tx, ty);
        if (!built.has(id)) continue;
        paintTile(ctx, id, x, y, 32, tx, ty, season, zone.map);
        if (season === "winter") paintSnowGround(ctx, id, x, y, 32, tx, ty);
    }
}

export function drawTerrainWater(ctx, zone, camera, time, daylight) {
    const b = { left: camera.x - 16, top: camera.y - 16, right: camera.x + camera.viewW + 16, bottom: camera.y + camera.viewH + 16 }, z = camera.zoom;
    ctx.save();
    ctx.strokeStyle = `rgba(179,219,215,${0.08 + daylight * 0.12})`; ctx.lineWidth = Math.max(0.7, z * 0.45);
    ctx.beginPath();
    for (let y = Math.floor(b.top / 13) * 13; y <= b.bottom; y += 13) {
        for (let x = Math.floor(b.left / 24) * 24; x <= b.right; x += 24) {
            const xx = x + Math.sin(y * 0.14 + time * 0.6) * 6;
            const yy = y + Math.sin(x * 0.027 + time * 0.7) * 2;
            if (!tileInfo(zone.terrain.sample(xx, yy).id).liquid || !tileInfo(zone.terrain.sample(xx + 9, yy).id).liquid) continue;
            const p = camera.worldToScreen(xx, yy);
            ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + (5 + Math.sin(time + x) * 3) * z, p.y - z * 0.4);
        }
    }
    ctx.stroke(); ctx.restore();
}
