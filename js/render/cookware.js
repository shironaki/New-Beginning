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
export function paintLoot(ctx, loot) {
    ctx.fillStyle='rgba(12,15,13,.24)';ctx.beginPath();ctx.ellipse(0,1,12,4,0,0,Math.PI*2);ctx.fill();
    const wood = loot.some(s=>s.id==='firewood'||s.id==='log');
    for(let i=0;i<Math.min(5,loot.reduce((n,s)=>n+s.n,0));i++) {
        ctx.fillStyle=wood ? (i%2?'#987549':'#b59862') : '#a99776';
        ctx.fillRect(-9+(i%2)*3,-3-i*1.5,wood?17:6,3);
    }
}
