/**
 * tools/canvas-shim.js — software Canvas 2D for headless screenshots.
 *
 * The project forbids dependencies, so there is no node-canvas and no
 * puppeteer. This is a small rasteriser implementing exactly the subset of
 * the Canvas 2D API the game's renderer uses: transforms, paths (lines,
 * quadratics, arcs, ellipses), nonzero fills, strokes, radial/linear
 * gradients, drawImage, globalAlpha and the three composite modes we rely on
 * (source-over, destination-out, lighter).
 *
 * It exists so graphics work can be *looked at* instead of guessed:
 *   npm run shot   →  .artifacts/*.png
 *
 * Text is approximated (soft blocks), since the HUD is real DOM in the game.
 */
import zlib from "node:zlib";

/* ------------------------------------------------------------------ colour */

const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], red: [255, 0, 0, 1] };

export function parseColor(str) {
    if (typeof str !== "string") return [0, 0, 0, 1];
    const s = str.trim().toLowerCase();
    if (NAMED[s]) return NAMED[s].slice();
    if (s[0] === "#") {
        const h = s.slice(1);
        if (h.length === 3) {
            return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 1];
        }
        if (h.length === 6 || h.length === 8) {
            const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
            const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
            return [r, g, b, a];
        }
    }
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
        const p = m[1].split(",").map((v) => parseFloat(v));
        return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1];
    }
    return [0, 0, 0, 1];
}

class Gradient {
    constructor(kind, coords) { this.kind = kind; this.coords = coords; this.stops = []; }
    addColorStop(t, color) {
        this.stops.push({ t, c: parseColor(color) });
        this.stops.sort((a, b) => a.t - b.t);
    }
    colorAt(x, y) {
        if (!this.stops.length) return [0, 0, 0, 0];
        let t;
        if (this.kind === "radial") {
            const [x0, y0, r0, x1, y1, r1] = this.coords;
            const d = Math.hypot(x - x1, y - y1);
            t = r1 - r0 === 0 ? 0 : (d - r0) / (r1 - r0);
        } else {
            const [x0, y0, x1, y1] = this.coords;
            const dx = x1 - x0, dy = y1 - y0;
            const len2 = dx * dx + dy * dy;
            t = len2 === 0 ? 0 : ((x - x0) * dx + (y - y0) * dy) / len2;
        }
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        let lo = this.stops[0], hi = this.stops[this.stops.length - 1];
        for (let i = 0; i < this.stops.length - 1; i++) {
            if (t >= this.stops[i].t && t <= this.stops[i + 1].t) { lo = this.stops[i]; hi = this.stops[i + 1]; break; }
        }
        const span = hi.t - lo.t;
        const k = span <= 0 ? 0 : (t - lo.t) / span;
        return [
            lo.c[0] + (hi.c[0] - lo.c[0]) * k,
            lo.c[1] + (hi.c[1] - lo.c[1]) * k,
            lo.c[2] + (hi.c[2] - lo.c[2]) * k,
            lo.c[3] + (hi.c[3] - lo.c[3]) * k
        ];
    }
}

/* ------------------------------------------------------------------- canvas */

export class ShimCanvas {
    constructor(width = 300, height = 150) {
        this._w = width; this._h = height;
        this.data = new Uint8ClampedArray(width * height * 4);
        this._ctx = new ShimContext(this);
    }
    get width() { return this._w; }
    set width(v) { this._w = v | 0; this._alloc(); }
    get height() { return this._h; }
    set height(v) { this._h = v | 0; this._alloc(); }
    _alloc() {
        this.data = new Uint8ClampedArray(Math.max(1, this._w) * Math.max(1, this._h) * 4);
        if (this._ctx) this._ctx.reset();
    }
    getContext() { return this._ctx; }
}

