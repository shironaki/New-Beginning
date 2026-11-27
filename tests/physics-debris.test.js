/**
 * Блок 72 — физика разрушений и свет на гранях.
 *
 * world/debris.js — чистая математика падения, она проверяется без канваса.
 * faceFactors из props3d.js — как палитра кадра получает светотень по стороне
 * света; сам спрайт в node не строится (нет document.createElement), и это
 * правильно: тесту нужны коэффициенты, а не растр. Там же, где растр всё-таки
 * нужен (тень осколка на земле), работает подстава document из shim.
 */
import { suite, test, assert, run } from "./tiny.js";
import { ShimCanvas } from "../tools/canvas-shim.js";
import { DebrisField, shardFan, DEBRIS } from "../js/world/debris.js";
import { faceFactors, defaultSun, paintDebris3D, propSunFor, propSpritePixels, PROPS3D, setPropSun } from "../js/render/props3d.js";

suite("падение и разрушение");

test("тело падает, отскакивает и остаётся лежать", () => {
    const f = new DebrisField();
    const b = f.spawn(100, 100, { z: 60, vz: 0, vx: 40 });
    let rested = 0;
    for (let i = 0; i < 240; i += 1) f.step(1 / 60, { onRest: () => { rested += 1; } });
    assert.eq(rested, 1, "onRest обязан сработать ровно один раз");
    assert.eq(b.z, 0, "тело должно лежать на земле");
    assert.lt(Math.abs(b.vx), DEBRIS.restSpeed, "горизонталь гаснет трением");
});

test("первый отскок выше покоя, дальше — тишина", () => {
    const f = new DebrisField();
    const b = f.spawn(0, 0, { z: 90, vz: 0 });
    let peak = 0;
    for (let i = 0; i < 30; i += 1) { f.step(1 / 60, {}); peak = Math.max(peak, b.z); }
    assert.gt(peak, 1, "упругость обязана подбросить обломок");
    for (let i = 0; i < 600; i += 1) f.step(1 / 60, {});
    assert.eq(b.z, 0, "после затухания — снова земля");
    assert.eq(f.count, 0, "лёжaщее тело не живёт вечно, оно отдаётся миру и уходит");
});

test("вода: обломок тонет и исчезает, а не лежит на поверхности", () => {
    const f = new DebrisField();
    f.spawn(0, 0, { z: 30, vz: 0 });
    let splashes = 0;
    const env = {
        isWater: () => true,
        splash: () => { splashes += 1; },
        onRest: () => { throw new Error("на воде отдыхать нечего"); }
    };
    for (let i = 0; i < 240; i += 1) f.step(1 / 60, env);
    assert.eq(splashes, 1, "всплеск один — иначе он считается каждым кадром под водой");
    assert.eq(f.count, 0, "утонуло — значит в поле его нет");
    assert.eq(f.stats.sunk, 1);
});

test("уклонистый склон гонит тело вниз, и оно не ложится", () => {
    // Рельеф: высота растёт с x, значит «вниз» — это в −x.
    const relief = { heightAt: (x) => x * 0.25 };
    const f = new DebrisField();
    const b = f.spawn(0, 0, { z: 0, vz: 0 });
    let rested = 0;
    for (let i = 0; i < 30; i += 1) f.step(1 / 60, { relief, onRest: () => { rested += 1; } });
    assert.lt(b.vx, -20, `бревно должно разогнаться, получили vx=${b.vx.toFixed(2)}`);
    assert.eq(b.vy, 0, "уклон по x не должен двигать по y");
    assert.eq(rested, 0, "на крутом склоне тело не отдыхает: оно катится");
    assert.eq(f.count, 1, "и потому остаётся в поле");
});

test("пологий холм гасит качение: тело ложится и отдаётся миру", () => {
    const relief = { heightAt: (x) => x * 0.02 };
    const f = new DebrisField();
    f.spawn(0, 0, { z: 24, vz: 0, becomes: "log" });
    let rested = 0;
    for (let i = 0; i < 120; i += 1) f.step(1 / 60, { relief, onRest: () => { rested += 1; } });
    assert.eq(rested, 1);
    assert.eq(f.count, 0, "после отдачи в мире тела в поле не остаётся");
});

