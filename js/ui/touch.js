/** Floating analogue movement on the left, deliberate action on the right.
 * A second left finger never triggers an action; all interruptions reset it. */
export function bindTouch(game, canvas) {
    let id = null, ox = 0, oy = 0;
    const pad = document.createElement("div"); pad.className = "touchStick";
    pad.innerHTML = "<span>Тяни для ходьбы<br>дальше — бег</span>";
    game.hud.root.appendChild(pad);
    const thumb = document.createElement("i"); pad.appendChild(thumb);
    const reset = () => { id = null; game.input.setStick(0, 0); thumb.style.transform = "translate(0px,0px)"; };
    const blocked = () => game.hud.isPanelOpen || game.hud.isStoryOpen || game.paused || game.backgrounded;
    canvas.addEventListener("touchstart", (e) => {
        if (blocked()) return;
        const r = canvas.getBoundingClientRect?.() || { left: 0, width: canvas.width };
        for (const t of e.changedTouches) {
            if (t.clientX - r.left < r.width / 2) {
                if (id === null) { id = t.identifier; ox = t.clientX; oy = t.clientY; }
            } else game.input.tap("action");
        }
    }, { passive: true });
    canvas.addEventListener("touchmove", (e) => {
        if (blocked()) { reset(); return; }
        for (const t of e.changedTouches) if (t.identifier === id) {
            game.input.setStick((t.clientX - ox) / 55, (t.clientY - oy) / 55);
            thumb.style.transform = `translate(${game.input.stick.x * 24}px,${game.input.stick.y * 24}px)`;
        }
        e.preventDefault();
    }, { passive: false });
    for (const name of ["touchend", "touchcancel"]) canvas.addEventListener(name, (e) => {
        for (const t of e.changedTouches) if (t.identifier === id) reset();
    }, { passive: true });
    for (const name of ["contextmenu", "dragstart"]) canvas.addEventListener(name, (e) => e.preventDefault());
    return { reset };
}