class State {
    constructor(s) {
        if (s) Object.assign(this, s);
        else {
            this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
            this.globalAlpha = 1;
            this.fillStyle = "#000";
            this.strokeStyle = "#000";
            this.lineWidth = 1;
            this.globalCompositeOperation = "source-over";
            this.font = "10px sans-serif";
            this.textAlign = "left";
            this.textBaseline = "alphabetic";
            this.filter = "none";
            this.lineCap = "butt";
            this.lineDashOffset = 0;
            this.clipMask = null;
        }
    }
    clone() { return new State(this); }
}

export class ShimContext {
    constructor(canvas) {
        this.canvas = canvas;
        this.reset();
    }

    reset() {
        this.s = new State();
        this.stack = [];
        this.path = [];
        this.cur = null;
        this.imageSmoothingEnabled = false;
    }

    /* --- state --- */
    save() { this.stack.push(this.s.clone()); }
    restore() { if (this.stack.length) this.s = this.stack.pop(); }

    get globalAlpha() { return this.s.globalAlpha; }  set globalAlpha(v) { this.s.globalAlpha = v; }
    get fillStyle() { return this.s.fillStyle; }      set fillStyle(v) { this.s.fillStyle = v; }
    get strokeStyle() { return this.s.strokeStyle; }  set strokeStyle(v) { this.s.strokeStyle = v; }
    get lineWidth() { return this.s.lineWidth; }      set lineWidth(v) { this.s.lineWidth = v; }
    get globalCompositeOperation() { return this.s.globalCompositeOperation; }
    set globalCompositeOperation(v) { this.s.globalCompositeOperation = v; }
    get font() { return this.s.font; }                set font(v) { this.s.font = v; }
    get textAlign() { return this.s.textAlign; }      set textAlign(v) { this.s.textAlign = v; }
    get textBaseline() { return this.s.textBaseline; } set textBaseline(v) { this.s.textBaseline = v; }
    get filter() { return this.s.filter; }            set filter(v) { this.s.filter = v; }
    get lineCap() { return this.s.lineCap; }          set lineCap(v) { this.s.lineCap = v; }
    get lineDashOffset() { return this.s.lineDashOffset; } set lineDashOffset(v) { this.s.lineDashOffset = v; }
    setLineDash() {}

    /* --- transform --- */
    translate(x, y) { const s = this.s; s.e += s.a * x + s.c * y; s.f += s.b * x + s.d * y; }
    scale(x, y) { const s = this.s; s.a *= x; s.b *= x; s.c *= y; s.d *= y; }
    rotate(ang) {
        const s = this.s, cos = Math.cos(ang), sin = Math.sin(ang);
        const a = s.a, b = s.b, c = s.c, d = s.d;
        s.a = a * cos + c * sin; s.b = b * cos + d * sin;
        s.c = a * -sin + c * cos; s.d = b * -sin + d * cos;
    }
    transform(a2, b2, c2, d2, e2, f2) {
        const s = this.s;
        const a = s.a, b = s.b, c = s.c, d = s.d, e = s.e, f = s.f;
        s.a = a * a2 + c * b2; s.b = b * a2 + d * b2;
        s.c = a * c2 + c * d2; s.d = b * c2 + d * d2;
        s.e = a * e2 + c * f2 + e; s.f = b * e2 + d * f2 + f;
    }
    setTransform(a, b, c, d, e, f) { Object.assign(this.s, { a, b, c, d, e, f }); }
    _pt(x, y) { const s = this.s; return [s.a * x + s.c * y + s.e, s.b * x + s.d * y + s.f]; }
    _scaleFactor() { const s = this.s; return Math.sqrt(Math.abs(s.a * s.d - s.b * s.c)) || 1; }

    /* --- paths --- */
    beginPath() { this.path = []; this.cur = null; }
    moveTo(x, y) { this.cur = [this._pt(x, y)]; this.path.push(this.cur); }
    lineTo(x, y) { if (!this.cur) return this.moveTo(x, y); this.cur.push(this._pt(x, y)); }
    closePath() { if (this.cur && this.cur.length) this.cur.push(this.cur[0].slice()); }

