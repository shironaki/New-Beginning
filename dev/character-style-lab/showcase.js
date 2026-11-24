import * as THREE from './vendor/three.module.js';
import { DEFAULT_LOOK, drawCharacter } from '/game/render/character.js';

const $ = (selector) => document.querySelector(selector);
const state = { motion:'idle', direction:'down', equipment:'both' };
let threeOption = null, pixelDirection = 'down';
const phaseFor = (t) => t * (state.motion === 'run' ? 10 : 6.5);
const movement = () => state.motion === 'idle' ? 0 : 1;
const runBlend = () => state.motion === 'run' ? 1 : 0;

function sync() {
  document.querySelectorAll('[data-motion]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.motion === state.motion)));
  document.querySelectorAll('[data-direction]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.direction === state.direction)));
  $('#status').textContent = `${state.motion === 'idle' ? 'Покой' : state.motion === 'walk' ? 'Шаг' : 'Бег'} · ${state.direction} · ${state.equipment === 'none' ? 'руки свободны' : 'предметы синхронизированы'}`;
  setSvgEquipment(); setSvgDirection(); pixelDirection = state.direction;
  threeOption?.setDirection(state.direction); threeOption?.setEquipment(state.equipment);
}
document.querySelectorAll('[data-motion]').forEach((b) => b.addEventListener('click', () => { state.motion = b.dataset.motion; sync(); }));
document.querySelectorAll('[data-direction]').forEach((b) => b.addEventListener('click', () => { state.direction = b.dataset.direction; sync(); }));
$('#equipment').addEventListener('change', (e) => { state.equipment = e.currentTarget.value; sync(); });

// 01 — Live production Canvas renderer, served by a read-only /game/ route.
const gameCanvas = $('#currentCanvas'), gameContext = gameCanvas.getContext('2d');
let canvasSize = { w:0, h:0, ratio:0 };
function drawCurrent(time) {
  const rect = gameCanvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 1.7), w = Math.round(rect.width * ratio), h = Math.round(rect.height * ratio);
  if (w !== canvasSize.w || h !== canvasSize.h || ratio !== canvasSize.ratio) { gameCanvas.width=w; gameCanvas.height=h; canvasSize={w,h,ratio}; }
  gameContext.setTransform(ratio,0,0,ratio,0,0); gameContext.clearRect(0,0,rect.width,rect.height);
  const scale = Math.min(rect.height/54, rect.width/58); gameContext.save();
  gameContext.translate(rect.width/2,rect.height*.86); gameContext.scale(scale,scale);
  const axe={id:'axe_stone',tool:'axe'}, torch={id:'torch',tool:'torch'};
  drawCharacter(gameContext,{dir:state.direction,phase:phaseFor(time),gait:movement(),runBlend:runBlend(),idleTime:time,
    rightTool:state.equipment==='right'||state.equipment==='both'?axe:null,
    leftTool:state.equipment==='left'?axe:state.equipment==='both'?torch:null,look:DEFAULT_LOOK});
  gameContext.restore();
}

// 02 — SVG cut-out character.
function setSvgEquipment() {
  const visible=(id,on)=>{ const n=document.getElementById(id); if(n)n.style.display=on?'':'none'; };
  visible('svgAxeRight',state.equipment==='right'||state.equipment==='both');
  visible('svgAxeLeft',state.equipment==='left'); visible('svgLight',state.equipment==='both');
}
function setSvgDirection() {
  const back=state.direction==='up', profile=state.direction==='left'||state.direction==='right';
  $('#svgFigure').setAttribute('transform',state.direction==='left'?'translate(280 0) scale(-1 1)':state.direction==='right'?'translate(46 0) scale(.66 1)':'');
  $('#svgFace').style.display=back?'none':''; $('#svgFaceFeatures').style.display=back?'none':'';
  $('#svgHairFront').style.display=back?'none':''; $('#svgHairBack').style.display=back?'':'none';
  $('#svgChest').style.display=back?'none':''; $('#svgTailoring').style.display=back?'none':''; $('#svgPack').style.display=back?'':'none';
  $('#svgFarEye').style.display=profile?'none':'';
}
function animateSvg(time) {
  const moving=movement(), stride=Math.sin(phaseFor(time))*(state.motion==='run'?17:11)*moving;
  const bob=moving?Math.max(0,Math.cos(phaseFor(time)))*(state.motion==='run'?3:2):Math.sin(time*1.7)*1.1;
  $('#svgNearLeg').setAttribute('transform',`translate(0 ${bob}) rotate(${stride} 153 202)`);
  $('#svgFarLeg').setAttribute('transform',`translate(0 ${bob}) rotate(${-stride} 124 202)`);
  const r=-stride*.58,l=stride*.58;
  $('#svgRightArm').setAttribute('transform',`translate(0 ${bob}) rotate(${r} 103 117)`);
  $('#svgLeftArm').setAttribute('transform',`translate(0 ${bob}) rotate(${l} 177 117)`);
  $('#svgAxeRight').setAttribute('transform',`translate(0 ${bob}) rotate(${r} 103 117) translate(84 216) rotate(-26)`);
  $('#svgAxeLeft').setAttribute('transform',`translate(0 ${bob}) rotate(${l} 177 117) translate(194 214) rotate(22)`);
  $('#svgLight').setAttribute('transform',`translate(0 ${bob}) rotate(${l} 177 117) translate(194 216)`);
  $('#svgHead').setAttribute('transform',`translate(0 ${bob})`); $('#svgTorso').setAttribute('transform',`translate(0 ${bob})`);
}

// 03 — Original 64×96 pixel sprite authored on an integer grid.
const pixelCanvas=$('#pixelCanvas'), pixel=pixelCanvas.getContext('2d'); pixel.imageSmoothingEnabled=false;
const PX={
  outline:'#29262a',hair:'#3e2e35',hairLight:'#68464d',hairDark:'#2c252c',skin:'#d89173',skinLight:'#f2b18d',skinShadow:'#945b51',
  scarf:'#e4dcc4',scarfLight:'#fff0d2',scarfShade:'#b8ad97',coat:'#7c4938',coatLight:'#a65f46',coatDark:'#4d302d',
  leather:'#603c31',leatherLight:'#9a6047',leatherDark:'#392a2a',cloth:'#d4c49f',clothLight:'#eee0bd',clothShade:'#9a8d77',
  plate:'#737b77',plateLight:'#b0b1a2',plateShade:'#464e4e',trouser:'#303941',trouserLight:'#50595a',boot:'#704438',bootLight:'#a05e47',sole:'#30262a',
  gold:'#c38d4b',steel:'#c7c7b8',steelDark:'#555c5b',ember:'#a94a36',pack:'#654532',packLight:'#a2764d'
};
function pxRect(x,y,w,h,color){pixel.fillStyle=color;pixel.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));}
function pxPoly(points,color){
  const minY=Math.floor(Math.min(...points.map(p=>p[1]))),maxY=Math.ceil(Math.max(...points.map(p=>p[1])));
  for(let y=minY;y<maxY;y++){
    const scan=y+.5,hits=[];
    for(let i=0;i<points.length;i++){
      const [x1,y1]=points[i],[x2,y2]=points[(i+1)%points.length];
      if((y1<=scan&&y2>scan)||(y2<=scan&&y1>scan))hits.push(x1+(scan-y1)/(y2-y1)*(x2-x1));
    }
    hits.sort((a,b)=>a-b);
    for(let i=0;i+1<hits.length;i+=2){const left=Math.ceil(hits[i]-.5),right=Math.floor(hits[i+1]-.5);if(right>=left)pxRect(left,y,right-left+1,1,color);}
  }
}
function pixelAxe(x,y,side=1){
  pxRect(x-1,y-16,3,16,PX.leatherDark);pxRect(x,y-15,1,12,PX.leatherLight);
  pxPoly([[x-3,y-19],[x+3,y-19],[x+4,y-15],[x+2,y-13],[x-3,y-14]],PX.steelDark);
  pxPoly([[x-(side>0?8:1),y-21],[x-(side>0?2:-6),y-20],[x-(side>0?1:-5),y-15],[x-(side>0?5:3),y-13],[x-(side>0?8:1),y-15]],PX.steel);
  pxRect(x-(side>0?8:1),y-21,2,4,'#e4e1d1');pxRect(x-1,y-18,3,2,PX.outline);
}
function pixelTorch(x,y){
  pxRect(x-2,y-15,4,15,PX.leatherDark);pxRect(x-1,y-14,2,11,PX.leatherLight);
  pxPoly([[x-4,y-16],[x+4,y-16],[x+3,y-13],[x-3,y-13]],PX.gold);
  pxPoly([[x-3,y-17],[x-4,y-21],[x-1,y-24],[x+2,y-23],[x+4,y-18],[x+2,y-16]],PX.ember);
  pxRect(x-1,y-22,2,4,'#ffd98a');
}
function drawPixel(time){
  pixel.clearRect(0,0,64,96);const dir=pixelDirection,back=dir==='up',profile=dir==='left'||dir==='right';
  pixel.save();if(dir==='left'){pixel.translate(64,0);pixel.scale(-1,1);}if(profile){pixel.translate(32,0);pixel.scale(.68,1);pixel.translate(-32,0);}
  const phase=phaseFor(time),gait=movement(),run=runBlend(),stride=Math.round(Math.sin(phase)*(run?3:2)*gait),lift=Math.round(gait?Math.max(0,Math.cos(phase))*(run?2:1):0);
  const bob=gait?Math.max(0,Math.round(Math.cos(phase)*(run?2:1))):(Math.sin(time*1.7)>.72?1:0);
  pxRect(16,91,32,1,'#293329');pxRect(20,92,24,1,'#202a21');pxRect(25,93,14,1,'#1b251d');pixel.save();pixel.translate(0,bob);
  const leg=(x,dx,dy,near)=>{
    pixel.save();pixel.translate(dx,-dy);
    pxPoly([[x+2,56],[x+10,56],[x+11,62],[x+9,76],[x+7,79],[x+1,78],[x,71]],PX.outline);
    pxPoly([[x+3,57],[x+9,57],[x+10,63],[x+8,74],[x+6,77],[x+2,76],[x+1,70]],near?PX.trouserLight:PX.trouser);
    pxRect(x+(near?7:2),61,2,10,PX.trouser);
    pxPoly([[x+1,65],[x+3,63],[x+8,64],[x+10,67],[x+9,71],[x+3,72],[x+1,69]],PX.outline);
    pxPoly([[x+3,65],[x+7,65],[x+9,67],[x+8,70],[x+4,70],[x+2,68]],PX.plateShade);
    pxRect(x+3,65,3,1,PX.plateLight);pxRect(x+3,71,5,1,PX.leatherDark);
    pxPoly([[x+1,74],[x+9,74],[x+12,78],[x+13,85],[x+11,88],[x-1,88],[x-2,84]],PX.outline);
    pxPoly([[x+1,76],[x+8,76],[x+11,79],[x+11,84],[x+9,86],[x,86],[x-1,83]],PX.boot);
    pxRect(x+1,78,4,3,PX.bootLight);pxRect(x+2,86,9,2,PX.sole);pxRect(x+4,78,2,3,PX.steelDark);pxRect(x+5,79,1,1,PX.steel);
    pixel.restore();
  };
  leg(20,-stride,lift,false);leg(34,stride,0,true);
  pxPoly([[22,31],[28,29],[37,30],[43,33],[47,43],[44,58],[41,64],[22,63],[18,55],[17,42]],PX.outline);
  pxPoly([[23,32],[29,31],[36,31],[42,34],[45,43],[42,56],[40,61],[23,61],[20,54],[19,42]],PX.coatDark);
  pxPoly([[17,48],[23,49],[24,62],[21,67],[15,64],[14,56]],PX.outline);pxPoly([[18,50],[22,51],[22,61],[19,64],[16,62],[16,56]],PX.coatLight);
  pxPoly([[41,49],[47,48],[50,56],[49,64],[43,67],[40,62]],PX.outline);pxPoly([[43,51],[46,51],[48,57],[47,62],[44,64],[42,61]],PX.coat);
  if(back){pxPoly([[23,34],[40,34],[43,39],[42,54],[39,59],[24,58],[21,53],[21,39]],PX.outline);pxPoly([[24,36],[39,36],[41,40],[40,52],[38,56],[25,56],[23,52],[23,40]],PX.pack);pxRect(25,37,13,3,PX.packLight);pxRect(24,44,17,2,PX.leatherDark);pxRect(24,52,16,3,PX.packLight);pxRect(25,39,2,14,PX.leatherLight);pxRect(37,39,2,14,PX.leatherLight);}
  pxPoly([[23,31],[28,29],[37,30],[42,33],[46,40],[44,52],[40,58],[24,58],[20,53],[18,41]],PX.outline);
  pxPoly([[24,32],[29,31],[36,31],[41,34],[44,41],[42,51],[39,56],[25,56],[22,52],[20,41]],PX.coat);
  pxPoly([[22,34],[27,32],[37,32],[42,35],[43,42],[39,49],[25,49],[21,43]],PX.plateShade);
  pxPoly([[24,35],[28,34],[36,34],[40,36],[41,41],[38,46],[26,46],[23,42]],PX.plate);
  pxPoly([[24,35],[28,34],[31,36],[31,42],[28,44],[24,42],[22,39]],PX.plate);
  pxPoly([[33,36],[36,34],[40,36],[41,40],[38,44],[33,42]],PX.plateShade);
  pxPoly([[25,35],[29,34],[31,36],[29,38],[25,37]],PX.plateLight);pxPoly([[34,35],[37,35],[39,37],[36,38]],PX.plate);
  pxRect(31,37,1,6,PX.steelDark);pxRect(26,36,3,1,'#d0cebd');pxRect(37,38,2,1,PX.steel);
  pxPoly([[20,34],[23,33],[42,47],[40,50],[37,49],[19,37]],PX.leatherDark);
  pxPoly([[20,34],[21,34],[40,47],[39,48],[37,47],[20,36]],PX.leatherLight);pxRect(25,38,2,1,PX.gold);pxRect(33,44,2,1,PX.gold);
  pxPoly([[20,51],[44,51],[45,56],[42,58],[21,57],[19,55]],PX.leatherDark);pxRect(22,52,20,2,PX.leatherLight);pxRect(30,51,6,6,PX.outline);pxRect(31,52,4,4,PX.gold);pxRect(32,53,2,2,PX.leatherDark);
  pxPoly([[26,55],[38,55],[38,71],[32,78],[26,72]],PX.outline);pxPoly([[27,56],[37,56],[37,70],[32,76],[27,71]],PX.clothShade);pxPoly([[29,57],[35,57],[35,69],[32,73],[29,69]],PX.clothLight);pxRect(31,62,2,3,PX.ember);pxRect(30,64,4,2,PX.ember);pxRect(31,67,2,3,PX.ember);pxRect(32,63,1,1,'#e2a15f');
  pxPoly([[15,51],[21,51],[22,60],[20,63],[15,61]],PX.outline);pxRect(16,53,4,6,PX.leather);pxRect(17,54,2,2,PX.leatherLight);pxPoly([[43,51],[49,51],[50,61],[46,63],[42,60]],PX.outline);pxRect(44,53,4,6,PX.leather);pxRect(45,54,2,2,PX.leatherLight);
  if(back){pxPoly([[22,30],[39,30],[44,34],[46,43],[44,57],[40,64],[24,64],[19,58],[18,44]],PX.outline);pxPoly([[24,32],[38,32],[42,36],[44,44],[42,56],[39,61],[25,61],[21,56],[20,44]],PX.coatDark);pxPoly([[23,35],[40,34],[43,39],[42,53],[39,58],[25,58],[22,53],[21,40]],PX.outline);pxPoly([[25,37],[38,36],[41,40],[40,52],[37,56],[26,56],[23,52],[23,41]],PX.pack);pxRect(25,38,12,3,PX.packLight);pxRect(24,45,16,2,PX.leatherDark);pxRect(24,52,15,3,PX.packLight);pxRect(25,40,2,12,PX.leatherLight);pxRect(37,39,2,13,PX.leatherLight);pxRect(27,34,9,1,PX.coatLight);}
  const arm=(x,shift,lit)=>{pixel.save();pixel.translate(0,shift);pxPoly([[x+2,34],[x+7,32],[x+11,35],[x+12,43],[x+9,48],[x+3,46],[x,40]],PX.outline);pxPoly([[x+3,35],[x+7,34],[x+10,36],[x+10,42],[x+8,45],[x+4,44],[x+2,40]],lit?PX.coatLight:PX.coat);pxPoly([[x+2,43],[x+9,44],[x+10,52],[x+8,57],[x+3,57],[x+1,52]],PX.skinShadow);pxPoly([[x+3,44],[x+8,45],[x+8,51],[x+7,54],[x+4,54],[x+3,50]],PX.skin);pxRect(x+4,46,2,4,PX.skinLight);pxPoly([[x,50],[x+10,50],[x+11,56],[x+9,59],[x+1,58]],PX.outline);pxPoly([[x+1,51],[x+9,51],[x+9,55],[x+7,57],[x+2,56]],PX.plateShade);pxRect(x+2,51,5,2,PX.plate);pxRect(x+3,52,3,1,PX.plateLight);pxRect(x+3,56,4,1,PX.leatherLight);pxPoly([[x+2,57],[x+8,57],[x+8,62],[x+6,64],[x+2,62]],PX.skinShadow);pxRect(x+3,58,3,3,PX.skinLight);pixel.restore();};
  const rs=Math.round(stride*.45),ls=-rs;arm(8,rs,true);arm(44,ls,false);
  pxPoly([[25,7],[37,7],[41,11],[42,18],[40,23],[36,27],[29,27],[24,24],[22,18],[23,11]],PX.outline);
  if(back){pxPoly([[24,9],[37,8],[41,12],[41,20],[38,25],[27,25],[23,20],[22,13]],PX.hairDark);pxPoly([[25,9],[35,9],[39,12],[37,15],[27,14]],PX.hair);pxRect(25,10,7,2,PX.hairLight);pxRect(24,16,3,6,PX.hair);pxRect(38,15,2,6,PX.hairLight);}
  else{
    pxPoly([[25,10],[37,10],[40,13],[40,19],[37,24],[32,26],[27,24],[24,20],[24,14]],PX.skinShadow);pxPoly([[26,11],[36,11],[39,14],[38,19],[36,23],[32,24],[28,22],[25,19],[25,14]],PX.skin);pxPoly([[26,12],[34,12],[35,14],[29,14],[27,16]],PX.skinLight);pxRect(22,15,3,5,PX.skinShadow);pxRect(39,15,3,5,PX.skinShadow);
    pxPoly([[22,15],[19,12],[20,8],[24,7],[24,5],[30,4],[30,3],[35,5],[39,5],[42,9],[44,13],[42,17],[39,16],[37,12],[34,11],[31,16],[27,17],[24,20]],PX.hairDark);pxPoly([[22,11],[22,8],[26,6],[26,5],[31,5],[32,7],[29,10],[26,14],[23,15]],PX.hair);pxPoly([[29,5],[35,5],[40,8],[42,12],[39,13],[36,10],[32,9]],PX.hair);pxRect(25,7,5,1,PX.hairLight);pxRect(28,6,4,1,PX.hairLight);pxRect(21,9,4,2,PX.hairLight);pxRect(35,8,3,1,PX.hairLight);
    pxPoly([[24,13],[28,11],[31,12],[30,16],[27,17],[24,19]],PX.hairDark);pxPoly([[31,13],[35,11],[39,13],[40,16],[37,16],[34,14]],PX.hairDark);
    if(profile){pxRect(26,16,8,5,PX.skin);pxRect(34,17,3,2,PX.outline);pxRect(35,17,1,1,'#5c9c94');pxPoly([[38,18],[41,19],[39,21],[37,20]],PX.skinLight);pxRect(34,22,4,1,PX.leatherDark);}
    else{pxRect(26,15,4,1,PX.hairDark);pxRect(35,15,4,1,PX.hairDark);pxRect(26,16,4,2,'#ead9c2');pxRect(35,16,4,2,'#ead9c2');pxRect(27,16,2,2,'#5c9c94');pxRect(36,16,2,2,'#5c9c94');pxRect(28,17,1,1,PX.outline);pxRect(37,17,1,1,PX.outline);pxRect(31,18,2,3,PX.skinLight);pxRect(30,21,4,1,PX.skinShadow);pxRect(29,23,7,1,PX.leatherDark);pxRect(31,23,3,1,PX.ember);}
  }
  // Folded light scarf and a hanging end, built from shaded stair-step contours.
  pxPoly([[24,22],[39,22],[44,24],[47,29],[45,34],[41,36],[22,36],[18,33],[17,28],[20,24]],PX.outline);
  pxPoly([[24,23],[39,23],[43,25],[45,29],[43,32],[40,34],[23,34],[20,32],[19,28],[21,25]],PX.scarfShade);
  pxPoly([[25,23],[38,23],[42,25],[43,28],[40,30],[24,30],[21,28],[22,25]],PX.scarf);
  pxRect(25,24,11,1,PX.scarfLight);pxRect(22,26,3,1,PX.scarfLight);pxRect(39,26,3,1,PX.scarfShade);pxRect(25,27,12,1,PX.scarfShade);pxRect(27,28,10,1,PX.scarfLight);pxRect(21,29,4,1,PX.scarfShade);pxRect(39,29,3,1,PX.scarfShade);
  pxPoly([[18,28],[21,29],[24,32],[29,34],[35,34],[40,32],[44,29],[46,29],[45,33],[41,36],[35,37],[28,36],[22,34],[19,32]],PX.scarf);pxRect(23,31,4,1,PX.scarfLight);pxRect(28,33,7,1,PX.scarfLight);pxRect(37,32,4,1,PX.scarfShade);pxRect(22,33,3,1,PX.scarfShade);
  pxPoly([[40,30],[45,29],[46,33],[44,39],[41,41],[39,38]],PX.outline);pxPoly([[41,31],[44,31],[44,36],[42,39],[41,37]],PX.scarfShade);pxRect(42,32,1,3,PX.scarfLight);
  const shoulder=(x,bright)=>{pxPoly([[x+3,34],[x+4,31],[x+9,30],[x+13,32],[x+15,36],[x+13,41],[x+8,43],[x+2,41],[x,38]],PX.outline);pxPoly([[x+4,33],[x+9,32],[x+12,34],[x+13,37],[x+11,40],[x+7,41],[x+3,39],[x+2,37]],PX.plateShade);pxPoly([[x+5,33],[x+9,32],[x+11,34],[x+9,36],[x+4,36]],bright?PX.plateLight:PX.plate);pxRect(x+4,37,3,1,PX.plate);pxRect(x+10,37,2,1,PX.gold);pxRect(x+5,39,1,1,PX.steel);};
  shoulder(8,true);shoulder(41,false);pxRect(20,46,1,2,PX.gold);pxRect(43,46,1,2,PX.gold);
  if(state.equipment==='right'||state.equipment==='both')pixelAxe(14,64+bob+rs,1);
  if(state.equipment==='left')pixelAxe(50,64+bob+ls,-1);
  if(state.equipment==='both')pixelTorch(50,64+bob+ls);
  pixel.restore();pixel.restore();
}

