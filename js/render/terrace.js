/** Rock faces join the same depth queue as actors, not a decal over the hero. */
export function paintTerraceFace(ctx, face, field, camera, season) {
    const x1=face.left, x2=face.right,y1=field.frontAt(x1),y2=field.frontAt(x2);
    const base=(x,y)=>({x:camera.toScreenX(x),y:(y-camera.y+camera.offsetY)*camera.zoom});
    const a=base(x1,y1),b=base(x2,y2),z=camera.zoom;
    const h1=field.heightAt(x1,y1-.01),h2=field.heightAt(x2,y2-.01);
    const low1=field.baseHeightAt(x1,y1),low2=field.baseHeightAt(x2,y2);
    const poly=(points,colour)=>{ctx.fillStyle=colour;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();};
    const grain=Math.sin(x1*.014)*4,shade=72+grain;
    poly([[a.x,a.y-h1*z],[b.x+.6,b.y-h2*z],[b.x+.6,b.y-low2*z+1],[a.x,a.y-low1*z+1]],`rgb(${shade+31},${shade+19},${shade+4})`);
    for(let i=1;i<5;i++) {
        const t=i/5, yy1=a.y-(h1*(1-t)+low1*t)*z,yy2=b.y-(h2*(1-t)+low2*t)*z;
        ctx.strokeStyle=i%2?'rgba(29,28,24,.4)':'rgba(194,183,147,.28)';ctx.lineWidth=(i%2?1.1:.45)*z;
        ctx.beginPath();ctx.moveTo(a.x,yy1+Math.sin(x1*.06+i)*2*z);ctx.lineTo(b.x+.5,yy2+Math.sin(x2*.06+i)*2*z);ctx.stroke();
    }
    // Sparse diagonal fractures and fallen chips break the ribbon into rock,
    // not an architectural brick wall. Every mark is keyed to world position.
    if (Math.sin(x1*.37) > .55) {
        const mid=a.y-(h1*.65+low1*.35)*z;
        ctx.strokeStyle='rgba(40,37,29,.48)';ctx.lineWidth=.6*z;
        ctx.beginPath();ctx.moveTo(a.x+2*z,mid-9*z);ctx.lineTo(a.x+5*z,mid-3*z);ctx.lineTo(a.x+3*z,mid+7*z);ctx.stroke();
        poly([[a.x,a.y-low1*z],[a.x+7*z,a.y-low1*z+1*z],[a.x+9*z,a.y-low1*z+6*z],[a.x+1*z,a.y-low1*z+5*z]],'#81745a');
    }
    if(Math.sin(x1*.09)>.75) poly([[a.x,a.y-h1*z+1*z],[b.x,b.y-h2*z+1*z],[b.x,b.y-h2*z+6*z],[a.x+3*z,a.y-h1*z+4*z]],'#74785a');
    ctx.strokeStyle=season==='winter'?'#d5e4e1':'#aea483';ctx.lineWidth=2*z;
    ctx.beginPath();ctx.moveTo(a.x,a.y-h1*z);ctx.lineTo(b.x,b.y-h2*z);ctx.stroke();
    poly([[a.x,a.y-low1*z],[b.x,b.y-low2*z],[b.x+3*z,b.y-low2*z+5*z],[a.x,a.y-low1*z+5*z]],'rgba(22,27,23,.24)');
}
