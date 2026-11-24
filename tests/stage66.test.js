import {test,assert,run} from './tiny.js';
import {installDOM,FakeElement} from './dom-harness.js';
import {MemoryStorage} from '../js/core/save.js';
import {startPickup,tickHands,openBag,handRender,startMeal} from '../js/ui/hands.js';
import {armRig,toolAttachment} from '../js/render/character.js';
import {paintCookware} from '../js/render/cookware.js';
import {openSessionMenu} from '../js/ui/session.js';
import {reach} from './carry-fixture.js';
installDOM();const {Game}=await import('../js/main.js');
function boot(){const g=new Game({canvas:new FakeElement('canvas'),hudRoot:new FakeElement(),seed:1066618561});g.save.storage=new MemoryStorage();g.hud.hideStory();return g;}
const wood=g=>g.zone.objects.find(o=>o.kind==='firewood');
test('bag, journal, story, condition and fire are not world pause',()=>{
 const g=boot(); for(const open of [()=>g.openBackpack(),()=>g.openJournal(),()=>g.openCondition(),()=>g.openFire(g.zone.objects.find(o=>o.kind==='campfire')),()=>{g.hud.closePanel();g.hud.showStory({title:'t',text:'t'});}]){
 open();const time=g.clock.minute;const pos=[g.player.x,g.player.y];g.update(1);assert.gt(g.clock.minute,time);assert.deep([g.player.x,g.player.y],pos);g.hud.hideStory();}
});
test('only explicit pause and background stop clock and a pending pickup',()=>{
 const g=boot(),o=wood(g);reach(g,o);g.harvest(o);openSessionMenu(g);const time=g.clock.minute;g.update(1);assert.eq(g.clock.minute,time);assert.near(g.inventory.handAction.remaining,.6);
 g.hud.closePanel();g.backgrounded=true;g.update(1);assert.eq(g.clock.minute,time);g.backgrounded=false;g.update(1);assert.ok(g.inventory.has('firewood'));
});
test('pickup takes time and leaves wood held, not silently stored',()=>{
 const g=boot(),o=wood(g);reach(g,o);g.harvest(o);assert.eq(g.inventory.count('firewood'),0);tickHands(g,.3);assert.not(o.removed);tickHands(g,.31);
 assert.eq(g.inventory.hands.left.id,'firewood');assert.eq(g.inventory.hands.left.n,3);assert.not(g.inventory.slots.some(s=>s?.id==='firewood'));assert.ok(o.removed);
});
test('stowing a held bundle is explicit and conserves every unit',()=>{
 const g=boot(),o=wood(g);reach(g,o);g.harvest(o);tickHands(g,1);assert.ok(g.inventory.equipHand('left'));assert.eq(g.inventory.count('firewood'),3);assert.eq(g.inventory.hands.left,null);
 g.inventory.hands.right={id:'torch',n:1};g.inventory.equipHand('left',g.inventory.slots.findIndex(s=>s?.id==='firewood'),3);
 assert.ok(startMeal(g,'berry'));tickHands(g,1);assert.eq(g.inventory.hands.left.id,'firewood');assert.eq(g.inventory.hands.left.n,3);
});
test('both occupied hands/full bag retain all loot in the world',()=>{
 const g=boot(),o=wood(g);g.inventory.hands.left={id:'torch',n:1};g.inventory.slots.fill(null);for(let i=0;i<24;i++)g.inventory.slots[i]={id:'stone',n:50};reach(g,o);g.harvest(o);
 assert.not(g.inventory.handAction);assert.eq(o.loot[0].n,3);assert.not(o.removed);assert.eq(g.inventory.count('firewood'),0);
 g.inventory.slots[0]=null;assert.ok(startPickup(g,o));tickHands(g,1);assert.eq(g.inventory.count('firewood'),3);assert.eq(g.inventory.hands.left.id,'torch');
});
test('save midway through pickup restores loot and finishes once',()=>{
 const g=boot(),o=wood(g);reach(g,o);g.harvest(o);tickHands(g,.2);g.save.write();const b=boot();b.save.storage=g.save.storage;assert.ok(b.save.loadFromStorage());tickHands(b,.5);tickHands(b,1);assert.eq(b.inventory.count('firewood'),3);assert.ok(b.zone.objects[g.zone.objects.indexOf(o)].removed);
});
test('partial bundle source and its remaining units persist',()=>{
 const g=boot(),o=wood(g);o.loot=[{id:'firewood',n:8}];o.depleted=true;reach(g,o);startPickup(g,o);tickHands(g,1);assert.eq(g.inventory.hands.left.n,5);assert.eq(o.loot[0].n,3);g.save.write();const b=boot();b.save.storage=g.save.storage;assert.ok(b.save.loadFromStorage());assert.eq(b.zone.objects[g.zone.objects.indexOf(o)].loot[0].n,3);
});
test('leaving a pickup source cancels transfer without loss',()=>{
 const g=boot(),o=wood(g);reach(g,o);g.harvest(o);g.player.x+=120;tickHands(g,1);assert.eq(g.inventory.count('firewood'),0);assert.eq(o.loot[0].n,3);
});
test('initial objective visible; completion removes it rather than inventing a task',()=>{
 const g=boot();g.update(0);assert.eq(g.hud.els.objective.textContent,g.story.objective);g.story.index=99;g.update(0);assert.eq(g.hud.els.objective.textContent,'');
});
test('bag groups categories in navigation and items in a separate grid',()=>{
 const g=boot();openBag(g);assert.ok(g.hud.els.panelBody.children.some(c=>c.className==='bagTabs'));assert.ok(g.hud.els.panelBody.children.some(c=>c.className==='bagGrid'));assert.ok(g.hud._panelRows.some(c=>c.getAttribute('aria-pressed')==='true'));
});
test('cold installed pot paints support and vessel, not only flames',()=>{
 const c=new FakeElement('canvas').getContext('2d');let ellipses=0;const f=c.ellipse;c.ellipse=(...a)=>{ellipses++;return f?.(...a);};paintCookware(c,{hasPot:false});assert.eq(ellipses,0);paintCookware(c,{hasPot:true,lit:false});assert.gte(ellipses,2);
});
test('far profile knife grip and blade extend forward in either anatomical hand',()=>{
 for(const dir of ['left','right'])for(const side of ['left','right']){
 const p={dir,[side+'Tool']:{id:'knife',tool:'knife'}},rig=armRig(p),sign=dir==='left'?-1:1,a=toolAttachment(p,side);
 assert.gt(rig[side].ex*sign,0);assert.gt((a.x-a.gripX)*sign,0);
 }
});
test('meal restores a bundle split across bag slots, including after reload',()=>{
 const g=boot(),inv=g.inventory;inv.clear();inv.hands={left:{id:'firewood',n:5},right:{id:'torch',n:1}};
 inv.slots[0]={id:'berry',n:1};inv.slots[1]={id:'firewood',n:49};
 assert.ok(startMeal(g,'berry'));assert.eq(inv.slots[0].n,4);assert.eq(inv.slots[1].n,50);
 g.save.write();const b=boot();b.save.storage=g.save.storage;assert.ok(b.save.loadFromStorage());tickHands(b,1);
 assert.deep(b.inventory.hands.left,{id:'firewood',n:5});assert.eq(b.inventory.count('firewood'),54);assert.eq(b.inventory.hands.right.id,'torch');
});
test('bundle retrieval across slots is atomic and never takes from the other hand',()=>{
 const g=boot(),inv=g.inventory;inv.clear();inv.hands={left:null,right:{id:'firewood',n:5}};
 inv.slots[0]={id:'firewood',n:2};inv.slots[1]={id:'firewood',n:1};const before=JSON.stringify(inv.toJSON());
 assert.not(inv.equipHand('left',0,5));assert.eq(JSON.stringify(inv.toJSON()),before);
 inv.slots[2]={id:'firewood',n:2};assert.ok(inv.equipHand('left',0,5));assert.eq(inv.hands.left.n,5);assert.eq(inv.hands.right.n,5);assert.eq(inv.used,0);
});
test('bag cards distinguish stored counts from the two physical hands',()=>{
 const g=boot();g.inventory.clear();g.inventory.hands.left={id:'firewood',n:3};g.inventory.slots[0]={id:'firewood',n:2};openBag(g);
 const card=g.hud._panelRows.find(b=>b.className.includes('bagItem'));
 assert.ok(card.innerHTML.includes('В рюкзаке: 2'));assert.ok(card.innerHTML.includes('Левая рука: 3'));
});
test('stale item buttons cannot swap unrelated hands after that item is consumed',()=>{
 const g=boot();g.inventory.clear();g.inventory.hands={left:{id:'firewood',n:3},right:{id:'torch',n:1}};g.inventory.slots[0]={id:'berry',n:1};
 assert.ok(startMeal(g,'berry'));openBag(g);g.hud._panelRows.find(b=>b.innerHTML.includes('Ягоды')).dispatch('click');
 const button=g.hud._panelRows.find(b=>b.innerHTML.includes('Правая рука'));assert.ok(button);tickHands(g,1);
 const before=JSON.stringify(g.inventory.hands);button.dispatch('click');assert.eq(JSON.stringify(g.inventory.hands),before);assert.eq(g.hud.panelOpen,'bag');
});
test('pickup completion rechecks height instead of taking loot through a cliff',()=>{
 const g=boot(),o=wood(g);reach(g,o);g.harvest(o);const entry=JSON.stringify(o.loot);
 const field=g.zone.playableRelief,check=field.canReach;field.canReach=()=>false;
 tickHands(g,1);assert.eq(g.inventory.count('firewood'),0);assert.eq(JSON.stringify(o.loot),entry);assert.not(o.removed);field.canReach=check;
});
await run('stage66');
