/** Live wet ground, below footprints/props. Static terrain stays in the chunk cache. */
import { TILE_SIZE } from "../world/tiles.js";
import { receivesRain, surfacePuddle, clampWet, puddleRadius } from "../world/surface.js";

function puddlePath(ctx, x, y, rx, ry, phase) {
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
        const a = i / 24 * Math.PI * 2;
        const wobble = puddleRadius(a, phase);
        const px = x + Math.cos(a) * rx * wobble;
        const py = y + Math.sin(a) * ry * wobble;
        if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
}

export function drawWetGround(ctx, cam, state, time) {
    const wet = clampWet(state.groundWet);
    if (state.underground || wet < 0.005) return;
    const { zone } = state;
    const z = cam.zoom;
    const winter = state.clock?.season.key === "winter";
    const raining = state.weather === "rain" || state.weather === "storm";
    const x0 = Math.max(0, Math.floor(cam.x / TILE_SIZE) - 1);
    const y0 = Math.max(0, Math.floor(cam.y / TILE_SIZE) - 1);
    const x1 = Math.min(zone.map.w, Math.ceil((cam.x + cam.viewW) / TILE_SIZE) + 1);
    const y1 = Math.min(zone.map.h, Math.ceil((cam.y + cam.viewH) / TILE_SIZE) + 1);
    ctx.save();
    // One weather wash, not rectangles laid over the continuous coast.
    ctx.globalAlpha = wet * (winter ? 0.12 : 0.17);
    ctx.fillStyle = winter ? "#65777d" : "#292d2c";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (let ty = y0; ty < y1; ty++) for (let tx = x0; tx < x1; tx++) {
        const id = zone.map.get(tx, ty);
        if (!receivesRain(id)) continue;
        const p = surfacePuddle(zone, tx, ty, wet);
        if (!p) continue;
        const s = cam.worldToScreen(p.x, p.y);
        const rx = p.rx * z, ry = p.ry * z;
        // Muddy/slushy fringe follows the same contour as its pool.
        ctx.globalAlpha = wet * 0.45;
        ctx.fillStyle = winter ? "#929d9c" : "#443b30";
        puddlePath(ctx, s.x, s.y, rx + 2 * z, ry + z, p.phase); ctx.fill();
        ctx.globalAlpha = Math.min(0.8, p.amount * 2);
        ctx.fillStyle = winter ? "#a9c8d9" : "#526771";
        puddlePath(ctx, s.x, s.y, rx, ry, p.phase); ctx.fill();
        ctx.save(); ctx.clip();
        // Broken reflection of the sky, not a blue tile of permanent water.
        ctx.globalAlpha = wet * 0.32;
        ctx.fillStyle = "#b9cbd3";
        ctx.beginPath(); ctx.ellipse(s.x - rx * 0.12, s.y - ry * 0.32, rx * 0.72, ry * 0.38, 0, 0, Math.PI * 2); ctx.fill();
        if (winter) {
            ctx.globalAlpha = 0.75;
            ctx.strokeStyle = "#e7f4fa"; ctx.lineWidth = Math.max(0.7, z * 0.35);
            ctx.beginPath();
            ctx.moveTo(s.x - rx * 0.6, s.y - ry * 0.7);
            ctx.lineTo(s.x - rx * 0.1, s.y); ctx.lineTo(s.x + rx * 0.2, s.y + ry * 0.7);
            ctx.moveTo(s.x - rx * 0.1, s.y); ctx.lineTo(s.x + rx * 0.55, s.y - ry * 0.4);
            ctx.stroke();
        } else if (raining) {
            const age = (time * 1.4 + p.phase * 7) % 1;
            ctx.globalAlpha = (1 - age) * wet * 0.55;
            ctx.strokeStyle = "#cfdee4"; ctx.lineWidth = Math.max(0.7, z * 0.4);
            ctx.beginPath(); ctx.ellipse(s.x, s.y, rx * age, ry * age, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
    }
    ctx.restore();
}
