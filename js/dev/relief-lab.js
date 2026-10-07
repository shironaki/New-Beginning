import { ReliefPatch, ReliefWalker } from "../world/relief.js";
import { drawRelief, reliefMesh } from "../render/relief.js";
import { ReliefGuide, RELIEF_STEPS } from "./relief-guide.js";
const el = (id) => document.getElementById(id);
const canvas = el("relief"), ctx = canvas.getContext("2d"), guides = el("guides");
const patch = new ReliefPatch(), walker = new ReliefWalker(patch), mesh = reliefMesh(patch), guide = new ReliefGuide();
const keys = new Set(), pointers = new Map(); let previous = null, message = "", lastStep = -1;
const focus = () => canvas.focus({ preventScroll: true });
const clearInput = () => { keys.clear(); pointers.clear(); };
const reset = () => { walker.reset(); guide.reset(); message = ""; lastStep = -1; clearInput(); focus(); };
const pickup = () => {
    guide.demo = false;
    message = guide.collect(walker) ? "Хворост подобран на верхней площадке."
        : guide.collected ? "Хворост уже подобран." : "Подойди к хворосту на той же высоте и нажми E.";
};
const cards = RELIEF_STEPS.map((step, i) => {
    const card = document.createElement("li"); card.textContent = `${i + 1}. ${step.title}`;
    el("checklist").append(card); return card;
});
el("bottom").onclick = reset;
el("demo").onclick = () => {
    if (guide.demo) { guide.demo = false; focus(); return; }
    reset(); guide.demo = guide.demonstrated = true;
};
const inspect = (top) => {
    reset(); guide.reset(false); walker.reset(top);
    if (!top) { walker.x = 123; walker.y = 355; }
};
el("top").onclick = () => inspect(true); el("hill").onclick = () => inspect(false);
el("pickup").onclick = () => { pickup(); focus(); };
const movement = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
canvas.addEventListener("pointerdown", focus);
canvas.addEventListener("keydown", (e) => {
    if (![...movement, "KeyE"].includes(e.code)) return;
    e.preventDefault(); keys.add(e.code); guide.demo = false;
    if (e.code === "KeyE" && !e.repeat) pickup();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
for (const button of document.querySelectorAll("[data-move]")) {
    button.addEventListener("pointerdown", (e) => {
        e.preventDefault(); focus(); guide.demo = false;
        pointers.set(e.pointerId, button.dataset.move.split(",").map(Number));
        button.setPointerCapture(e.pointerId);
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
        button.addEventListener(event, (e) => pointers.delete(e.pointerId));
}
const suspend = () => { clearInput(); previous = null; guide.demo = false; };
window.addEventListener("blur", suspend);
canvas.addEventListener("blur", clearInput);
document.addEventListener("visibilitychange", suspend);
function frame(now) {
    const dt = previous === null ? 0 : Math.min(0.1, (now - previous) / 1000); previous = now;
    const has = (a, b) => keys.has(a) || keys.has(b) ? 1 : 0;
    let input = { x: has("KeyD", "ArrowRight") - has("KeyA", "ArrowLeft"), y: has("KeyS", "ArrowDown") - has("KeyW", "ArrowUp") };
    for (const [x, y] of pointers.values()) { input.x += x; input.y += y; }
    if (guide.demo) input = guide.demoInput(walker);
    walker.update(dt, input); guide.observe(walker);
    if (lastStep !== guide.step) { message = ""; lastStep = guide.step; }
    drawRelief(ctx, patch, walker, { mesh, collected: guide.collected, guides: guides.checked, routeStep: guide.active ? guide.step : null });
    const set = (id, text) => { if (el(id).textContent !== text) el(id).textContent = text; };
    const z = patch.heightAt(walker.x, walker.y);
    set("height-value", z.toFixed(1)); el("height-meter").value = z;
    set("mode", guide.demo ? "Автопоказ · WASD — взять управление" : guide.complete ? (guide.demonstrated ? "Автопоказ завершён" : "Маршрут завершён") : guide.active ? "Самостоятельная проверка" : "Свободный осмотр · маршрут приостановлен");
    set("counter", guide.active ? `${guide.step} / 5` : "— / 5");
    set("demo", guide.demo ? "Ⅱ Остановить автопоказ" : "▶ Показать прохождение");
    set("goal-title", !guide.active ? "Свободный осмотр" : guide.complete ? "Готово: все 5 проверок пройдены" : `${guide.step + 1}. ${RELIEF_STEPS[guide.step].title}`);
    set("goal-hint", !guide.active ? "Отладочное перемещение не считается прохождением. Нажми «Начать заново», чтобы проверить маршрут."
        : guide.complete ? `${guide.demonstrated ? "Маршрут пройден с автопоказом — теперь можно повторить самому. " : "Ты проверил подъём, подбор, спуск, непроходимый уступ и плавный холм. "}Это завершение стенда, а не переход в новую игровую зону.`
        : RELIEF_STEPS[guide.step].hint);
    set("status", message || (walker.blocked ? "Проход закрыт: обойди препятствие или воспользуйся подъёмом." : guide.step === 1 ? "Хворост отмечен цифрой 2. Подбор — E." : ""));
    cards.forEach((card, i) => {
        card.className = guide.active && i < guide.step ? "done" : guide.active && i === guide.step ? "current" : "";
        const text = `${guide.active && i < guide.step ? "✓" : i + 1 + "."} ${RELIEF_STEPS[i].title}`;
        if (card.textContent !== text) card.textContent = text;
        card.setAttribute("aria-current", guide.active && i === guide.step ? "step" : "false");
    });
    el("focus-tip").hidden = document.activeElement === canvas || guide.demo;
    requestAnimationFrame(frame);
}
focus(); requestAnimationFrame(frame);