test("обрыв не разгоняет тело до бесконечности", () => {
    const relief = { heightAt: (x) => (x > 0 ? 1e6 : -1e6) };
    const f = new DebrisField();
    const b = f.spawn(0, 0, { z: 0, vz: 0 });
    for (let i = 0; i < 120; i += 1) f.step(1 / 60, { relief });
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), "координаты обязаны остаться числами");
    assert.lt(Math.abs(b.vx), 5000, "скорость ограничена: уклон capped");
});

test("пул фиксированный: старые тела уходят первыми", () => {
    const f = new DebrisField({ max: 4 });
    for (let i = 0; i < 10; i += 1) f.spawn(i, 0, { z: 1, vz: 0, kind: "scree" });
    assert.eq(f.count, 4);
    assert.eq(f.stats.dropped, 6);
    assert.eq(f.list[3].x, 9, "остались последние четыре");
});

test("шаг не пересоздаёт массив тел", () => {
    const f = new DebrisField();
    f.spawn(0, 0, { z: 40 });
    const ref = f.list;
    for (let i = 0; i < 30; i += 1) f.step(1 / 60, {});
    assert.ok(f.list === ref, "поле не аллоцируется на тик");
});

test("осколки расходятся веером вокруг оси падения", () => {
    const out = shardFan([], 0, 0, { count: 5, dir: 0, spread: 0.6, power: 100, kind: "log" });
    assert.eq(out.length, 5);
    assert.ok(out.every(s => s.kind === "log"));
    assert.gt(out[0].vx, 0, "все куски летят по направлению падения, а не в стороны");
    assert.lt(out[0].vy, 0, "крайние разнесены перпендикулярно оси");
    assert.gt(out[4].vy, 0);
    assert.near(out[0].vy, -out[4].vy, 1e-6, "веер симметричен относительно оси");
    assert.lt(out[0].vz, out[2].vz, "дальние куски летят выше — иначе это не распад, а сдувание");
    const axis = shardFan([], 0, 0, { count: 1, dir: Math.PI / 2, power: 100 })[0];
    assert.ok(Math.abs(axis.vy) > Math.abs(axis.vx), "ось веера следует за направлением удара");
});

test("тяжёлый обломок задевает героя один раз", () => {
    const f = new DebrisField();
    f.spawn(0, 0, { z: 20, vz: 0, scale: 1, hit: { radius: 40, damage: 9 } });
    let hits = 0;
    for (let i = 0; i < 60; i += 1) {
        f.step(1 / 60, { player: { x: 4, y: 0 }, onHitPlayer: () => { hits += 1; } });
    }
    assert.eq(hits, 1, "задело — один раз, а не каждый кадр");
});

suite("свет на гранях запечённого пропа");

test("нулевое солнце = кадр без правки", () => {
    const f = faceFactors({ ...defaultSun(), amp: 0, amb: 1 });
    for (let b = 1; b <= 6; b += 1) assert.eq(f[b], 1, `грань ${b} не должна меняться`);
});

test("низкое солнце с востока: восточные грани светлее западных", () => {
    const east = faceFactors({ ...defaultSun(), dir: 1, elev: 0.25, amp: 1, amb: 0.6 });
    assert.gt(east[1], east[2], "восток (+X) обязан светиться сильнее запада");
    assert.gt(east[3], east[4], "верх освещён сильнее низа");
    const west = faceFactors({ ...defaultSun(), dir: -1, elev: 0.25, amp: 1, amb: 0.6 });
    assert.gt(west[2], west[1], "солнце с другой стороны переворачивает светотень");
    assert.lt(west[1], east[1], "западная грань при восточном солнце — самая тёмная");
});

test("полночь приглушает, но не выбивает в чёрное", () => {
    const day = faceFactors({ ...defaultSun(), dir: 0.8, elev: 0.8, amp: 1, amb: 1 });
    const night = faceFactors({ ...defaultSun(), dir: 0.8, elev: 0.8, amp: 0.35, amb: 0.5 });
    assert.lt(night[3] - night[4], day[3] - day[4], "ночью разница граней мягче");
    assert.gt(night[4], 0.15, "ночная тень не должна съедать материал");
    assert.lt(night[3], day[3]);
});

