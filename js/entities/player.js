/**
 * entities — the hero.
 *
 * Movement is analogue (gentle stick = walk, full push = run), stamina gates
 * sprinting and — from stage 2 — attacks. Collision uses the zone's combined
 * terrain + prop solidity, so a pine actually stops you.
 */
import { moveAndCollide } from "../world/tilemap.js";
import { ICE } from "../world/surface.js";
import { TILE_SIZE } from "../world/tiles.js";
import { GAIT, MOVE, approach } from "../render/charspec.js";

export const DIRS = ["down", "left", "right", "up"];

export class Player {
    constructor({ x = 0, y = 0, bus = null } = {}) {
        this.x = x; this.y = y;
        this.vx = 0; this.vy = 0;       // measured, after collision
        this.leanAX = 0; this.leanAY = 0; // filtered physical acceleration, visual only
        this.ax = 0; this.ay = 0;       // wanted acceleration, from the model
        this.mvx = 0; this.mvy = 0;     // wanted velocity carried between frames
        this.radius = 9;
        this.dir = "down";
        this.walkSpeed = 68;     // world units / second
        this.runSpeed = 118;
        this.stamina = 100;
        this.maxStamina = 100;
        this.bus = bus;
        // --- locomotion state (simulation side, fixed step => FPS independent)
        this.anim = 0;
        this.faceX = 0; this.faceY = 1;
        this.slant = 0;             // vertical share of a diagonal, -1..1
        this.stepEvent = false;     // a foot just planted
        this.stepSide = 1;          // 1 = right foot, -1 = left
        this.steps = 0;             // total foot plants this session
        this.wet = 0;               // seconds of soaked boots left (set by the game)
        // walk cycle phase lives in `anim`, radians
        this.dist = 0;           // metres of ground actually covered
        this.gait = 0;           // 0 standing .. 1 full stride, blended
        this.runBlend = 0;       // 0 walking .. 1 running, blended
        this.moving = false;
        this.running = false;
        this.sprintLocked = false;
        this.iceCarry = 0; this.onIce = false;
        this.fallDirX = 1; this.fallDirY = 0;
        this.actionTimer = 0;    // tool swing animation
        this.actionKind = null;
        this.fallTimer = 0;
        this.slipCooldown = 0;
        this.slipDistance = 0;
        this.slipChecks = 0;
        this.sleeping = false;
        this.name = "Странник";
    }

    get tx() { return Math.floor(this.x / TILE_SIZE); }
    get ty() { return Math.floor(this.y / TILE_SIZE); }

    /** The tile the hero is facing — the target of every interaction. */
    facingPoint(distance = 18) {
        const d = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[this.dir];
        return { x: this.x + d[0] * distance, y: this.y + d[1] * distance };
    }

    swing(kind = "tool", time = 0.35) {
        this.actionTimer = time;
        this.actionKind = kind;
        return this;
    }

    /**
     * @param {number} dt seconds
     * @param {{x:number,y:number}} axis normalised input vector
     * @param {Zone} zone current zone (terrain + props)
     * @param {object} opts { speedFactor, wantRun }
     */
    /**
     * Movement runs on a FIXED step, whatever the frame rate is. The velocity
     * ramp is analytic and frame-rate free on its own, but the things it is
     * sampled against are not: terrain speed under the feet, collision slides
     * along a rock, the stamina gate. Sampling those once per rendered frame
     * made 30 FPS cover a couple of pixels more than 120 over a long run.
     * With a fixed step and a carried remainder every rate walks the same
     * ground, and `tools/replay.js` holds it to half a pixel.
     */
    update(dt, axis, zone, opts = {}) {
        const STEP = MOVE.step;
        this._acc = (this._acc || 0) + dt;
        // A long hitch must not turn into a hundred steps of catch-up.
        if (this._acc > MOVE.maxCatchUp) this._acc = MOVE.maxCatchUp;
        let did = false;
        // The epsilon matters: 4 × (1/120) is not bit-for-bit 1/30, and
        // without it a 30 FPS frame would now and then be one step short.
        while (this._acc >= STEP - MOVE.stepEps) {
            this._acc = Math.max(0, this._acc - STEP);
            this._step(STEP, axis, zone, opts);
            did = true;
        }
        // Very small frames still need the non-physical bookkeeping to tick.
        if (!did && dt > 0) this._idleTick(dt);
        return this;
    }

    /** Timers that must not wait for a physics step (action swing, blends). */
    _idleTick(dt) {
        if (this.actionTimer > 0) this.actionTimer = Math.max(0, this.actionTimer - dt);
        return this;
    }

