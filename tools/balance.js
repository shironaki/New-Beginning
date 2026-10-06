/**
 * tools/balance.js — the survival numbers on one screen.
 *
 * Everything here is *simulated*, not copied from the contracts: the real
 * `Needs`, the real `Campfire` and the real clock are stepped minute by
 * in-game minute, so the table cannot drift away from the game the way a
 * hand-written design document does.
 *
 *   node tools/balance.js            the full report
 *   node tools/balance.js --diff hard   another difficulty
 *   npm run balance
 *
 * Read it like this: a column that says "6.2 ч" means the hero goes from a
 * full bar to an empty one in six in-game hours of doing that.
 */
import { Needs, DIFFICULTY } from "../js/survival/needs.js";
import { Campfire } from "../js/survival/campfire.js";
import { ITEMS } from "../js/sandbox/items.js";
import { MINUTES_PER_DAY } from "../js/core/time.js";
import { ambientTemperature } from "../js/survival/temperature.js";

const arg = (name, dflt) => {
    const i = process.argv.indexOf("--" + name);
    return i < 0 ? dflt : process.argv[i + 1];
};
const DIFF = arg("diff", "normal");
const hours = (minutes) => (minutes / 60).toFixed(1).padStart(5) + " ч";
const pad = (s, n) => String(s).padEnd(n);

/** Step the real Needs model until `done` says stop, or a week has passed. */
function survive(ctx, done, difficulty = DIFF) {
    const n = new Needs({ difficulty });
    for (let m = 0; m < MINUTES_PER_DAY * 7; m++) {
        n.update(1, typeof ctx === "function" ? ctx(m, n) : ctx);
        if (done(n)) return { minutes: m + 1, needs: n };
    }
    return { minutes: Infinity, needs: n };
}

console.log(`\n═══ БАЛАНС · сложность «${(DIFFICULTY[DIFF] || DIFFICULTY.normal).label}» ═══\n`);

/* ---- hunger, cold, fatigue ------------------------------------------- */

console.log("СЫТОСТЬ — от 100 до 0");
for (const [label, ctx] of [
    ["стоит на месте", { ambient: 12, activity: 0 }],
    ["идёт пешком", { ambient: 12, activity: 1.1 }],
    ["бежит", { ambient: 12, activity: 1.6 }],
    ["спит", { ambient: 12, sleeping: true }]
]) {
    const start = new Needs({ difficulty: DIFF });
    start.food = 100;
    let m = 0;
    for (; m < MINUTES_PER_DAY * 7 && start.food > 0; m++) start.update(1, ctx);
    console.log(`  ${pad(label, 18)} ${hours(m)}`);
}

console.log("\nТЕПЛО — тело дрейфует к тому, что чувствует (50 = комфорт)");
for (const [label, ctx] of [
    ["зимняя ночь, без огня", { ambient: ambientTemperature({ season: "winter", daylight: 0, weather: "clear" }), activity: 0.2 }],
    ["зимняя ночь, у костра", { ambient: ambientTemperature({ season: "winter", daylight: 0, weather: "clear" }), fireWarmth: 18, activity: 0.2 }],
    ["зимняя ночь, в палатке", { ambient: ambientTemperature({ season: "winter", daylight: 0, weather: "clear" }), sheltered: true, insulation: 6, activity: 0.2 }],
    ["осенний день", { ambient: ambientTemperature({ season: "autumn", daylight: 1, weather: "cloudy" }), activity: 1 }],
    ["промок, буря", { ambient: ambientTemperature({ season: "autumn", daylight: 0.6, weather: "storm" }), activity: 1, wet: true }]
]) {
    const n = new Needs({ difficulty: DIFF });
    if (ctx.wet) n.wet = 1;
    let danger = Infinity, m = 0;
    for (; m < MINUTES_PER_DAY * 2; m++) {
        n.update(1, ctx);
        if (danger === Infinity && n.warmth < 25) danger = m;   // the shivering band
    }
    console.log(`  ${pad(label, 24)} ${String(ctx.ambient).padStart(6)} °C`
        + `   равновесие ${n.warmth.toFixed(0).padStart(3)}`
        + `   до дрожи: ${danger === Infinity ? "  не доходит" : hours(danger)}`);
}

console.log("\nУСТАЛОСТЬ — от 10 до 100 (валится с ног)");
for (const [label, ctx] of [
    ["бодрствует", { ambient: 12, activity: 1 }],
    ["работает", { ambient: 12, activity: 1.5 }],
    ["спит (восстановление)", { ambient: 12, sleeping: true }]
]) {
    const n = new Needs({ difficulty: DIFF });
    if (ctx.sleeping) n.fatigue = 100;
    let m = 0;
    const target = ctx.sleeping ? () => n.fatigue <= 10 : () => n.fatigue >= 100;
    for (; m < MINUTES_PER_DAY * 7 && !target(); m++) n.update(1, ctx);
    console.log(`  ${pad(label, 22)} ${hours(m)}`);
}

/* ---- the fire --------------------------------------------------------- */

console.log("\nКОСТЁР — сколько горит одна единица топлива");
const fuels = Object.entries(ITEMS).filter(([, d]) => d.tags.includes("fuel") && d.burn);
for (const [id, def] of fuels.sort((a, b) => a[1].burn - b[1].burn)) {
    const fire = new Campfire({});
    fire.addFuel(id);
    const before = fire.fuel;
    fire.light({ force: true });
    let m = 0;
    while (fire.fuel > 0 && m < MINUTES_PER_DAY * 7) { fire.update(60, {}); m++; }
    console.log(`  ${pad(def.name, 18)} ${hours(m)}   (${before} с топлива, ${def.weight} кг)`);
}
{
    const fire = new Campfire({});
    let added = 0;
    while (fire.addFuel("log")) added++;
    console.log(`  ${pad("полная яма", 18)} ${added} бревна = ${hours(fire.fuel / 60)} горения`);
}

/* ---- food ------------------------------------------------------------- */

console.log("\nЕДА — сколько сытости даёт и сколько часов ходьбы это покрывает");
const drainPerMin = (() => {
    const n = new Needs({ difficulty: DIFF });
    n.food = 100;
    n.update(60, { ambient: 12, activity: 1.1 });
    return (100 - n.food) / 60;
})();
const foods = Object.entries(ITEMS).filter(([, d]) => d.food);
for (const [, def] of foods.sort((a, b) => b[1].food - a[1].food)) {
    const covers = def.food / drainPerMin;
    console.log(`  ${pad(def.name, 18)} +${String(def.food).padStart(3)} сытости`
        + `  ≈ ${hours(covers)} ходьбы`);
}

/* ---- the day ---------------------------------------------------------- */

console.log("\nСУТКИ");
const day = survive({ ambient: 10, activity: 1.1 }, (n) => n.food <= 0);
console.log(`  полный день = ${MINUTES_PER_DAY} игровых минут`);
console.log(`  с полным брюхом пешком без еды: ${hours(day.minutes)}`);
console.log(`  то есть примерно ${(day.minutes / MINUTES_PER_DAY).toFixed(2)} суток\n`);
