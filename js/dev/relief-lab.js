import { ReliefPatch, ReliefWalker } from "../world/relief.js";
import { drawRelief, reliefMesh, RELIEF_OBJECTS } from "../render/relief.js";
const canvas = document.getElementById("relief"), ctx = canvas.getContext("2d");
const status = document.getElementById("status"), guides = document.getElementById("guides");
const patch = new ReliefPatch(), walker = new ReliefWalker(patch), mesh = reliefMesh(patch);
const keys = new Set(); let collected = false, message = "", previous = null, lastStatus = "";
const reset = (top = false) => { walker.reset(top); collected = false; message = ""; keys.clear(); canvas.focus(); };
document.getElementById("bottom").onclick = () => reset();
document.getElementById("top").onclick = () => reset(true);
document.getElementById("hill").onclick = () => { reset(); walker.x = 123; walker.y = 355; };
canvas.addEventListener("keydown", (e) => {
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyE"].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === "KeyE" && !e.repeat) {
        const item = RELIEF_OBJECTS.find((o) => o.pickup);
        if (!collected && patch.canReach(walker, item)) { collected = true; message = "Хворост подобран на верхней площадке."; }
        else message = collected ? "Хворост уже подобран." : "Подойди к хворосту на той же высоте.";
    }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => { keys.clear(); previous = null; });
canvas.addEventListener("blur", () => keys.clear());
document.addEventListener("visibilitychange", () => { keys.clear(); previous = null; });
function frame(now) {
    const dt = previous === null ? 0 : Math.min(0.1, (now - previous) / 1000); previous = now;
    const has = (a, b) => keys.has(a) || keys.has(b) ? 1 : 0;
    walker.update(dt, { x: has("KeyD", "ArrowRight") - has("KeyA", "ArrowLeft"), y: has("KeyS", "ArrowDown") - has("KeyW", "ArrowUp") });
    drawRelief(ctx, patch, walker, { mesh, collected, guides: guides.checked });
    const text = `Высота: ${patch.heightAt(walker.x, walker.y).toFixed(1)} · ${walker.blocked ? "Отвесный край — нужен обход." : message || "Иди по светлому подъёму или исследуй холм слева."}`;
    if (text !== lastStatus) { status.textContent = text; lastStatus = text; }
    requestAnimationFrame(frame);
}
canvas.focus(); requestAnimationFrame(frame);
