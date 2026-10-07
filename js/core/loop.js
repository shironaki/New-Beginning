/**
 * core — fixed-timestep game loop.
 *
 * Simulation runs at a fixed 60 Hz regardless of monitor refresh rate, so
 * physics, hunger drain and NPC work never depend on frame rate. Rendering
 * happens once per animation frame with an interpolation alpha.
 *
 * The frame source is injectable (`raf`), which lets tests drive the loop
 * deterministically without a browser.
 */
export class GameLoop {
    constructor({ update, render, step = 1 / 60, maxFrameTime = 0.25, raf = null, now = null } = {}) {
        this.update = update || (() => {});
        this.render = render || (() => {});
        this.step = step;
        this.maxFrameTime = maxFrameTime;
        this.raf = raf || (typeof requestAnimationFrame !== "undefined"
            ? requestAnimationFrame.bind(globalThis) : null);
        this.now = now || (typeof performance !== "undefined"
            ? () => performance.now() : () => Date.now());
        this.running = false;
        this.accumulator = 0;
        this.lastTime = 0;
        this.frame = 0;
        this.ticks = 0;
        this.fps = 0;
        this._fpsAcc = 0;
        this._fpsFrames = 0;
    }

    start() {
        if (this.running || !this.raf) return this;
        this.running = true;
        this.lastTime = this.now();
        const tick = () => {
            if (!this.running) return;
            this.advance(this.now());
            this.raf(tick);
        };
        this.raf(tick);
        return this;
    }

    stop() { this.running = false; return this; }

    /** One frame at absolute time `t` (ms). Exposed for tests and manual stepping. */
    advance(t) {
        let frameTime = (t - this.lastTime) / 1000;
        this.lastTime = t;
        if (!isFinite(frameTime) || frameTime < 0) frameTime = 0;
        // Tab was in the background / breakpoint hit: never spiral into death.
        if (frameTime > this.maxFrameTime) frameTime = this.maxFrameTime;

        this.accumulator += frameTime;
        let guard = 0;
        while (this.accumulator >= this.step && guard++ < 8) {
            this.update(this.step);
            this.accumulator -= this.step;
            this.ticks++;
        }
        this.frame++;
        this._fpsAcc += frameTime;
        this._fpsFrames++;
        if (this._fpsAcc >= 0.5) {
            this.fps = Math.round(this._fpsFrames / this._fpsAcc);
            this._fpsAcc = 0;
            this._fpsFrames = 0;
        }
        this.render(this.accumulator / this.step, frameTime);
        return this;
    }
}