    _step(dt, axis, zone, { speedFactor = 1, wantRun = false, surfaceAt = null } = {}) {
        if (this.actionTimer > 0) this.actionTimer = Math.max(0, this.actionTimer - dt);
        if (this.sleeping) {
            this.moving = this.running = false;
            this.updateLean(dt, 0, 0);
            this.ax = this.ay = 0;
            this.gait = approach(this.gait, 0, dt, GAIT.blendWalk);
            this.runBlend = approach(this.runBlend, 0, dt, GAIT.blendRun);
            return this;
        }

        const sprintRequested = wantRun;
        this.slipCooldown = Math.max(0, this.slipCooldown - dt);
        if (this.fallTimer > 0) {
            this.fallTimer = Math.max(0, this.fallTimer - dt);
            axis = { x: 0, y: 0 }; wantRun = false;
        }
        const surface = surfaceAt ? surfaceAt(this.x, this.y) : null;
        const icy = !!surface?.ice;
        this.onIce = icy;
        this.iceCarry = icy ? ICE.edgeMemory : Math.max(0, this.iceCarry - dt);
        const slick = icy || this.iceCarry > 0;
        const mag = Math.hypot(axis.x, axis.y);
        this.moving = mag > 0.01;

        // Separate stop/resume thresholds prevent 70 Hz run/walk chatter at
        // exhaustion. Retrying also requires an actual key release.
        if (!sprintRequested) this.sprintLocked = false;
        else if (this.stamina <= (this.running ? MOVE.sprintStop : MOVE.sprintResume)) this.sprintLocked = true;
        // Exhaustion latches until Shift is released: no automatic bursts
        // every time a small reserve happens to recover under a held key.
        const canRun = wantRun && !this.sprintLocked && mag > 0.6;
        this.running = canRun;
        if (canRun) this.stamina = Math.max(0, this.stamina - 16 * dt);
        else this.stamina = Math.min(this.maxStamina, this.stamina + (this.moving ? 7 : 14) * dt);

        // Analogue magnitude scales speed; sprint overrides the top end.
        const base = canRun ? this.runSpeed : this.walkSpeed;
        const terrain = zone ? zone.map.speedAt(this.x, this.y) : 1;
        const speed = base * Math.min(1, mag) * speedFactor * terrain * (surface?.slope || 1) * (icy ? ICE.speed : 1);

        // --- mass ---------------------------------------------------------
        // The hero accelerates towards the wanted velocity instead of
        // teleporting onto it, and keeps a little of it when the stick drops.
        // Slippery ground (mud, shallows) brakes worse, so the stop drifts.
        const wantX = this.moving ? (axis.x / (mag || 1)) * speed : 0;
        const wantY = this.moving ? (axis.y / (mag || 1)) * speed : 0;
        const slippery = terrain < MOVE.slipBelow;
        let tau = this.moving ? MOVE.tauStart : MOVE.tauStop * (slippery ? MOVE.slipStop : 1);
        if (this.moving && (this.mvx * wantX + this.mvy * wantY) < 0) tau = MOVE.tauTurn;
        const turningHard = this.moving && (this.mvx * wantX + this.mvy * wantY) < 0;
        if (slick) tau = this.moving ? (turningHard ? ICE.tauTurn : ICE.tauMove) : ICE.tauStop;
        if (this.fallTimer > 0) tau = slick ? ICE.tauFallen : ICE.tauFallenDry;
        // Exact integration of dv/dt = (want - v)/tau over the frame, both
        // for the velocity and for the ground it covers. Euler would make the
        // ramp depend on the frame rate, and 30 FPS would walk a different
        // distance than 120 — the one thing locomotion must never do.
        const decay = Math.exp(-dt / tau);
        const vx0 = this.mvx, vy0 = this.mvy;
        this.mvx = wantX + (vx0 - wantX) * decay;
        this.mvy = wantY + (vy0 - wantY) * decay;
        // Acceleration, taken from the model rather than measured between
        // frames: a = (want - v) / tau. Exactly the same number at 30, 60 and
        // 120 FPS, which a (v - vPrev)/dt difference would never be. The
        // renderer leans the torso into it.
        this.ax = (wantX - this.mvx) / tau;
        this.ay = (wantY - this.mvy) / tau;
        const travelX = wantX * dt + (vx0 - wantX) * tau * (1 - decay);
        const travelY = wantY * dt + (vy0 - wantY) * tau * (1 - decay);
        if (!this.moving && Math.hypot(this.mvx, this.mvy) < MOVE.stopBelow) {
            this.mvx = this.mvy = 0;
            this.vx = this.vy = 0;
            this.ax = this.ay = 0;
            this.updateLean(dt, 0, 0);
            this.settle(dt);
            return this;
        }

        const dx = travelX;
        const dy = travelY;

        // Facing. On a diagonal the SIDE view wins: it is the only pose with a
        // readable stride, and a front view sliding sideways is what makes
        // diagonal movement look like the hero is on rails. The 0.55 bias
        // means "up" and "down" still win when the input is mostly vertical.
        if (this.moving) {
            this.faceX = axis.x; this.faceY = axis.y;
            if (Math.abs(axis.x) >= Math.abs(axis.y) * 0.55) this.dir = axis.x > 0 ? "right" : "left";
            else this.dir = axis.y > 0 ? "down" : "up";
        }
        // How much of the step goes up/down screen, -1..1. The renderer uses
        // it to tilt the body into a three-quarter pose on diagonals.
        if (this.moving) {
            this.slant = Math.abs(axis.x) < 1e-6 ? 0 : Math.max(-1, Math.min(1, axis.y / Math.abs(axis.x)));
        }

        const x0 = this.x, y0 = this.y;
        if (zone) {
            const res = moveAndCollide(zone.map, this.x, this.y, dx, dy, this.radius,
                (wx, wy) => zone.isBlockedTile(Math.floor(wx / TILE_SIZE), Math.floor(wy / TILE_SIZE)),
                (px, py, r) => zone.propContact(px, py, r));
            // Hitting something eats the speed in that direction: no
            // grinding along a rock at full tilt, and no stored energy that
            // fires the hero sideways the moment the wall ends.
            if (Math.abs(res.x - (x0 + dx)) > 1e-6) this.mvx *= 0.25;
            if (Math.abs(res.y - (y0 + dy)) > 1e-6) this.mvy *= 0.25;
            this.x = res.x; this.y = res.y;
        } else {
            this.x += dx; this.y += dy;
        }

        // Distance ACTUALLY covered — after collision, after terrain slowdown.
        // Everything the legs do is derived from this, so a foot plant always
        // matches the ground under it: no skating, no legs lagging the torso.
        const moved = Math.hypot(this.x - x0, this.y - y0);
        this.dist += moved;
        if (icy && this.slipCooldown <= 0 && (canRun || turningHard)) {
            this.slipDistance += moved;
            if (this.slipDistance >= ICE.checkDistance) {
                this.slipDistance -= ICE.checkDistance;
                // Deterministic chance per distance, not per render frame.
                this.slipChecks++;
                const roll = ((Math.imul(this.slipChecks, 1103515245) + 12345) >>> 0) / 4294967296;
                if (roll < (turningHard ? ICE.chanceTurn : ICE.chanceRun)) {
                    this.fallTimer = ICE.fallTime; this.slipCooldown = ICE.cooldown;
                    const v = Math.hypot(this.mvx, this.mvy) || 1;
                    this.fallDirX = this.mvx / v; this.fallDirY = this.mvy / v;
                    this.stamina = Math.max(0, this.stamina - ICE.staminaCost);
                    this.actionTimer = 0; this.running = false;
                    if (this.bus) this.bus.emit("player:slipped", {});
                }
            }
        } else if (!icy) this.slipDistance = 0;
        if (this.fallTimer > 0) {
            this.gait = approach(this.gait, 0, dt, 0.12);
            this.runBlend = approach(this.runBlend, 0, dt, GAIT.blendRun);
        } else this.advance(dt, moved, canRun);

        const vx = (this.x - x0) / dt, vy = (this.y - y0) / dt;
        // Contact resolution must not kick the torso back and forth. Filter
        // ACTUAL acceleration at the fixed physics step, never in the painter.
        this.updateLean(dt, (vx - this.vx) / dt, (vy - this.vy) / dt);
        this.vx = vx; this.vy = vy;
        return this;
    }

