/**
 * v3 entities — the hero.
 *
 * Movement is analogue (gentle stick = walk, full push = run), stamina gates
 * sprinting and — from stage 2 — attacks. Collision uses the zone's combined
 * terrain + prop solidity, so a pine actually stops you.
 */
import { moveAndCollide } from "../world/tilemap.js";
import { TILE_SIZE } from "../world/tiles.js";
import { GAIT, approach } from "../render/charspec.js";

export const DIRS = ["down", "left", "right", "up"];

export class Player {
    constructor({ x = 0, y = 0, bus = null } = {}) {
        this.x = x; this.y = y;
        this.vx = 0; this.vy = 0;
        this.radius = 9;
        this.dir = "down";
        this.walkSpeed = 68;     // world units / second
        this.runSpeed = 118;
        this.stamina = 100;
        this.maxStamina = 100;
        this.bus = bus;
        // --- locomotion state (simulation side, fixed step => FPS independent)
        this.anim = 0;           // walk cycle phase, radians (alias: `phase`)
        this.dist = 0;           // metres of ground actually covered
        this.gait = 0;           // 0 standing .. 1 full stride, blended
        this.runBlend = 0;       // 0 walking .. 1 running, blended
        this.moving = false;
        this.running = false;
        this.actionTimer = 0;    // tool swing animation
        this.actionKind = null;
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
    update(dt, axis, zone, { speedFactor = 1, wantRun = false } = {}) {
        if (this.actionTimer > 0) this.actionTimer = Math.max(0, this.actionTimer - dt);
        if (this.sleeping) {
            this.moving = false;
            this.gait = approach(this.gait, 0, dt, GAIT.blendWalk);
            this.runBlend = approach(this.runBlend, 0, dt, GAIT.blendRun);
            return this;
        }

        const mag = Math.hypot(axis.x, axis.y);
        this.moving = mag > 0.01;

        // Sprint costs stamina; walking and standing restore it.
        const canRun = wantRun && this.stamina > 6 && mag > 0.6;
        this.running = canRun;
        if (canRun) this.stamina = Math.max(0, this.stamina - 16 * dt);
        else this.stamina = Math.min(this.maxStamina, this.stamina + (this.moving ? 7 : 14) * dt);

        if (!this.moving) {
            this.vx = this.vy = 0;
            this.settle(dt);
            return this;
        }

        // Analogue magnitude scales speed; sprint overrides the top end.
        const base = canRun ? this.runSpeed : this.walkSpeed;
        const terrain = zone ? zone.map.speedAt(this.x, this.y) : 1;
        const speed = base * Math.min(1, mag) * speedFactor * terrain;

        const dx = axis.x * speed * dt;
        const dy = axis.y * speed * dt;

        if (Math.abs(axis.x) > Math.abs(axis.y)) this.dir = axis.x > 0 ? "right" : "left";
        else this.dir = axis.y > 0 ? "down" : "up";

        const x0 = this.x, y0 = this.y;
        if (zone) {
            const res = moveAndCollide(zone.map, this.x, this.y, dx, dy, this.radius,
                (wx, wy) => zone.isBlockedTile(Math.floor(wx / TILE_SIZE), Math.floor(wy / TILE_SIZE)) ||
                            zone.propSolidAt(wx, wy));
            this.x = res.x; this.y = res.y;
        } else {
            this.x += dx; this.y += dy;
        }

        // Distance ACTUALLY covered — after collision, after terrain slowdown.
        // Everything the legs do is derived from this, so a foot plant always
        // matches the ground under it: no skating, no legs lagging the torso.
        const moved = Math.hypot(this.x - x0, this.y - y0);
        this.dist += moved;
        this.advance(dt, moved, canRun);

        this.vx = (this.x - x0) / dt; this.vy = (this.y - y0) / dt;
        return this;
    }

    /**
     * Distance-driven walk cycle.
     * One full cycle = `stride` pixels of ground, so the swing amplitude
     * declared in charspec cancels the ground travel exactly.
     */
    advance(dt, moved, running) {
        this.runBlend = approach(this.runBlend, running ? 1 : 0, dt, GAIT.blendRun);
        this.gait = approach(this.gait, 1, dt, GAIT.blendWalk);
        const stride = GAIT.strideWalk + (GAIT.strideRun - GAIT.strideWalk) * this.runBlend;
        const step = (moved / stride) * Math.PI * 2;
        const cap = GAIT.cadenceCap * Math.PI * 2 * dt;      // no sewing machine
        this.anim = (this.anim + Math.min(step, cap)) % (Math.PI * 2);
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

    toJSON() { return { x: this.x, y: this.y, dir: this.dir, stamina: this.stamina, name: this.name }; }
    load(d) { if (d) Object.assign(this, d); return this; }
}
