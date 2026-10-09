/** Current health causes are shared by simulation and the diagnostic panel.
 * Rates are points per game minute, not percent of maximum health. */
import { STAMINA } from "../render/charspec.js";
export const NEED_RATES = { hunger: .075, fatigue: .055, sleepRest: .22 };
export function healthEffects(needs, sleeping = false) {
    const effects = [];
    const hurt = (cause, rate) => effects.push({ cause, rate: -rate * needs.diff.damage });
    if (needs.food <= 0) hurt("Голодание", .14);
    else if (needs.food < 12) hurt("Недоедание", .05);
    if (needs.warmth < 12) hurt("Обморожение", .2);
    else if (needs.warmth < 25) hurt("Переохлаждение", .06);
    if (needs.warmth > 95) hurt("Перегрев", .05);
    if (needs.fatigue >= 100) hurt("Полное истощение", .05);
    if (!effects.length && needs.food > 45 && needs.warmth > 35 && needs.fatigue < 80)
        effects.push({ cause: sleeping ? "Восстановление во сне" : "Естественное восстановление", rate: sleeping ? .18 : .045 });
    return effects;
}
export function conditionRows(game) {
    const n = game.needs, p = game.player, ctx = game.needsContext(!!p.sleeping);
    const rates = healthEffects(n, !!p.sleeping), rate = rates.reduce((s, e) => s + e.rate, 0);
    const format = (v) => `${v > 0 ? "+" : ""}${Number(v.toFixed(3))}`;
    return [
        { html: `<b>Здоровье · ${Math.round(n.health)}%</b><br>${rates.length ? rates.map((e) => `${e.cause}: ${format(e.rate)} за игровую минуту`).join("<br>") : "Сейчас нет постоянного урона или восстановления."}${rates.length ? `<br>Суммарно: ${format(rate)} за игровую минуту (до границ 0–100).` : ""}` },
        { html: `<b>Сытость · ${Math.round(n.food)}%</b><br>${p.sleeping ? "Обмен веществ во сне" : p.running ? "Расход при беге" : "Расход при бодрствовании"}: −${(NEED_RATES.hunger * n.diff.drain * ctx.activity).toFixed(3)} за игровую минуту.` },
        { html: `<b>Бодрость · ${Math.round(100 - n.fatigue)}%</b><br>${p.sleeping ? `Сон восстанавливает: +${NEED_RATES.sleepRest}` : `Бодрствование${p.running ? " и бег" : ""}: −${(NEED_RATES.fatigue * ctx.activity * n.diff.drain).toFixed(3)}`} за игровую минуту. Это не запас для спринта.` },
        { html: `<b>Тепло · ${Math.round(n.warmth)}% · ${n.band().label}</b><br>Воздух ${ctx.ambient}°C · костёр +${ctx.fireWarmth.toFixed(1)}°C · одежда +${ctx.insulation}°C.<br>${ctx.sheltered ? "Под укрытием: +5°C." : "Без укрытия."} ${n.wet > .3 ? "Мокрая одежда: −6°C." : "Одежда не даёт штрафа за сырость."} ${ctx.activity > .8 && !p.sleeping ? "Активность: +2°C." : ""}<br>50% — комфорт, высокий показатель не всегда лучше: выше 95% начинается урон от перегрева.` },
        { html: `<b>Выносливость · ${Math.round(p.stamina)}%</b><br>${p.running ? `Бег: −${STAMINA.drain} за реальную секунду.` : p.moving ? `Шаг: +${STAMINA.walkRecovery} за реальную секунду.` : `Покой: +${STAMINA.idleRecovery} за реальную секунду.`} ${p.sprintLocked ? "Повторный спринт временно заблокирован после истощения." : ""} ${p.fallTimer > 0 ? "Падение на льду также отняло запас." : ""}` },
        { html: "Снимок состояния на момент открытия; игра на паузе. Здесь показаны действующие причины, а не история всего полученного урона. Подробный справочник восстановления появится отдельно." }
    ];
}
