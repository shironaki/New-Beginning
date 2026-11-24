import {test,assert,run} from './tiny.js';
import {installDOM,FakeElement} from './dom-harness.js';
import {MemoryStorage} from '../js/core/save.js';
import {normalizeLook,openAppearance} from '../js/ui/appearance.js';
import {Camera} from '../js/engine/camera.js';
import {BODY} from '../js/render/charspec.js';
import {generateZone} from '../js/world/worldgen.js';
installDOM();const{Game}=await import('../js/main.js');
const boot=()=>{const g=new Game({canvas:new FakeElement('canvas'),hudRoot:new FakeElement(),seed:1066618561});g.save.storage=new MemoryStorage();g.hud.hideStory();return g;};
const click=(g,text)=>{const row=g.hud._panelRows.find(r=>r.innerHTML.includes(text));assert.ok(row,text);row.dispatch('click');};
test('appearance applies only on confirmation, cancel does not mutate the hero',()=>{
 const g=boot(),before=JSON.stringify(g.look);openAppearance(g);click(g,'Пол:');assert.eq(JSON.stringify(g.look),before);click(g,'Отмена');assert.eq(JSON.stringify(g.look),before);
 openAppearance(g);click(g,'Пол:');click(g,'Причёска:');click(g,'Применить');assert.eq(g.look.gender,'female');assert.eq(g.look.hairStyle,'long');assert.not(g.look.stubble);
});
test('character palette and silhouette survive real save/load',()=>{
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
test('home relief is a broad rounded hill without a face or a ramp-only entrance',()=>{
 const f=generateZone('ashfall',1066618561).playableRelief,p=f.landmark;
 assert.not(f.faces);assert.not(f.ledge);assert.gt(f.heightAt(p.x,p.y),60);
 for(const [dx,dy] of [[240,0],[-240,0],[0,240],[0,-240]]){
  assert.gt(f.heightAt(p.x,p.y)-f.heightAt(p.x+dx,p.y+dy),20);
  for(let t=0;t<=1;t+=.02)assert.ok(f.canStand(p.x+dx*t,p.y+dy*t));
 }
});
function walk(g,axis,frames=120){
 for(let i=0;i<frames;i++){
  const x=g.player.x,y=g.player.y;
  g.player.update(1/60,axis,g.zone,{surfaceAt:(x,y)=>({slope:g.zone.terrain.slope(x,y,axis.x,axis.y)})});
  assert.lt(Math.hypot(g.player.x-x,g.player.y-y),3);assert.ok(g.fitsAt(g.player.x,g.player.y));
 }
}
test('former front wall is traversable in both directions without teleporting',()=>{
 for(const direction of [-1,1]){
  const g=boot(),p=g.zone.playableRelief.landmark,y=p.y+94;
  g.placeSafely(p.x-156,y-direction*32);walk(g,{x:0,y:direction});
  assert.gt((g.player.y-y)*direction,20);
 }
});
test('former invisible side walls are traversable from east and west',()=>{
 for(const direction of [-1,1]){
  const g=boot(),p=g.zone.playableRelief.landmark,x=p.x-direction*220;
  g.placeSafely(x-direction*32,p.y+40);walk(g,{x:direction,y:0});
  assert.gt((g.player.x-x)*direction,20);
 }
});
test('ordinary walking gains height on the southern hill, with no fenced passage',()=>{
 const g=boot(),f=g.zone.playableRelief,p=f.landmark;
 g.placeSafely(p.x,p.y+214);const h=f.heightAt(g.player.x,g.player.y);
 walk(g,{x:0,y:-1},150);assert.gt(f.heightAt(g.player.x,g.player.y),h+20);
});
test('world picking has one continuous floor on all approaches to the hill',()=>{
 const f=generateZone('ashfall',1066618561).playableRelief,c=new Camera({width:1000,height:700,zoom:3.4});c.surface=f;
 for(let x=800;x<1400;x+=29)for(let y=800;y<1400;y+=31){
  const p=c.worldToScreen(x,y),q=c.screenToWorld(p.x,p.y);assert.near(q.y,y,1e-4);
 }
});
test('a save on the former front edge stays in place on loading the hill',()=>{
 const g=boot(),p=g.zone.playableRelief.landmark;
 g.placeSafely(p.x-156,p.y+94);const pos=[g.player.x,g.player.y];assert.ok(g.save.write());
 const b=boot();b.save.storage=g.save.storage;assert.ok(b.save.loadFromStorage());b.update(0);
 assert.deep([b.player.x,b.player.y],pos);assert.ok(b.fitsAt(...pos));
});
test('hill is deterministic without altering resource identities',()=>{
 for(const seed of [1,2,88,1066618561]){
  const a=generateZone('ashfall',seed),b=generateZone('ashfall',seed);
  assert.deep(Array.from(a.playableRelief.heights),Array.from(b.playableRelief.heights));
  assert.deep(a.objects.map(o=>[o.kind,o.x,o.y]),b.objects.map(o=>[o.kind,o.x,o.y]));
  assert.ok(a.playableRelief.canStand(a.spawn.x,a.spawn.y));
 }
});
await run('stage67');
