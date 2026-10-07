/** CPU mesh prototype, isolated from the production chunk renderer.
 * Mesh rows and objects are sorted by ground depth so an elevated terrace
 * can hide a walker behind it; objects are NOT pasted over the finished map. */
import { RELIEF, RELIEF_PROPS } from "../world/relief.js";
import { drawCharacter } from "./character.js";
import { paintProp, setSun, setFireLights } from "./tilesart.js";
export const RELIEF_OBJECTS = RELIEF_PROPS;
export function reliefMesh(patch) {
    const mesh = [], step = 8;
    for (let y = 0; y < RELIEF.height; y += step) for (let x = 0; x < RELIEF.width; x += step) {
        const xy = [[x, y], [x + step, y], [x + step, y + step], [x, y + step]];
        const heights = xy.map(([a, b]) => patch.heightAt(a, b));
        const cliff = Math.max(...heights) - Math.min(...heights) > 8;
        const dx = (heights[1] - heights[0] + heights[2] - heights[3]) / (step * 2);
        const dy = (heights[3] - heights[0] + heights[2] - heights[1]) / (step * 2);
        const grain = Math.sin(x * 1.3 + y * 0.87) * 3;
        const light = cliff ? -8 + grain : Math.max(-32, Math.min(28, (-dx - dy) * 42)) + grain;
        const ramp = x >= RELIEF.ramp.left && x < RELIEF.ramp.right && y >= RELIEF.ramp.top;
        const base = cliff ? [117, 105, 85] : ramp ? [163, 142, 100] : [120, 142, 82];
        const colour = `rgb(${base.map((v) => Math.round(v + light)).join(",")})`;
        mesh.push({ y: y + step * 0.5, points: xy.map(([a, b]) => patch.project(a, b)), colour });
    }
    return mesh;
}
export function drawRelief(ctx, patch, walker, { mesh = reliefMesh(patch), collected = false, guides = true } = {}) {
    const width = ctx.canvas.width, height = ctx.canvas.height;
    ctx.fillStyle = "#283632"; ctx.fillRect(0, 0, width, height);
    const zoom = Math.min((width - 48) / RELIEF.width, (height - 90) / (RELIEF.height * RELIEF.scaleY));
    ctx.save(); ctx.translate((width - RELIEF.width * zoom) / 2, 55); ctx.scale(zoom, zoom);
    setSun(11, 1); setFireLights([]);
    const objects = RELIEF_OBJECTS.filter((o) => !collected || !o.pickup);
    // Props' art extends a few pixels in front of its ground anchor (boots,
    // buried rock base). Draw after that footprint, not halfway through it.
    const drawables = [...mesh.map((face) => ({ y: face.y, face })), ...objects.map((obj) => ({ y: obj.y + 8, obj })), { y: walker.y + 8, player: true }];
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) {
        if (d.face) {
            ctx.fillStyle = d.face.colour; ctx.beginPath();
            d.face.points.forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
            ctx.closePath(); ctx.fill();
        } else {
            const o = d.player ? walker : d.obj, p = patch.project(o.x, o.y);
            ctx.save(); ctx.translate(p.x, p.y);
            if (d.player) drawCharacter(ctx, { dir: walker.dir, phase: walker.phase, gait: walker.gait, idleTime: walker.time, tool: "knife" });
            else paintProp(ctx, o, walker.time);
            ctx.restore();
        }
    }
    if (guides) {
        const p = patch.project(walker.x, walker.y), z = patch.heightAt(walker.x, walker.y);
        ctx.strokeStyle = "#ecd98a"; ctx.lineWidth = 0.7; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(p.x + 13, p.y); ctx.lineTo(p.x + 13, p.y + z); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#f4e2a8"; ctx.font = "10px monospace";
        ctx.fillText(`h=${z.toFixed(1)}`, p.x + 17, p.y + z * 0.5);
    }
    ctx.restore();
}