// 04 — Procedural low-poly hero in Three.js; no external character model.
class ThreeCharacter {
  constructor(canvas){this.canvas=canvas;this.ready=false;try{this.create();}catch(error){console.warn('Three.js unavailable',error);$('#threeFallback').hidden=false;$('#threeFallback').textContent=`WebGL недоступен: ${error.message||error}`;}}
  mat(color,extra={}){return new THREE.MeshStandardMaterial({color,roughness:.88,flatShading:true,...extra});}
  add(parent,geo,mat,pos=[0,0,0],scale=[1,1,1]){const m=new THREE.Mesh(geo,mat);m.position.set(...pos);m.scale.set(...scale);parent.add(m);return m;}
  create(){
    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:true,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));this.renderer.setClearColor(0,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-2.7,2.7,1.5,-1.5,.1,60);this.camera.position.set(3.6,4.9,6.3);this.camera.lookAt(0,1.1,0);
    this.scene.add(new THREE.HemisphereLight(0xe7ddc4,0x384238,1.8));const key=new THREE.DirectionalLight(0xffdda6,3);key.position.set(-3,6,5);this.scene.add(key);const fill=new THREE.DirectionalLight(0xa6bbc0,1);fill.position.set(4,3,-4);this.scene.add(fill);
    const floor=this.add(this.scene,new THREE.CircleGeometry(1.15,24),this.mat(0x17221a,{transparent:true,opacity:.5}),[0,.01,0],[1.35,.4,1]);floor.rotation.x=-Math.PI/2;
    const m={coat:this.mat(0x705043),coatLight:this.mat(0x9a674b),coatDark:this.mat(0x443632),linen:this.mat(0xd3c7a8),skin:this.mat(0xc48c6b),hair:this.mat(0x382e30),scarf:this.mat(0xe1d7bf),leather:this.mat(0x60472f),leatherLight:this.mat(0x9a784d),pants:this.mat(0x40443a),boot:this.mat(0x563c2e),sole:this.mat(0x25201e),steel:this.mat(0x929a92,{metalness:.15}),torch:this.mat(0xf0b752,{emissive:0x995216,emissiveIntensity:1})};
    this.root=new THREE.Group();this.scene.add(this.root);this.legs=[];this.arms=[];this.items={};
    this.add(this.root,new THREE.CylinderGeometry(.32,.55,1.15,5),m.coatDark,[0,1.07,-.2]);
    this.add(this.root,new THREE.CylinderGeometry(.31,.3,.78,6),m.coat,[0,1.43,0]);this.add(this.root,new THREE.CylinderGeometry(.25,.41,.5,5),m.coatLight,[0,1.08,.03]);
    this.add(this.root,new THREE.BoxGeometry(.22,.61,.03),m.linen,[0,1.4,.32]);this.add(this.root,new THREE.CylinderGeometry(.33,.34,.13,8),m.scarf,[0,1.8,0]);
    this.add(this.root,new THREE.DodecahedronGeometry(.23,0),m.skin,[0,2.09,.02],[.84,1.1,.86]);this.add(this.root,new THREE.SphereGeometry(.245,8,5,0,Math.PI*2,0,Math.PI/2),m.hair,[0,2.2,.02],[1.05,.8,1]);
    this.add(this.root,new THREE.BoxGeometry(.52,.09,.4),m.leather,[0,1.02,.05]);this.add(this.root,new THREE.DodecahedronGeometry(.21,0),m.leather,[-.38,1.62,.02],[1.1,.7,1]);this.add(this.root,new THREE.BoxGeometry(.23,.3,.2),m.leather,[.35,.95,.15]);
    for(const [side,sign] of [['right',-1],['left',1]]){
      const leg=new THREE.Group();leg.position.set(sign*.17,.83,0);this.root.add(leg);this.legs.push({side,sign,pivot:leg});this.add(leg,new THREE.CylinderGeometry(.13,.14,.47,5),m.pants,[0,-.23,0]);this.add(leg,new THREE.BoxGeometry(.25,.18,.39),m.boot,[0,-.49,.08]);
      const arm=new THREE.Group();arm.position.set(sign*.43,1.58,0);this.root.add(arm);this.arms.push({side,sign,pivot:arm});this.add(arm,new THREE.CylinderGeometry(.12,.09,.42,5),m.coatLight,[0,-.21,0]);this.add(arm,new THREE.CylinderGeometry(.08,.075,.33,5),m.skin,[0,-.57,0]);
      const hand=new THREE.Group();hand.position.set(0,-.78,.02);arm.add(hand);this.add(hand,new THREE.SphereGeometry(.08,6,5),m.skin);
      const axe=new THREE.Group();hand.add(axe);this.add(axe,new THREE.CylinderGeometry(.02,.027,.55,5),m.leatherLight,[0,-.25,0]);this.add(axe,new THREE.BoxGeometry(.26,.2,.08),m.steel,[.1,-.03,0]);axe.visible=false;
      const torch=new THREE.Group();hand.add(torch);this.add(torch,new THREE.CylinderGeometry(.035,.05,.4,5),m.leatherLight,[0,-.2,0]);this.add(torch,new THREE.SphereGeometry(.09,5,4),m.torch,[0,.04,0]);torch.visible=false;this.items[side]={axe,torch};
    }
    this.ready=true;this.setEquipment(state.equipment);this.resize();
  }
  setDirection(dir){if(this.root)this.root.rotation.y=dir==='up'?Math.PI:dir==='left'?-Math.PI/2:dir==='right'?Math.PI/2:0;}
  setEquipment(value){if(!this.items.right)return;this.items.right.axe.visible=value==='right'||value==='both';this.items.left.axe.visible=value==='left';this.items.right.torch.visible=false;this.items.left.torch.visible=value==='both';}
  resize(){if(!this.renderer||!this.camera)return;const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height)return;this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));this.renderer.setSize(r.width,r.height,false);const h=3,aspect=r.width/r.height;this.camera.left=-h*aspect/2;this.camera.right=h*aspect/2;this.camera.top=h/2;this.camera.bottom=-h/2;this.camera.updateProjectionMatrix();}
  update(t){if(!this.ready)return;const gait=movement(),s=Math.sin(phaseFor(t))*(runBlend() ? .55 : .38)*gait;for(const a of this.legs)a.pivot.rotation.x=a.sign*s;for(const a of this.arms)a.pivot.rotation.x=-a.sign*s*(state.equipment==='none'?1:.3);this.root.position.y=gait?Math.max(0,Math.cos(phaseFor(t)))*.05:Math.sin(t*1.7)*.012;this.renderer.render(this.scene,this.camera);}
}
try{threeOption=new ThreeCharacter($('#threeCanvas'));}catch(error){$('#threeFallback').hidden=false;$('#threeFallback').textContent=`Three.js не загрузился: ${error.message||error}`;}

function frame(ms){const t=ms/1000;drawCurrent(t);animateSvg(t);drawPixel(t);threeOption?.update(t);requestAnimationFrame(frame);}
sync();requestAnimationFrame(frame);window.addEventListener('resize',()=>threeOption?.resize(),{passive:true});