test("шероховатость бури остаётся в вменяемых границах", () => {
    for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
            const f = faceFactors({ ...defaultSun(), dir: 1, elev: 0.5, amp: 1, amb: 1, rough: 1 }, x, y);
            for (let b = 1; b <= 6; b += 1) {
                assert.gt(f[b], 0.2, `коэффициент выбран слишком: ${f[b]}`);
                assert.lt(f[b], 3, `коэффициент задут: ${f[b]}`);
            }
        }
    }
});

test("шероховатость разная по кадру, но одна и та же для двух прогонов", () => {
    const sun = { ...defaultSun(), dir: 1, elev: 0.5, amp: 1, amb: 1, rough: 1 };
    const a = faceFactors(sun, 3, 5)[1];
    const b = faceFactors(sun, 3, 5)[1];
    const c = faceFactors(sun, 4, 5)[1];
    assert.eq(a, b, "тот же пиксель — тот же шум, иначе кадр мерцает");
    assert.not(a === c, "разные пиксели обязаны различаться, иначе шум декоративный");
});

/* --------------------- свет: числа → пиксели реального кадра --------------------- */

// Кадр строится только если в среде есть createElement('canvas'); shim-канвас
// даёт честные пиксельные буферы (тот же, что у галереи скриншотов).
const docSaved = globalThis.document;
globalThis.document = { createElement: (tag) => (tag === "canvas" ? new ShimCanvas(4, 4) : { style: {} }) };

suite("свет в кадре пропа");

function luminance(px) {
    let sum = 0, n = 0;
    for (let i = 0; i < px.data.length; i += 4) {
        if (px.data[i + 3] < 8) continue;
        sum += 0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2];
        n += 1;
    }
    return { mean: n ? sum / n : 0, lit: n };
}

test("без поправки на солнце кадр остаётся запечённым", () => {
    setPropSun(defaultSun());
    const px = propSpritePixels("pine", "plain");
    assert.ok(px, "shim-канвас обязан выдать кадр");
    assert.gt(px.w * px.h, 0);
});

test("низкое солнце меняет растр, но не протыкает его в дырки", () => {
    setPropSun(defaultSun());
    const flat = propSpritePixels("pine", "plain");
    setPropSun({ dir: -1, elev: 0.28, amp: 1, amb: 1, rough: 0 });
    const lit = propSpritePixels("pine", "plain");
    let diff = 0, opaque = 0;
    for (let i = 0; i < flat.data.length; i += 4) {
        const a = flat.data[i + 3] > 8, b = lit.data[i + 3] > 8;
        assert.eq(a, b, "непрозрачность не зависит от света: иначе на дереве появляются дырки");
        if (!a) continue;
        opaque += 1;
        if (flat.data[i] !== lit.data[i] || flat.data[i + 1] !== lit.data[i + 1]) diff += 1;
    }
    assert.gt(diff, 40, `свет обязан задеть пиксели, задето ${diff} из ${opaque}`);
    // Важно не «сколько пикселей поменялось», а «сколькими способами»: один
    // коэффициент на весь кадр — это затемнение, несколько — светотень.
    const steps = new Set();
    for (let i = 0; i < flat.data.length; i += 4) {
        if (flat.data[i + 3] < 8) continue;
        steps.add(`${flat.data[i] - lit.data[i]}:${flat.data[i + 1] - lit.data[i + 1]}`);
    }
    assert.gte(steps.size, 3, `грани должны светиться по-разному, шагов яркости: ${steps.size}`);
});

test("ночь темнее полудня, но не чёрная", () => {
    const noon = propSunFor({ weather: "clear" }, { dx: 0.55, dy: 0.30, alpha: 1 });
    const night = propSunFor({ weather: "clear" }, { dx: 0.55, dy: 0.30, alpha: 0 });
    setPropSun(noon);
    const day = luminance(propSpritePixels("pine", "plain"));
    setPropSun(night);
    const dark = luminance(propSpritePixels("pine", "plain"));
    assert.lt(dark.mean, day.mean, "ночью должно быть темнее");
    assert.gt(dark.mean, day.mean * 0.35, "ночь не должна съедать материал целиком");
});

