/** CPU mesh prototype, isolated from the production chunk renderer.
 * Mesh rows and objects are sorted by ground depth so an elevated terrace
 * can hide a walker behind it; objects are NOT pasted over the finished map. */
import { rainPoolAt } from "../world/surface.js";
import { RELIEF_STEPS } from "../dev/relief-guide.js";
import { RELIEF, RELIEF_PROPS } from "../world/relief.js";
import { drawCharacter } from "./character.js";
import { paintProp, paintFlames, setSun, setFireLights } from "./tilesart.js";
export const RELIEF_OBJECTS = RELIEF_PROPS;
export function reliefMesh(patch, { season = "spring", wet = 0, zone = null, freezing = false } = {}) {
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
        let base = cliff ? [117, 105, 85] : ramp ? [163, 142, 100] : [120, 142, 82];
        if (!cliff && season === "winter") base = [206, 217, 217];
        if (!cliff && wet > 0) base = base.map((c) => c * (1 - wet * 0.16));
        const pool = !cliff && zone && wet > 0.22 && rainPoolAt(zone, x + 4, y + 4, wet);
        if (pool) base = freezing ? [157, 189, 204] : [78, 106, 115];
        const colour = `rgb(${base.map((v) => Math.round(v + light)).join(",")})`;
        mesh.push({ ice: !!pool && freezing, y: y + step * 0.5, points: xy.map(([a, b]) => patch.project(a, b)), colour });
    }
    return mesh;
}
export function drawRelief(ctx, patch, walker, { mesh = reliefMesh(patch), collected = false, guides = true, routeStep = null, objects: suppliedObjects = null, character = null, fires = null, hour = 11, daylight = 1, season = "spring", tracks = null, view = null } = {}) {
    const width = ctx.canvas.width, height = ctx.canvas.height;
    ctx.fillStyle = "#283632"; ctx.fillRect(0, 0, width, height);
    view = view || reliefView(width, height);
    const { zoom } = view;
    ctx.save(); ctx.translate(view.x, view.y); ctx.scale(zoom, zoom);
    setSun(hour, daylight); setFireLights([]);
    const objects = suppliedObjects || RELIEF_OBJECTS.filter((o) => !collected || !o.pickup);
    // Props' art extends a few pixels in front of its ground anchor (boots,
    // buried rock base). Draw after that footprint, not halfway through it.
    const drawables = [...mesh.map((face) => ({ y: face.y, face })), ...objects.map((obj) => ({ y: obj.y + 8, obj })), { y: walker.y + 8, player: true }];
    if (tracks) for (const track of tracks.items) if (track.alive) drawables.push({ y: track.y + 2, track });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) {
        if (d.face) {
            ctx.fillStyle = d.face.colour; ctx.beginPath();
            d.face.points.forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
            ctx.closePath(); ctx.fill();
            if (d.face.ice && Math.sin(d.face.points[0].x * 9 + d.face.y * 3) > 0.7) {
                const [a, b, c] = d.face.points;
                ctx.strokeStyle = "rgba(235,249,255,.6)"; ctx.lineWidth = 0.5;
                ctx.beginPath(); ctx.moveTo((a.x+b.x)/2, (a.y+b.y)/2);
                ctx.lineTo((a.x+c.x)/2, (a.y+c.y)/2); ctx.lineTo(c.x, c.y); ctx.stroke();
            }
        } else if (d.track) {
            tracks.draw(ctx, { zoom: 1, isVisible: () => true, worldToScreen: (x, y) => patch.project(x, y) }, d.track);
        } else {
            const o = d.player ? walker : d.obj, p = patch.project(o.x, o.y);
            ctx.save(); ctx.translate(p.x, p.y);
            if (d.player) drawCharacter(ctx, { dir: walker.dir, phase: walker.phase, gait: walker.gait, idleTime: walker.time, tool: "knife", ...character });
            else {
                paintProp(ctx, o, walker.time, season);
                if (o.kind === "campfire") {
                    const fire = fires?.get(`${o.tx},${o.ty}`);
                    paintFlames(ctx, fire?.intensity || 0, walker.time, fire?.stack || []);
                }
            }
            ctx.restore();
        }
    }
    if (guides && routeStep !== null) {
        const step = RELIEF_STEPS[routeStep];
        if (step) {
            ctx.strokeStyle = "rgba(247,221,146,0.65)"; ctx.lineWidth = 1.1; ctx.setLineDash([4, 5]);
            ctx.beginPath();
            step.route.forEach(([x, y], i) => {
                const from = i ? step.route[i - 1] : [x, y];
                const n = Math.max(1, Math.ceil(Math.hypot(x - from[0], y - from[1]) / 4));
                for (let j = 0; j <= n; j++) {
                    const p = patch.project(from[0] + (x - from[0]) * j / n, from[1] + (y - from[1]) * j / n);
                    if (i || j) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
                }
            });
            ctx.stroke(); ctx.setLineDash([]);
        }
        RELIEF_STEPS.forEach((s, i) => {
            const p = patch.project(...s.point);
            ctx.fillStyle = i < routeStep ? "#4c704c" : i === routeStep ? "#b2924d" : "#39493a";
            ctx.strokeStyle = i === routeStep ? "#ffe9a4" : "#819276"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(p.x, p.y + 12, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = "#fff1ce"; ctx.font = "10px monospace"; ctx.fillText(String(i + 1), p.x - 3, p.y + 15);
        });
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

/** One projection for geometry, feet and lights. Attachments are sprite-local:
 * never resample height at the torch flame (it may hang over a cliff). */
export function reliefView(width, height, focus = null, minZoom = 0) {
    const zoom = Math.max(minZoom, Math.min((width - 48) / RELIEF.width, (height - 90) / (RELIEF.height * RELIEF.scaleY)));
    return { zoom, x: focus && minZoom ? width / 2 - focus.x * zoom : (width - RELIEF.width * zoom) / 2,
        y: focus && minZoom ? height * 0.58 - focus.y * zoom : 55 };
}
export function reliefAttachment(patch, actor, offset = { x: 0, y: 0 }) {
    const foot = patch.project(actor.x, actor.y);
    return { x: foot.x + offset.x, y: foot.y + offset.y };
}
