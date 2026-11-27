/** Installed cookware is a world object even when the fire is cold. */
export function paintCookware(ctx, fire, time = 0) {
    if (!fire?.hasPot) return;
    ctx.save();
    ctx.strokeStyle = '#443c32'; ctx.lineWidth = 1.6;
    for (const x of [-14,14]) { ctx.beginPath(); ctx.moveTo(x,-2);ctx.lineTo(x*.55,-26);ctx.stroke(); }
    ctx.beginPath();ctx.moveTo(-8,-26);ctx.lineTo(8,-26);ctx.stroke();
    ctx.strokeStyle = '#a39c83';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(0,-17,6,Math.PI,0);ctx.stroke();
    ctx.fillStyle='#272d2d'; ctx.beginPath();ctx.moveTo(-8,-17);ctx.lineTo(-6,-7);ctx.quadraticCurveTo(0,-3,6,-7);ctx.lineTo(8,-17);ctx.closePath();ctx.fill();
    ctx.fillStyle='#687572';ctx.beginPath();ctx.ellipse(0,-17,8,2.8,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=fire.pot ? '#967347' : '#202928';ctx.beginPath();ctx.ellipse(0,-17,6.2,1.8,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#91a3a0';ctx.beginPath();ctx.moveTo(-6,-15);ctx.lineTo(-4,-9);ctx.stroke();
    if(fire.lit && fire.pot) for(let i=0;i<3;i++) { const y=(time*5+i*5)%17;ctx.globalAlpha=(1-y/17)*.4;ctx.strokeStyle='#eef0dc';ctx.beginPath();ctx.moveTo(i*3-3,-20-y);ctx.quadraticCurveTo(i*3+Math.sin(time+i)*3,-23-y,i*3-3,-26-y);ctx.stroke(); }
    ctx.restore();
}
/**
 * Остатки в разобранном пропаде. Раньше это была кучка из пяти одинаковых
 * серо-песочных палочек НЕЗАВИСИМО от того, что внутри: из ящика сыпались
 * доски, а на земле лежал «серый непонятный хлам» (претензия блока 79). Теперь
 * форма и цвет берутся у самого предмета, а пустой остаток не рисует вообще
 * ничего — ни тени, ни эллипса «в землю провалилось».
 */
const LOOT_FORM = {
    board:  { w: 15, h: 4, step: 2.2, edge: true },
    stick:  { w: 13, h: 2, step: 1.8, edge: false },
    clump:  { w: 4,  h: 3, step: 1.4, edge: false },
    stone:  { w: 5,  h: 4, step: 1.6, edge: true }
};
function lootForm(id) {
    if (id === 'plank' || id === 'log') return 'board';
    if (id === 'firewood' || id === 'fiber' || id === 'hay' || id === 'stick') return 'stick';
    if (id === 'stone' || id === 'ore' || id === 'charcoal' || id === 'ash_dust') return 'stone';
    return 'clump';
}
export function paintLoot(ctx, loot, defOf = null) {
    const units = (loot || []).reduce((n, s) => n + (s.n || 0), 0);
    if (!units) return;
    ctx.save();
    ctx.fillStyle='rgba(12,15,13,.24)';ctx.beginPath();ctx.ellipse(0,1,12,4,0,0,Math.PI*2);ctx.fill();
    let i = 0;
    for (const stack of loot || []) {
        const form = LOOT_FORM[lootForm(stack.id)];
        // Цвет — тот же, что у предмета в руке и в ячейке: игрок обязан узнавать
        // в кучке на земле то, что ему досталось.
        const def = defOf ? defOf(stack.id) : null;
        const base = def?.tint || (lootForm(stack.id) === 'board' ? '#9a7448'
            : lootForm(stack.id) === 'stick' ? '#b59862'
                : lootForm(stack.id) === 'stone' ? '#8b8b84' : '#a99776');
        for (let k = 0; k < Math.min(5, stack.n || 0) && i < 8; k += 1, i += 1) {
            const x = -9 + (i % 2) * 3, y = -3 - Math.floor(i / 2) * form.step - (i % 2) * 0.8;
            ctx.fillStyle = i % 2 ? base : shadeDown(base);
            ctx.fillRect(x, y, form.w, form.h);
            if (form.edge) { ctx.fillStyle='rgba(255,240,210,0.22)'; ctx.fillRect(x, y, form.w, 1); }
            ctx.fillStyle = 'rgba(20,16,12,0.55)'; ctx.fillRect(x, y + form.h - 1, form.w, 1);
        }
    }
    ctx.restore();
}
function shadeDown(hex) {
    const c = String(hex).replace('#','');
    if (c.length !== 6) return hex;
    const n = v => Math.max(0, Math.min(255, v)).toString(16).padStart(2,'0');
    return `#${n(parseInt(c.slice(0,2),16)-22)}${n(parseInt(c.slice(2,4),16)-22)}${n(parseInt(c.slice(4,6),16)-22)}`;
}
