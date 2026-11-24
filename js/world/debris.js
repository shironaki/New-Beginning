/**
 * world/debris.js — падающие обломки: брёвна, щебень, куски крыши.
 *
 * Это НЕ «particles». Частицы (js/render/particles.js) живут полсекунды и
 * ничего не решают: щепка, искра, пыльной след. Здесь — тела с последствиями:
 * бревно, спиленное на склоне, укатывается вниз и ложится в воду; каменная
 * осыпь от удара кирки растекаться должна веером; кусок стены убивает не только
 * стройку, но и героя, если тот стоял слишком близко.
 *
 * Координаты те же, что у пропов (x,y — экранные пиксели мира при зуме 1, y
 * вниз), а высота вынесена отдельно (`z` над землёй): мир плоский, с рельефом
 * как накидкой, поэтому «горизонталь» — это x,y, а падение — z. Так тело катится
 * по склону (ускорение берётся из градиента рельефа) и подпрыгивает, не требуя
 * настоящего 3D-движка.
 *
 * Честно про долги:
 *   • тела не сталкиваются ни друг с другом, ни с пропами — только с землёй и
 *     водой. Для щепки это простительно, для бревна заметно;
 *   • в сейв ничего не пишется: обломок живёт секунды. Долго лежащее бревно —
 *     это уже проп (`becomes` → `onRest`), а не физика;
 *   • вращение только вокруг «экранной» оси z: для low-poly кадра этого хватает,
 *     настоящая кувыркающаяся модель потребовала бы перепека на несколько
 *     ракурсов.
 */

export const DEBRIS = {
    gravity: 900,          // px/s² — как быстро падает на землю
    slopeAccel: 0.55,      // доля g, уходящая вдоль градиента рельефа
    // relief.heightAt отдаёт подъём в тех же пикселях, что и x,y (см. unprojectY),
    // значит градиент — это и есть уклон, px на px. Обрывистые стенки дают до
    // нескольких единиц, и их надо обрезать, иначе тело улетает за кадр.
    slopeCap: 1.6,
    restitution: 0.34,     // упругость удара о землю
    groundFriction: 0.80,  // торможение о землю в момент касания (событие, не секунды)
    // Трение и сопротивление воздуха — это доли скорости, остающиеся ЧЕРЕЗ
    // секунду. В такой единице шаг 30 fps и 60 fps дают одинаковую траекторию;
    // записанные «на кадр» числа (как было сначала) делают бревно клеющимся на
    // 60 fps и скользящим на 30.
    rollFriction: 0.86,    // качение по земле
    airDrag: 0.48,         // полёт: щепка тормозит о воздух почти сразу…
    restSpeed: 16,         // ниже — тело считается лежащим
    restHold: 0.2,         // сек., в течение которых уклон не должен уметь разогнать тело
    restVz: 26,            // и не подпрыгивает выше этого
    settle: 0.18,          // сек. «дохода в покой»: тело ещё рисуется, но уже никуда
    speedCap: 300,         // предел горизонтальной скорости: обрыв не должен превращать бревно в снаряд
    spinFromV: 0.0042,     // рад/с на px/с горизонтальной скорости
    bounceSpin: 0.55,      // насколько сильно подкрутить при ударе
    sinkAfter: 0.7,        // сек. под водой до исчезновения
    splashVz: -70,         // отскок от воды (вниз) — тонем мягко
    max: 120,
    life: 14               // страховка: дольше этого тело не живёт никогда
};

/**
 * Поле тел. Пул фиксированный, мусора нет: `spawn` переиспользует освободившийся
 * слот, `step` убирает мёртвое обменом с последним — тот же приём, что у FX.
 */
export class DebrisField {
    constructor(opts = {}) {
        this.cfg = { ...DEBRIS, ...opts };
        this.bodies = [];
        this.stats = { live: 0, sunk: 0, rested: 0, dropped: 0 };
    }

    get list() { return this.bodies; }
    get count() { return this.bodies.length; }