    updateLean(dt, ax, ay) {
        const blend = 1 - Math.exp(-dt / GAIT.leanAccelTau);
        const limit = (v) => Math.max(-GAIT.accelRef, Math.min(GAIT.accelRef, v));
        this.leanAX += (limit(ax) - this.leanAX) * blend;
        this.leanAY += (limit(ay) - this.leanAY) * blend;
    }

    /**
     * Distance-driven walk cycle.
     * One full cycle = `stride` pixels of ground, so the swing amplitude
     * declared in charspec is capped to keep the legs within IK reach.
     */
    advance(dt, moved, running) {
        this.runBlend = approach(this.runBlend, running ? 1 : 0, dt, GAIT.blendRun);
        this.gait = approach(this.gait, Math.min(1, moved / dt / MOVE.strideFullSpeed), dt, GAIT.blendWalk);
        const stride = GAIT.strideWalk + (GAIT.strideRun - GAIT.strideWalk) * this.runBlend;
        const step = (moved / stride) * Math.PI * 2;
        const cap = GAIT.cadenceCap * Math.PI * 2 * dt;      // no sewing machine
        const adv = Math.min(step, cap);
        // A foot plants every half cycle (phase crosses k·π). Raise a flag the
        // renderer's owner can turn into dust and a sound, so the effect is
        // driven by the legs themselves and can never drift from them.
        const before = this.anim;
        const after = before + adv;
        // While coasting to a stop the legs finish the stride they are in —
        // that last couple of pixels is the foot settling, not a new step.
        if (this.moving && adv > 0 && Math.floor(after / Math.PI) > Math.floor(before / Math.PI)) {
            this.stepEvent = true;
            this.stepSide = Math.floor(after / Math.PI) % 2 === 0 ? 1 : -1;
            this.steps++;
        }
        this.anim = after % (Math.PI * 2);
        return this;
    }