    quadraticCurveTo(cx, cy, x, y) {
        if (!this.cur) this.moveTo(cx, cy);
        const p0 = this.cur[this.cur.length - 1];
        const p1 = this._pt(cx, cy), p2 = this._pt(x, y);
        const N = 14;
        for (let i = 1; i <= N; i++) {
            const t = i / N, u = 1 - t;
            this.cur.push([
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
            ]);
        }
    }

    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
        if (!this.cur) this.moveTo(c1x, c1y);
        const p0 = this.cur[this.cur.length - 1];
        const p1 = this._pt(c1x, c1y), p2 = this._pt(c2x, c2y), p3 = this._pt(x, y);
        const N = 18;
        for (let i = 1; i <= N; i++) {
            const t = i / N, u = 1 - t;
            this.cur.push([
                u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
                u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
            ]);
        }
    }

    arc(x, y, r, a0 = 0, a1 = Math.PI * 2) { this.ellipse(x, y, r, r, 0, a0, a1); }

    ellipse(x, y, rx, ry, rot = 0, a0 = 0, a1 = Math.PI * 2) {
        const span = Math.abs(a1 - a0);
        const N = Math.max(8, Math.ceil(span / (Math.PI / 16)));
        const cosR = Math.cos(rot), sinR = Math.sin(rot);
        for (let i = 0; i <= N; i++) {
            const t = a0 + (a1 - a0) * (i / N);
            const px = x + Math.cos(t) * rx * cosR - Math.sin(t) * ry * sinR;
            const py = y + Math.cos(t) * rx * sinR + Math.sin(t) * ry * cosR;
            if (i === 0 && !this.cur) this.moveTo(px, py);
            else this.lineTo(px, py);
        }
    }

    arcTo(x1, y1, x2, y2) { this.lineTo(x1, y1); this.lineTo(x2, y2); }

    rect(x, y, w, h) {
        this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h);
        this.lineTo(x, y + h); this.closePath();
    }

    /* --- painting --- */
    fill() { this._fillPolys(this.path, this.s.fillStyle); }

    stroke() {
        const lw = Math.max(0.6, this.s.lineWidth * this._scaleFactor());
        const polys = [];
        for (const sub of this.path) {
            for (let i = 0; i < sub.length - 1; i++) {
                const [x0, y0] = sub[i], [x1, y1] = sub[i + 1];
                const dx = x1 - x0, dy = y1 - y0;
                const len = Math.hypot(dx, dy);
                if (len < 1e-6) continue;
                const nx = (-dy / len) * lw / 2, ny = (dx / len) * lw / 2;
                polys.push([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
            }
            // Round-ish joints so corners do not leak.
            if (lw > 1.8) {
                for (const [px, py] of sub) {
                    const r = lw / 2, N = 8, poly = [];
                    for (let i = 0; i < N; i++) {
                        const a = (i / N) * Math.PI * 2;
                        poly.push([px + Math.cos(a) * r, py + Math.sin(a) * r]);
                    }
                    polys.push(poly);
                }
            }
        }
        this._fillPolys(polys, this.s.strokeStyle, true);
    }

    fillRect(x, y, w, h) {
        const p = [this._pt(x, y), this._pt(x + w, y), this._pt(x + w, y + h), this._pt(x, y + h)];
        this._fillPolys([p], this.s.fillStyle);
    }

    strokeRect(x, y, w, h) {
        const saved = this.path;
        this.beginPath(); this.rect(x, y, w, h); this.stroke();
        this.path = saved;
    }

    clearRect(x, y, w, h) {
        const [x0, y0] = this._pt(x, y);
        const [x1, y1] = this._pt(x + w, y + h);
        const cw = this.canvas.width, ch = this.canvas.height, d = this.canvas.data;
        const xa = Math.max(0, Math.floor(Math.min(x0, x1))), xb = Math.min(cw, Math.ceil(Math.max(x0, x1)));
        const ya = Math.max(0, Math.floor(Math.min(y0, y1))), yb = Math.min(ch, Math.ceil(Math.max(y0, y1)));
        for (let py = ya; py < yb; py++) {
            for (let px = xa; px < xb; px++) {
                if (!this._insideClip(px, py)) continue;
                const i = (py * cw + px) * 4;
                d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
            }
        }
    }

    clip() {
        // Paths are already in device coordinates. Keep an immutable, bounded
        // mask in the saved state; nested clips intersect rather than replace it.
        const points = this.path.flat();
        const x = Math.max(0, Math.floor(Math.min(...points.map((p) => p[0]))));
        const y = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))));
        const right = Math.min(this.canvas.width, Math.ceil(Math.max(...points.map((p) => p[0]))));
        const bottom = Math.min(this.canvas.height, Math.ceil(Math.max(...points.map((p) => p[1]))));
        const w = Math.max(0, right - x), h = Math.max(0, bottom - y);
        if (!points.length || !w || !h) {
            this.s.clipMask = { x: 0, y: 0, w: 0, h: 0, data: new Uint8Array(0) };
            return;
        }
        const data = new Uint8Array(w * h);
        for (let row = 0; row < h; row++) {
            const sy = y + row + 0.5, hits = [];
            for (const poly of this.path) for (let i = 0; i < poly.length; i++) {
                const a = poly[i], b = poly[(i + 1) % poly.length];
                if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
                    hits.push({ x: a[0] + (sy - a[1]) / (b[1] - a[1]) * (b[0] - a[0]),
                        wind: b[1] > a[1] ? 1 : -1 });
                }
            }
            hits.sort((a, b) => a.x - b.x);
            let wind = 0;
            for (let i = 0; i + 1 < hits.length; i++) {
                wind += hits[i].wind;
                if (!wind) continue;
                const from = Math.max(x, Math.ceil(hits[i].x - 0.5));
                const to = Math.min(right - 1, Math.floor(hits[i + 1].x - 0.5));
                for (let col = from; col <= to; col++) {
                    if (this._insideClip(col, y + row)) data[row * w + col - x] = 1;
                }
            }
        }
        this.s.clipMask = { x, y, w, h, data };
    }

    _insideClip(x, y) {
        const c = this.s.clipMask;
        return !c || (x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h
            && c.data[(y - c.y) * c.w + x - c.x] !== 0);
    }

    /* --- text (approximated) --- */
    measureText(str) { return { width: String(str).length * (this._fontSize() * 0.55) }; }
    _fontSize() {
        const m = /(\d+(?:\.\d+)?)px/.exec(this.s.font);
        return m ? parseFloat(m[1]) : 10;
    }
    fillText(str, x, y) {
        const size = this._fontSize();
        const text = String(str);
        const w = text.length * size * 0.55;
        let ox = 0;
        if (this.s.textAlign === "center") ox = -w / 2;
        else if (this.s.textAlign === "right") ox = -w;
        const saveAlpha = this.s.globalAlpha;
        this.s.globalAlpha *= 0.55;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === " ") continue;
            this.fillRect(x + ox + i * size * 0.55 + size * 0.07, y - size * 0.72, size * 0.42, size * 0.72);
        }
        this.s.globalAlpha = saveAlpha;
    }
    strokeText() {}

    /* --- images --- */
    drawImage(img, dx = 0, dy = 0, dw = img.width, dh = img.height) {
        const src = img.data ? img : (img.canvas && img.canvas.data ? img.canvas : null);
        if (!src) return;
        const sw = src.width, sh = src.height;
        const corners = [this._pt(dx, dy), this._pt(dx + dw, dy), this._pt(dx + dw, dy + dh), this._pt(dx, dy + dh)];
        const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
        const cw = this.canvas.width, ch = this.canvas.height;
        const xa = Math.max(0, Math.floor(Math.min(...xs))), xb = Math.min(cw, Math.ceil(Math.max(...xs)));
        const ya = Math.max(0, Math.floor(Math.min(...ys))), yb = Math.min(ch, Math.ceil(Math.max(...ys)));
        if (xb <= xa || yb <= ya) return;

        const s = this.s;
        const det = s.a * s.d - s.b * s.c;
        if (Math.abs(det) < 1e-9) return;
        const ia = s.d / det, ib = -s.b / det, ic = -s.c / det, id = s.a / det;
        const ie = (s.c * s.f - s.d * s.e) / det, iff = (s.b * s.e - s.a * s.f) / det;
        const alpha = s.globalAlpha;
        const mode = s.globalCompositeOperation;

        for (let py = ya; py < yb; py++) {
            for (let px = xa; px < xb; px++) {
                const cx = px + 0.5, cy = py + 0.5;
                const ux = ia * cx + ic * cy + ie;
                const uy = ib * cx + id * cy + iff;
                const tx = (ux - dx) / dw, ty = (uy - dy) / dh;
                if (tx < 0 || tx >= 1 || ty < 0 || ty >= 1) continue;
                const sx = Math.min(sw - 1, Math.floor(tx * sw));
                const sy = Math.min(sh - 1, Math.floor(ty * sh));
                const si = (sy * sw + sx) * 4;
                const sa = (src.data[si + 3] / 255) * alpha;
                if (sa <= 0) continue;
                this._blendPixel(px, py, src.data[si], src.data[si + 1], src.data[si + 2], sa, mode);
            }
        }
    }

    getImageData(x, y, w, h) {
        const out = new Uint8ClampedArray(w * h * 4);
        const cw = this.canvas.width;
        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                const si = ((y + j) * cw + (x + i)) * 4, di = (j * w + i) * 4;
                out[di] = this.canvas.data[si]; out[di + 1] = this.canvas.data[si + 1];
                out[di + 2] = this.canvas.data[si + 2]; out[di + 3] = this.canvas.data[si + 3];
            }
        }
        return { data: out, width: w, height: h };
    }
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
    putImageData(image, x, y) {
        // Like Canvas: raw pixels ignore transform, alpha and clip.
        for (let j = 0; j < image.height; j++) for (let i = 0; i < image.width; i++) {
            const px = x + i, py = y + j;
            if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) continue;
            const si = (j * image.width + i) * 4, di = (py * this.canvas.width + px) * 4;
            this.canvas.data.set(image.data.subarray(si, si + 4), di);
        }
    }

    createRadialGradient(x0, y0, r0, x1, y1, r1) {
        const p0 = this._pt(x0, y0), p1 = this._pt(x1, y1), k = this._scaleFactor();
        return new Gradient("radial", [p0[0], p0[1], r0 * k, p1[0], p1[1], r1 * k]);
    }
    createLinearGradient(x0, y0, x1, y1) {
        const p0 = this._pt(x0, y0), p1 = this._pt(x1, y1);
        return new Gradient("linear", [p0[0], p0[1], p1[0], p1[1]]);
    }

    /* --- rasteriser --- */
    _fillPolys(polys, style, unionMode = false) {
        if (!polys || !polys.length) return;
        const grad = style instanceof Gradient ? style : null;
        const flat = grad ? null : parseColor(style);
        const alpha = this.s.globalAlpha;
        const mode = this.s.globalCompositeOperation;
        const cw = this.canvas.width, ch = this.canvas.height;

        const run = (list) => {
            const edges = [];
            let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
            for (const poly of list) {
                const n = poly.length;
                if (n < 2) continue;
                for (let i = 0; i < n; i++) {
                    const p = poly[i], q = poly[(i + 1) % n];
                    if (p[1] === q[1]) continue;
                    edges.push([p[0], p[1], q[0], q[1]]);
                    minY = Math.min(minY, p[1], q[1]); maxY = Math.max(maxY, p[1], q[1]);
                    minX = Math.min(minX, p[0], q[0]); maxX = Math.max(maxX, p[0], q[0]);
                }
            }
            if (!edges.length) return;
            const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(ch - 1, Math.ceil(maxY));
            const xClampLo = Math.max(0, Math.floor(minX)), xClampHi = Math.min(cw - 1, Math.ceil(maxX));
            if (y1 < y0 || xClampHi < xClampLo) return;

            const xsBuf = [];
            for (let py = y0; py <= y1; py++) {
                const sy = py + 0.5;
                xsBuf.length = 0;
                for (const [ax, ay, bx, by] of edges) {
                    if ((sy >= ay && sy < by) || (sy >= by && sy < ay)) {
                        const t = (sy - ay) / (by - ay);
                        xsBuf.push({ x: ax + (bx - ax) * t, w: by > ay ? 1 : -1 });
                    }
                }
                if (xsBuf.length < 2) continue;
                xsBuf.sort((p, q) => p.x - q.x);
                let wind = 0;
                for (let i = 0; i < xsBuf.length - 1; i++) {
                    wind += xsBuf[i].w;
                    const inside = unionMode ? true : wind !== 0;
                    if (!inside) continue;
                    if (unionMode && (i % 2 === 1)) continue;
                    const sx = Math.max(xClampLo, Math.ceil(xsBuf[i].x - 0.5));
                    const ex = Math.min(xClampHi, Math.floor(xsBuf[i + 1].x - 0.5));
                    for (let px = sx; px <= ex; px++) {
                        let col = flat;
                        if (grad) col = grad.colorAt(px + 0.5, sy);
                        const a = col[3] * alpha;
                        if (a <= 0) continue;
                        this._blendPixel(px, py, col[0], col[1], col[2], a, mode);
                    }
                }
            }
        };

        if (unionMode) for (const poly of polys) run([poly]);
        else run(polys);
    }

    _blendPixel(px, py, r, g, b, a, mode) {
        if (!this._insideClip(px, py)) return;
        const cw = this.canvas.width;
        const d = this.canvas.data;
        const i = (py * cw + px) * 4;
        if (mode === "destination-out") {
            d[i + 3] = d[i + 3] * (1 - a);
            return;
        }
        if (mode === "multiply") {
            // Source colour scales the destination instead of covering it —
            // this is what keeps the ground green under a night light map.
            const t = a;
            d[i] = d[i] * (1 - t) + (d[i] * r / 255) * t;
            d[i + 1] = d[i + 1] * (1 - t) + (d[i + 1] * g / 255) * t;
            d[i + 2] = d[i + 2] * (1 - t) + (d[i + 2] * b / 255) * t;
            d[i + 3] = Math.max(d[i + 3], a * 255);
            return;
        }
        if (mode === "lighter") {
            d[i] = Math.min(255, d[i] + r * a);
            d[i + 1] = Math.min(255, d[i + 1] + g * a);
            d[i + 2] = Math.min(255, d[i + 2] + b * a);
            d[i + 3] = Math.min(255, d[i + 3] + a * 255);
            return;
        }
        const da = d[i + 3] / 255;
        const outA = a + da * (1 - a);
        if (outA <= 0) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; return; }
        d[i] = (r * a + d[i] * da * (1 - a)) / outA;
        d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / outA;
        d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / outA;
        d[i + 3] = outA * 255;
    }
}

/* ---------------------------------------------------------------- PNG out */

function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}

/** Encode a ShimCanvas as a PNG buffer (RGB, opaque background). */
export function encodePNG(canvas, background = [12, 14, 18]) {
    const w = canvas.width, h = canvas.height, src = canvas.data;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    let p = 0;
    for (let y = 0; y < h; y++) {
        raw[p++] = 0;                       // filter: none
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const a = src[i + 3] / 255;
            raw[p++] = src[i] * a + background[0] * (1 - a);
            raw[p++] = src[i + 1] * a + background[1] * (1 - a);
            raw[p++] = src[i + 2] * a + background[2] * (1 - a);
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
        chunk("IEND", Buffer.alloc(0))
    ]);
}