    /**
     * kind — вид запечённого пропа, которым тело рисуется (log, scree, crate…),
     * scale — множитель кадра, becomes — во что оно превращается в мире, когда
     * легло (kind статичного пропа или null), hit — урон по герою на пути.
     */
    spawn(x, y, o = {}) {
        const cfg = this.cfg;
        if (this.bodies.length >= cfg.max) { this.bodies.shift(); this.stats.dropped += 1; }
        const speed = Math.hypot(o.vx || 0, o.vy || 0);
        const seed = o.seed !== undefined ? o.seed : (this.bodies.length % 2);
        const body = {
            x, y, z: o.z === undefined ? 12 : o.z,
            vx: o.vx || 0, vy: o.vy || 0, vz: o.vz === undefined ? 120 : o.vz,
            kind: o.kind || "log",
            scale: o.scale || 1,
            ang: o.ang || 0,
            spin: o.spin !== undefined ? o.spin : speed * cfg.spinFromV * (seed ? -1 : 1),
            mass: o.mass || 1,
            grounded: false,
            sinking: 0,
            settling: 0,
            life: o.life || cfg.life,
            becomes: o.becomes === undefined ? null : o.becomes,
            hit: o.hit ? { radius: o.hit.radius || 26, damage: o.hit.damage || 6, done: false } : null
        };
        this.bodies.push(body);
        return body;
    }

    /**
     * env: { relief?, isWater?(x,y), onRest?(body), onHitPlayer?(body,dmg),
     *        splash?(x,y,body), player?: {x,y} }
     * Вызывается раз за тик из игры; аллокаций ноль.
     */
    step(dt, env = {}) {
        const cfg = this.cfg;
        const relief = env.relief;
        const list = this.bodies;
        for (let i = list.length - 1; i >= 0; i -= 1) {
            const b = list[i];
            b.life -= dt;

            // --- под водой: только вниз, только затухание ----------------------
            if (b.sinking > 0) {
                b.sinking += dt;
                b.z -= 40 * dt;
                const mud = Math.pow(0.1, dt);
                b.vx *= mud; b.vy *= mud;
                if (b.sinking > cfg.sinkAfter || b.life <= 0) { this.stats.sunk += 1; kill(i); }
                continue;
            }
            if (b.life <= 0) { kill(i); continue; }

            // --- уклон: градиент рельефа даёт горизонтальное ускорение --------
            b.slopeForce = 0;
            if (relief && relief.heightAt) {
                const e = 8;
                let gx = (relief.heightAt(b.x + e, b.y) - relief.heightAt(b.x - e, b.y)) / (2 * e);
                let gy = (relief.heightAt(b.x, b.y + e) - relief.heightAt(b.x, b.y - e)) / (2 * e);
                const cap = cfg.slopeCap;
                gx = Math.max(-cap, Math.min(cap, gx));
                gy = Math.max(-cap, Math.min(cap, gy));
                // В полёте склон почти не властен: тело ещё висит на инерции.
                const k = cfg.slopeAccel * cfg.gravity * dt * (b.grounded ? 1 : 0.35);
                b.vx -= gx * k;
                b.vy -= gy * k;
                // Запоминаем, насколько сильно склон вообще может разогнать: без
                // этого бревно на склоне «ложится» в первом же кадре, потому что
                // скорость у него в момент касания ещё нулевая.
                b.slopeForce = Math.hypot(gx, gy) * cfg.slopeAccel * cfg.gravity;
            }

            // --- полёт и опора -------------------------------------------------
            b.vz -= cfg.gravity * dt;
            b.z += b.vz * dt;
            // На земле тормозит качение, а не воздух: щепка в полёте теряет
            // скорость мгновенно, бревну (mass 4) воздух почти не помеха.
            const drag = b.grounded ? 1 : Math.pow(cfg.airDrag, dt / (b.mass || 1));
            b.vx *= drag; b.vy *= drag;
            const sp = Math.hypot(b.vx, b.vy);
            if (sp > cfg.speedCap) { const s = cfg.speedCap / sp; b.vx *= s; b.vy *= s; }
            b.x += b.vx * dt;
            b.y += b.vy * dt;

            if (b.z <= 0) {
                b.z = 0;
                if (env.isWater && env.isWater(b.x, b.y)) {
                    b.sinking = 0.0001;
                    b.vz = cfg.splashVz;
                    if (env.splash) env.splash(b.x, b.y, b);
                    continue;
                }
                const impact = -b.vz;
                // Порог «это падение, а не покой» обязан зависеть от шага: за один
                // кадр при 30 fps гравитация набирает вдвое больше скорости, и без
                // поправки каждый второй шаг выглядел бы как удар с трением.
                const restImpact = Math.max(cfg.restVz, cfg.gravity * dt * 1.5);
                if (impact > restImpact) {
                    b.vz = impact * cfg.restitution;
                    b.vx *= cfg.groundFriction; b.vy *= cfg.groundFriction;
                    b.spin += (b.vx + b.vy) * cfg.bounceSpin * 0.01;
                    b.grounded = false;
                } else {
                    b.vz = 0;
                    b.grounded = true;
                    const roll = Math.pow(cfg.rollFriction, dt);
                    b.vx *= roll; b.vy *= roll;
                }
            } else if (b.z > 0.5) {
                b.grounded = false;
            }

            b.ang += b.spin * dt;
            b.spin *= 1 - (b.grounded ? 1.6 : 0.25) * dt;

            // --- тело задело героя ---------------------------------------------
            if (b.hit && !b.hit.done && env.player) {
                const dx = env.player.x - b.x, dy = (env.player.y - b.y) * 1.4;   // экран сжат по Y
                const r = b.hit.radius * (0.6 + b.scale);
                if (dx * dx + dy * dy < r * r) {
                    b.hit.done = true;
                    if (env.onHitPlayer) env.onHitPlayer(b, b.hit.damage * b.scale * b.mass);
                }
            }

            // --- покой: ещё кадр рисуется, но мир уже получил тело --------------
            if (!b.settling && b.grounded && b.z <= 0.01
                && Math.hypot(b.vx, b.vy) < cfg.restSpeed
                && (b.slopeForce || 0) * cfg.restHold < cfg.restSpeed) {
                b.settling = cfg.settle;
                this.stats.rested += 1;
                if (env.onRest) env.onRest(b);
            }
            if (b.settling > 0) {
                b.settling -= dt;
                if (b.settling <= 0) kill(i);
            }

            function kill(idx) { list.splice(idx, 1); }
        }
        this.stats.live = list.length;
        return this;
    }

