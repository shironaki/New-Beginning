/**
 * v3 engine — input.
 *
 * Keyboard (WASD/arrows + action keys), mouse and an analogue touch joystick,
 * normalised into one tiny API: `axis()`, `pressed(action)`, `justPressed(action)`.
 * Edge detection is consumed once per simulation tick so a tap can never be
 * swallowed or double-fired.
 */

export const DEFAULT_BINDINGS = {
    up:        ["KeyW", "ArrowUp"],
    down:      ["KeyS", "ArrowDown"],
    left:      ["KeyA", "ArrowLeft"],
    right:     ["KeyD", "ArrowRight"],
    action:    ["KeyE", "Space"],
    cancel:    ["Escape"],
    sprint:    ["ShiftLeft", "ShiftRight"],
    inventory: ["KeyI", "Tab"],
    journal:   ["KeyJ"],
    build:     ["KeyB"],
    map:       ["KeyM"],
    attack:    ["KeyF"],
    slot1: ["Digit1"], slot2: ["Digit2"], slot3: ["Digit3"],
    slot4: ["Digit4"], slot5: ["Digit5"], slot6: ["Digit6"]
};

/**
 * Safety valves for a held key whose `keyup` never arrives.
 *
 * This happens for real: the page loses focus mid-stride (a click that lands
 * outside the frame, a browser dialog, a context menu, an iframe handing
 * focus to its parent) and the browser simply never delivers the release.
 * The hero then walks off on his own and fights every other direction the
 * player presses, because the ghost key is still in the set.
 */
export const INPUT_GUARD = {
    /** A held key auto-repeats; if the repeats stop, the key is gone. */
    repeatTimeout: 1.1,
    /** Only arm the watchdog once we have actually seen a repeat for that key,
     *  so a machine with key-repeat switched off is never cut off mid-walk. */
    armOnRepeat: true
};

export class Input {
    constructor({ target = null, bindings = DEFAULT_BINDINGS } = {}) {
        this.bindings = bindings;
        this.codeToActions = new Map();
        for (const [action, codes] of Object.entries(bindings)) {
            for (const code of codes) {
                if (!this.codeToActions.has(code)) this.codeToActions.set(code, []);
                this.codeToActions.get(code).push(action);
            }
        }
        this.down = new Set();        // actions currently held
        this.justDown = new Set();    // actions pressed since last consume()
        this.justUp = new Set();
        this.stick = { x: 0, y: 0, active: false };   // analogue touch input
        this.pointer = { x: 0, y: 0, down: false };
        this.enabled = true;
        this.time = 0;
        this._held = new Map();       // code -> { seen, armed }
        this._detach = [];
        if (target) this.attach(target);
    }

