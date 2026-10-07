/**
 * tests — a minimal fake DOM + Canvas 2D context.
 *
 * Enough of a browser for `Game` to boot, build its HUD, bake chunks and draw
 * frames, so wiring bugs (a bad selector, a missing context method, a null
 * reference in the render path) are caught in CI instead of in the player's
 * face. Nothing here pretends to be a real browser — it records calls.
 */

const CTX_METHODS = [
    "save", "restore", "translate", "scale", "rotate", "transform", "setTransform",
    "beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo", "ellipse",
    "quadraticCurveTo", "bezierCurveTo", "rect", "fill", "stroke", "clip",
    "fillRect", "strokeRect", "clearRect", "fillText", "strokeText",
    "drawImage", "setLineDash", "putImageData"
];

export function makeContext(canvas) {
    const ctx = {
        canvas,
        calls: { fillRect: 0, drawImage: 0, fillText: 0, arc: 0, total: 0 },
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        imageSmoothingEnabled: true,
        filter: "none",
        lineWidth: 1,
        lineCap: "butt",
        lineDashOffset: 0,
        font: "10px sans-serif",
        textAlign: "left",
        textBaseline: "alphabetic",
        fillStyle: "#000",
        strokeStyle: "#000"
    };
    for (const m of CTX_METHODS) {
        ctx[m] = function () {
            ctx.calls.total++;
            if (ctx.calls[m] !== undefined) ctx.calls[m]++;
        };
    }
    ctx.measureText = (s) => ({ width: String(s).length * 6 });
    const gradient = { addColorStop() {} };
    ctx.createRadialGradient = () => gradient;
    ctx.createLinearGradient = () => gradient;
    ctx.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    ctx.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    return ctx;
}

class FakeClassList {
    constructor() { this.set = new Set(); }
    add(c) { this.set.add(c); }
    remove(c) { this.set.delete(c); }
    toggle(c, on) { if (on === undefined) on = !this.set.has(c); on ? this.set.add(c) : this.set.delete(c); return on; }
    contains(c) { return this.set.has(c); }
}

export class FakeElement {
    constructor(tag = "div") {
        this.tagName = tag.toUpperCase();
        this.children = [];
        // `style` behaves enough like CSSStyleDeclaration for custom props.
        this.style = {
            _props: {},
            setProperty(k, v) { this._props[k] = String(v); },
            getPropertyValue(k) { return this._props[k] || ""; },
            removeProperty(k) { delete this._props[k]; }
        };
        this.dataset = {};
        this.classList = new FakeClassList();
        this.listeners = new Map();
        this._innerHTML = "";
        this.textContent = "";
        this.title = "";
        this._cache = new Map();
        this.attrs = {};
        this.parentElement = null;
        if (tag === "canvas") {
            this.width = 300; this.height = 150;
            this._ctx = makeContext(this);
            this.getContext = () => this._ctx;
        }
    }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(v) { this._innerHTML = String(v); this._cache.clear(); this.children.length = 0; }

    /** Any selector resolves to a stable stub element, created on first ask. */
    querySelector(sel) {
        if (!this._cache.has(sel)) {
            const el = new FakeElement("div");
            el.parentElement = new FakeElement("div");
            el.parentElement.parentElement = new FakeElement("div");
            this._cache.set(sel, el);
        }
        return this._cache.get(sel);
    }

    querySelectorAll(sel) {
        const n = sel === ".slot" ? 6 : 1;
        const key = "all:" + sel;
        if (!this._cache.has(key)) {
            const list = [];
            for (let i = 0; i < n; i++) {
                const el = new FakeElement("div");
                el.dataset.slot = String(i);
                list.push(el);
            }
            this._cache.set(key, list);
        }
        return this._cache.get(key);
    }

    /** Attributes: the HUD sets ARIA roles and values on live elements. */
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
    removeAttribute(name) { delete this.attrs[name]; }

    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; }
    remove() { if (this.parentElement) this.parentElement.removeChild(this); }
    get firstChild() { return this.children[0] || null; }

    addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
        const l = this.listeners.get(type);
        if (l) this.listeners.set(type, l.filter((f) => f !== fn));
    }
    /** Fire a listener as the browser would. */
    dispatch(type, event = {}) {
        for (const fn of this.listeners.get(type) || []) fn(event);
    }
}

/** Install globals: document, window, performance, requestAnimationFrame. */
export function installDOM() {
    const elements = new Map();
    const doc = {
        createElement: (tag) => new FakeElement(tag),
        getElementById: (id) => {
            if (!elements.has(id)) {
                const el = new FakeElement(id === "game" ? "canvas" : "div");
                if (id === "game") { el.width = 640; el.height = 360; }
                elements.set(id, el);
            }
            return elements.get(id);
        },
        addEventListener() {},
        documentElement: new FakeElement("html"),
        body: new FakeElement("body")
    };
    const listeners = new Map();
    const win = {
        innerWidth: 960,
        innerHeight: 540,
        addEventListener: (t, fn) => {
            if (!listeners.has(t)) listeners.set(t, []);
            listeners.get(t).push(fn);
        },
        removeEventListener: () => {},
        dispatch: (t, ev) => { for (const fn of listeners.get(t) || []) fn(ev); },
        localStorage: new Map()
    };

    globalThis.document = doc;
    globalThis.window = win;
    globalThis.requestAnimationFrame = (fn) => 0;      // tests drive the loop by hand
    globalThis.performance = globalThis.performance || { now: () => Date.now() };
    globalThis.localStorage = {
        _m: new Map(),
        getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
        setItem(k, v) { this._m.set(k, String(v)); },
        removeItem(k) { this._m.delete(k); }
    };
    globalThis.setTimeout = globalThis.setTimeout || ((fn) => fn());
    return { doc, win, elements };
}

/** Send a keyboard event the way Input expects it. */
export function key(win, code, down = true, repeat = false) {
    win.dispatch(down ? "keydown" : "keyup", { code, repeat, preventDefault() {} });
}