    clear() { this.bodies.length = 0; this.stats.live = 0; return this; }
}

/**
 * Веер осколков — «из чего состоит разрушение». Направление задаётся осью
 * падения, разброс — углом и скоростью, масса спрятана в scale (она влияет на
 * то, как далеко улетит кусок, только через начальный импульс — честной
 * инерции формы здесь нет, и не предвидится).
 */
export function shardFan(out, x, y, opts = {}) {
    const n = Math.max(1, opts.count || 3);
    const dir = opts.dir === undefined ? 0 : opts.dir;
    const spread = opts.spread === undefined ? 1.25 : opts.spread;
    const power = opts.power || 120;
    const rng = opts.rng;
    for (let i = 0; i < n; i += 1) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const a = dir + (t - 0.5) * spread * 2;
        const jitter = rng && rng.chance ? rng.chance(1) : 0.5;
        const v = power * (0.6 + 0.6 * jitter);
        out.push({
            x, y,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v * 0.55,                 // экран сжат по Y
            vz: (opts.lift || 90) * (0.7 + 0.6 * t),
            kind: opts.kind || "log",
            scale: (opts.scale || 0.4) * (0.75 + 0.5 * t),
            mass: opts.mass || 1,
            becomes: opts.becomes === undefined ? null : opts.becomes,
            spin: (t - 0.5) * 6,
            seed: t > 0.5 ? 1 : 0,
            hit: opts.hit ? {
                radius: opts.hit.radius || 24,
                damage: (opts.hit.damage || 5) * (opts.mass || 1)
            } : null
        });
    }
    return out;
}