    attach(target) {
        const onKey = (down) => (e) => {
            if (!this.enabled) return;
            const actions = this.codeToActions.get(e.code);
            if (!actions) return;
            if (down) {
                // The OS repeats only the LAST key pressed. So pressing a
                // second key (W then A for a diagonal) stops the repeats of
                // the first one — disarm everything else, or the watchdog
                // would "helpfully" drop the key the player is still holding.
                for (const [code, h] of this._held) if (code !== e.code) h.armed = false;
                const h = this._held.get(e.code);
                if (h) { h.seen = this.time; if (e.repeat) h.armed = true; }
                else this._held.set(e.code, { seen: this.time, armed: !INPUT_GUARD.armOnRepeat });
            } else {
                this._held.delete(e.code);
            }
            // Keep the page from scrolling under the canvas.
            if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
                e.preventDefault();
            }
            for (const a of actions) {
                if (down) {
                    if (!this.down.has(a)) this.justDown.add(a);
                    this.down.add(a);
                } else {
                    this.down.delete(a);
                    this.justUp.add(a);
                }
            }
        };
        const kd = onKey(true), ku = onKey(false);
        const blur = () => this.releaseAll();
        target.addEventListener("keydown", kd);
        target.addEventListener("keyup", ku);
        target.addEventListener("blur", blur);
        // Belt and braces: keyup is also taken on the document, in the capture
        // phase, so no widget in between can swallow a release.
        const doc = target.document || (typeof document !== "undefined" ? document : null);
        if (doc && doc.addEventListener) {
            doc.addEventListener("keyup", ku, true);
            doc.addEventListener("visibilitychange", () => { if (doc.hidden) this.releaseAll(); });
            this._detach.push(() => doc.removeEventListener("keyup", ku, true));
        }
        this._detach.push(() => {
            target.removeEventListener("keydown", kd);
            target.removeEventListener("keyup", ku);
            target.removeEventListener("blur", blur);
        });
        this._doc = doc;
        return this;
    }

    /** Drop held keys (the touch stick is left alone). */
    releaseKeys() {
        for (const a of this.down) this.justUp.add(a);
        this.down.clear();
        this._held.clear();
        return this;
    }

    /** Drop every held key and the stick — used by every safety valve. */
    releaseAll() {
        for (const a of this.down) this.justUp.add(a);
        this.down.clear();
        this._held.clear();
        this.stick.x = this.stick.y = 0;
        this.stick.active = false;
        return this;
    }

    /**
     * Per-tick sanity pass. Call once per simulation tick, before reading the
     * axis. Two guards, both deterministic:
     *   1. the document does not have focus → nothing can be held;
     *   2. a key that was auto-repeating stopped repeating → its `keyup` was
     *      lost, so release it.
     */
    update(dt) {
        this.time += dt;
        if (this._doc && typeof this._doc.hasFocus === "function" && !this._doc.hasFocus()) {
            // Keyboard only: a touch stick keeps working on devices where the
            // document never reports focus at all.
            if (this.down.size) this.releaseKeys();
            return this;
        }
        if (!this._held.size) return this;
        for (const [code, h] of this._held) {
            if (!h.armed || this.time - h.seen <= INPUT_GUARD.repeatTimeout) continue;
            this._held.delete(code);
            for (const a of this.codeToActions.get(code) || []) {
                if (this.down.delete(a)) this.justUp.add(a);
            }
        }
        return this;
    }

    detach() { this._detach.forEach((f) => f()); this._detach = []; return this; }

    /** Virtual press from a touch button / UI element. */
    press(action) {
        if (!this.down.has(action)) this.justDown.add(action);
        this.down.add(action);
        return this;
    }
    release(action) { this.down.delete(action); this.justUp.add(action); return this; }
    tap(action) { this.justDown.add(action); return this; }

    /** Analogue stick, components in [-1, 1]. */
    setStick(x, y) {
        const mag = Math.hypot(x, y);
        if (mag < 0.14) { this.stick.x = 0; this.stick.y = 0; this.stick.active = false; return this; }
        const clamped = Math.min(1, mag);
        // Exponential response: a gentle lean walks, a full push runs.
        const curved = Math.pow(clamped, 1.4);
        this.stick.x = (x / mag) * curved;
        this.stick.y = (y / mag) * curved;
        this.stick.active = true;
        return this;
    }

    pressed(action) { return this.down.has(action); }
    justPressed(action) { return this.justDown.has(action); }
    justReleased(action) { return this.justUp.has(action); }

    /** Movement vector, already normalised; magnitude <= 1 encodes walk vs run. */
    axis() {
        if (this.stick.active) return { x: this.stick.x, y: this.stick.y };
        let x = 0, y = 0;
        if (this.pressed("left")) x -= 1;
        if (this.pressed("right")) x += 1;
        if (this.pressed("up")) y -= 1;
        if (this.pressed("down")) y += 1;
        if (x && y) { const inv = Math.SQRT1_2; x *= inv; y *= inv; }
        return { x, y };
    }

    /** Clear per-tick edges. Call once at the end of every simulation tick. */
    consume() { this.justDown.clear(); this.justUp.clear(); return this; }
}
