import {test,assert,run} from './tiny.js';
import {installDOM,FakeElement} from './dom-harness.js';
import {MemoryStorage} from '../js/core/save.js';
import {normalizeLook,openAppearance} from '../js/ui/appearance.js';
import {Camera} from '../js/engine/camera.js';
import {BODY} from '../js/render/charspec.js';
import {generateZone} from '../js/world/worldgen.js';
import {paintTerraceFace} from '../js/render/terrace.js';
installDOM();const{Game}=await import('../js/main.js');
const boot=()=>{const g=new Game({canvas:new FakeElement('canvas'),hudRoot:new FakeElement(),seed:1066618561});g.save.storage=new MemoryStorage();g.hud.hideStory();return g;};
const click=(g,text)=>{const row=g.hud._panelRows.find(r=>r.innerHTML.includes(text));assert.ok(row,text);row.dispatch('click');};
test('appearance applies only on confirmation, cancel does not mutate the hero',()=>{
 const g=boot(),before=JSON.stringify(g.look);openAppearance(g);click(g,'Пол:');assert.eq(JSON.stringify(g.look),before);click(g,'Отмена');assert.eq(JSON.stringify(g.look),before);
 openAppearance(g);click(g,'Пол:');click(g,'Причёска:');click(g,'Применить');assert.eq(g.look.gender,'female');assert.eq(g.look.hairStyle,'long');assert.not(g.look.stubble);
});
test('character palette and silhouette options survive real save/load',()=>{
 const a=boot();a.look=normalizeLook({gender:'female',hairStyle:'braid',skin:'#80553e',coat:'#785044'});a.save.write();const b=boot();b.save.storage=a.save.storage;assert.ok(b.save.loadFromStorage());assert.deep(b.look,a.look);
});
test('invalid appearance is rejected transactionally without damaging inventory',()=>{
 const g=boot(),data=JSON.parse(g.save.exportString()),inv=JSON.stringify(g.inventory.toJSON()),look=JSON.stringify(g.look);data.parts.look.coat='url(invalid)';assert.not(g.save.restore(data));assert.eq(JSON.stringify(g.look),look);assert.eq(JSON.stringify(g.inventory.toJSON()),inv);
});
test('old save without an appearance provider retains a supported default',()=>{
 const g=boot(),data=JSON.parse(g.save.exportString());delete data.parts.look;assert.ok(g.save.restore(data));assert.eq(g.look.gender,'male');assert.gt(BODY.total,40);
});
test('first launch opens creation; survival does not run until that pause is closed',()=>{
 const g=boot();g.start();assert.eq(g.hud.panelOpen,'appearance');const t=g.clock.minute;g.update(2);assert.eq(g.clock.minute,t);click(g,'Начать путь');assert.ok(g.hud.isStoryOpen);g.update(1);assert.gt(g.clock.minute,t);
});
test('real home zone has physical sheer faces separated by a broad ramp',()=>{
 const f=generateZone('ashfall',1066618561).playableRelief;assert.gt(f.faces.length,20);
 const face=f.faces[Math.floor(f.faces.length/4)],y=f.frontAt(face.x);
 assert.gt(f.heightAt(face.x,y-1)-f.heightAt(face.x,y+1),45);assert.not(f.canStand(face.x,y,9));
 for(let yy=f.ledge.front-20;yy<f.ledge.front+f.ledge.rampLength+20;yy+=4)assert.ok(f.canStand(f.ledge.rampX,yy,9));
});
test('cliff blocks approaching body without safety-net teleport or crossing',()=>{
 const g=boot(),f=g.zone.playableRelief,face=f.faces[6],y=f.frontAt(face.x);g.placeSafely(face.x,y+24);const startY=g.player.y;
 for(let i=0;i<180;i++){const x=g.player.x,yy=g.player.y;g.player.update(1/60,{x:0,y:-1},g.zone,{});assert.lt(Math.hypot(g.player.x-x,g.player.y-yy),3);assert.ok(g.fitsAt(g.player.x,g.player.y));}
 assert.gt(g.player.y,y+4);assert.lte(g.player.y,startY);
});
test('cliff cannot be bypassed by reversing direction at the top',()=>{
 const g=boot(),f=g.zone.playableRelief,face=f.faces[6],y=f.frontAt(face.x);g.placeSafely(face.x,y-24);
 for(let i=0;i<180;i++)g.player.update(1/60,{x:0,y:1},g.zone,{});
 assert.lt(g.player.y,y-4);assert.ok(g.fitsAt(g.player.x,g.player.y));
});
test('ramp reaches the plateau through the ordinary player mover',()=>{
 const g=boot(),f=g.zone.playableRelief;g.placeSafely(f.ledge.rampX,f.ledge.front+120);const h=f.heightAt(g.player.x,g.player.y);
 for(let i=0;i<150;i++)g.player.update(1/60,{x:0,y:-1},g.zone,{});
 assert.gt(f.heightAt(g.player.x,g.player.y),h+30);
});
test('world picking returns the visible ramp floor across the projected climb',()=>{
 const z=generateZone('ashfall',1066618561),f=z.playableRelief,c=new Camera({width:1000,height:700,zoom:3.4});c.surface=f;
 for(let y=1100;y<1280;y+=7){const p=c.worldToScreen(f.ledge.rampX,y),q=c.screenToWorld(p.x,p.y);assert.near(q.y,y,1e-4);}
});
test('cliff rendering has a top rim, face and foot on the shared height field',()=>{
 const f=generateZone('ashfall',1066618561).playableRelief,c=new Camera({width:1000,height:700,zoom:2}),ctx=new FakeElement('canvas').getContext('2d');c.surface=f;let fills=0,strokes=0;ctx.fill=()=>fills++;ctx.stroke=()=>strokes++;paintTerraceFace(ctx,f.faces[0],f,c,'winter');assert.gte(fills,2);assert.gte(strokes,5);
});
test('height field is deterministic across seeds without altering resource identities',()=>{
 for(const seed of [1,2,88,1066618561]){const a=generateZone('ashfall',seed),b=generateZone('ashfall',seed);assert.deep(a.playableRelief.faces,b.playableRelief.faces);assert.deep(a.objects.map(o=>[o.kind,o.x,o.y]),b.objects.map(o=>[o.kind,o.x,o.y]));assert.ok(a.playableRelief.canStand(a.spawn.x,a.spawn.y));}
});
await run('stage67');