    /**
     * Standing still: coast the phase to the nearest contact pose (k·π) instead
     * of snapping the legs shut, and fade the gait blend out.
     */
    settle(dt) {
        this.gait = approach(this.gait, 0, dt, GAIT.blendWalk);
        this.runBlend = approach(this.runBlend, 0, dt, GAIT.blendRun);
        const target = Math.round(this.anim / Math.PI) * Math.PI;
        const rate = (Math.PI / GAIT.park) * dt;
        const delta = target - this.anim;
        this.anim += Math.abs(delta) <= rate ? delta : Math.sign(delta) * rate;
        return this;
    }

    /** Walk cycle phase in radians — what the painter reads. */
    get phase() { return this.anim; }

    /** Effort level feeding the needs model: running burns more than standing. */
    activity() {
        if (this.sleeping) return 0.3;
        if (this.running) return 1.6;
        if (this.moving) return 1.1;
        return 0.75;
    }

    toJSON() { return { x: this.x, y: this.y, dir: this.dir, stamina: this.stamina, name: this.name, faceX: this.faceX, faceY: this.faceY, slant: this.slant,
        slipDistance: this.slipDistance, slipChecks: this.slipChecks, slipCooldown: this.slipCooldown, fallTimer: this.fallTimer,
        sprintLocked: this.sprintLocked, fallDirX: this.fallDirX, fallDirY: this.fallDirY,
        fallMotion: this.fallTimer > 0 ? [this.mvx, this.mvy, this.iceCarry] : null }; }
    load(d) {
        if (d) Object.assign(this, d);
        const facing = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[this.dir] || [0, 1];
        this.faceX = Number.isFinite(d?.faceX) ? Math.max(-1, Math.min(1, d.faceX)) : facing[0];
        this.faceY = Number.isFinite(d?.faceY) ? Math.max(-1, Math.min(1, d.faceY)) : facing[1];
        this.slant = Number.isFinite(d?.slant) ? Math.max(-1, Math.min(1, d.slant)) : 0;
        this.fallTimer = d?.fallTimer ?? 0;
        this.sprintLocked = !!d?.sprintLocked;
        this.mvx = this.mvy = this.iceCarry = 0; this.onIce = false;
        for (const [key, max] of [["fallTimer", ICE.fallTime], ["slipCooldown", ICE.cooldown], ["slipDistance", ICE.checkDistance], ["slipChecks", 4294967295]]) {
            this[key] = Number.isFinite(this[key]) ? Math.max(0, Math.min(max, this[key])) : 0;
        }
        this.slipChecks = Math.floor(this.slipChecks);
        this.sprintLocked = !!this.sprintLocked;
        this.fallDirX = Number.isFinite(this.fallDirX) ? Math.max(-1, Math.min(1, this.fallDirX)) : 1;
        this.fallDirY = Number.isFinite(this.fallDirY) ? Math.max(-1, Math.min(1, this.fallDirY)) : 0;
        if (this.fallTimer > 0 && Array.isArray(d?.fallMotion)) {
            const [x, y, carry] = d.fallMotion;
            this.mvx = Number.isFinite(x) ? Math.max(-300, Math.min(300, x)) : 0;
            this.mvy = Number.isFinite(y) ? Math.max(-300, Math.min(300, y)) : 0;
            this.iceCarry = Number.isFinite(carry) ? Math.max(0, Math.min(ICE.edgeMemory, carry)) : 0;
        }
        delete this.fallMotion;
        return this;
    }
}