test("буря глушит свет и добавляет блеск", () => {
    const clear = propSunFor({ weather: "clear" }, { dx: 0.55, dy: 0.45, alpha: 1 });
    const storm = propSunFor({ weather: "storm", groundWet: 1 }, { dx: 0.55, dy: 0.45, alpha: 1 });
    assert.lt(storm.amp, clear.amp, "в бурю свет рассеянный — контраст граней падает");
    assert.gt(storm.rough, 0.3, "и мокрая кора обязана бликовать");
    assert.eq(storm.amb, clear.amb, "яркость неба задаёт день, а не погода");
    assert.eq(clear.dir, storm.dir, "направление солнца общее для любой погоды");
});

test("вечер меняет сторону света, а не только яркость", () => {
    const low = propSunFor({ weather: "clear" }, { dx: 0.55, dy: 0.6, alpha: 1 });
    const noon = propSunFor({ weather: "clear" }, { dx: 0.55, dy: 0.3, alpha: 1 });
    assert.lt(low.dir, 0, "тени уходят вправо (dx > 0) — значит свет приходит слева");
    assert.lt(low.elev, 0.35, "низкое солнце над горизонтом");
    assert.gt(noon.elev, low.elev, "в полдень солнце выше");
});

// Shim-документ оставляем: tiny.js исполняет тесты только в run(), а она ниже —
// вернуть среду «как было» в этом же файле уже некуда, да и незачем: процесс
// тестов на этом заканчивается.
void docSaved;

test("щепка пружинит меньше обломка и ложится быстрее", () => {
    // Тот же импульс, разная масса: без поправки «дождь из щепок» подпрыгивал
    // как полено и висел в воздухе — ровно та претензия, из-за которой rule
    // вообще придумали.
    const light = new DebrisField(), heavy = new DebrisField();
    const a = light.spawn(100, 100, { z: 70, vz: 0, vx: 0, scale: 0.35 });
    const b = heavy.spawn(100, 100, { z: 70, vz: 0, vx: 0, scale: 1.6 });
    assert.lt(a.mass, b.mass, "масса обязана расти с размером кадра");
    let peakLight = 0, peakHeavy = 0, wasAir = false;
    for (let i = 0; i < 240; i += 1) {
        light.step(1 / 60, {}); heavy.step(1 / 60, {});
        if (a.z > 0.5) wasAir = true;
        if (wasAir) { peakLight = Math.max(peakLight, a.vz); peakHeavy = Math.max(peakHeavy, b.vz); }
    }
    assert.lt(peakLight, peakHeavy, "лёгкий осколок не имеет права отскакивать выше тяжёлого");
    assert.ok(a.grounded && a.z === 0 && b.z === 0, "оба тела обязаны лечь, а не остаться в полёте");
});

suite("осколок в полёте");

test("тень остаётся на земле, когда тело поднялось", () => {
    // Ключевое слово «висит» в претензии владельца означало ровно это: осколок
    // летел, а вместе с ним летела и тень — то есть кадру было нечем сказать,
    // где земля. Рисуем одно и то же тело на земле и в 40 px над ней.
    if (!globalThis.document) {
        globalThis.document = { createElement: (tag) => (tag === "canvas" ? new ShimCanvas(1, 1) : {}) };
    }
    PROPS3D.enabled = true;
    const shot = (z) => {
        const cv = new ShimCanvas(90, 120), ctx = cv.getContext("2d");
        ctx.translate(45, 100);                                   // «ноги» тела — точка на земле
        paintDebris3D(ctx, { kind: "log", z, scale: 1, size: 1, settling: 0, ang: 0 }, { settle: 0.18 });
        const band = (y0, y1) => {
            let n = 0;
            for (let y = y0; y < y1; y++) for (let x = 0; x < 90; x++) if (cv.data[(y * 90 + x) * 4 + 3] > 0) n++;
            return n;
        };
        return { ground: band(94, 106), air: band(40, 66) };
    };
    const onGround = shot(0), flying = shot(40);
    // На земле пятно широкое, в полёте — сжавшееся: важно не «сколько пикселей»,
    // а что оно не улетает вместе с телом: без него кадр читается «приклеен к
    // воздуху».
    assert.ok(onGround.ground > 20 && flying.ground > 8,
        `пятно на земле обязано остаться при любой высоте (на земле ${onGround.ground}, в полёте ${flying.ground})`);
    assert.ok(flying.air > 20, "поднятое тело рисуется над землёй, а не вмазывается в неё");
    assert.ok(onGround.air < flying.air, "на земле в верхних строках кадра быть нечего");
});

await run("physics-debris");
