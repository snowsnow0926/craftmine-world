/* craftmine world — dependency-free WebGL voxel runtime. Original demo code. */
(() => {
'use strict';
const SIZE=96, HALF=48, HEIGHT=40, CHUNK=16, WATER=5.65;
const B={AIR:0,GRASS:1,DIRT:2,STONE:3,WOOD:4,LEAF:5,PLANK:6,SAND:7,BRICK:8,LAMP:9,PATH:10,BEDROCK:11,GLASS:12};
const NAMES=['空气','草地方块','泥土','石块','原木','树叶','木板','沙地','石砖','灯石','林间小径','基岩','蓝色晶石'];
const HOTBAR=[B.GRASS,B.STONE,B.PLANK,B.LEAF,B.LAMP,B.BRICK];
const clone=x=>JSON.parse(JSON.stringify(x));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const hash=(x,z,s=0)=>{let n=Math.imul(x+371,374761393)^Math.imul(z+97,668265263)^Math.imul(s+13,1274126177);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
const index=(x,y,z)=>(y*SIZE+(z+HALF))*SIZE+x+HALF;
const decode=n=>{const x=n%SIZE-HALF; n=Math.floor(n/SIZE);return [x,Math.floor(n/SIZE),n%SIZE-HALF];};
const FACES=[
{n:[-1,0,0],c:[[0,1,0],[0,0,0],[0,1,1],[0,0,1]]},
{n:[1,0,0],c:[[1,1,1],[1,0,1],[1,1,0],[1,0,0]]},
{n:[0,-1,0],c:[[1,0,1],[0,0,1],[1,0,0],[0,0,0]]},
{n:[0,1,0],c:[[0,1,1],[1,1,1],[0,1,0],[1,1,0]]},
{n:[0,0,-1],c:[[1,0,0],[0,0,0],[1,1,0],[0,1,0]]},
{n:[0,0,1],c:[[0,0,1],[1,0,1],[0,1,1],[1,1,1]]}
];
function multiply(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o;}
function projection(aspect){const f=1/Math.tan(72*Math.PI/360),n=.065,far=145;return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+n)/(n-far),-1,0,0,2*far*n/(n-far),0]);}
function basis(p){const sy=Math.sin(p.yaw),cy=Math.cos(p.yaw),sp=Math.sin(p.pitch),cp=Math.cos(p.pitch);return {f:[-sy*cp,sp,-cy*cp],r:[cy,0,-sy],u:[sy*sp,cp,cy*sp]};}
function view(eye,v){const {r,u,f}=v;return new Float32Array([r[0],u[0],-f[0],0,r[1],u[1],-f[1],0,r[2],u[2],-f[2],0,-r.reduce((s,n,i)=>s+n*eye[i],0),-u.reduce((s,n,i)=>s+n*eye[i],0),f.reduce((s,n,i)=>s+n*eye[i],0),1]);}
function program(gl,vs,fs){const compile=(type,text)=>{const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};const v=compile(gl.VERTEX_SHADER,vs),f=compile(gl.FRAGMENT_SHADER,fs),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
const VS=`attribute vec3 aPos;attribute vec3 aNormal;attribute vec2 aUV;attribute vec3 aColor;uniform mat4 uVP;varying vec3 vPos;varying vec3 vNormal;varying vec2 vUV;varying vec3 vColor;void main(){vPos=aPos;vNormal=aNormal;vUV=aUV;vColor=aColor;gl_Position=uVP*vec4(aPos,1.);}`;
const FS=`precision mediump float;uniform sampler2D uAtlas;uniform vec3 uEye;uniform float uNight;uniform float uWater;uniform float uTime;varying vec3 vPos;varying vec3 vNormal;varying vec2 vUV;varying vec3 vColor;void main(){vec3 tex=texture2D(uAtlas,vUV).rgb;float sun=max(0.,dot(vNormal,normalize(vec3(-.48,.82,.27))));vec3 light=mix(vec3(.66,.72,.77)+sun*vec3(.43,.38,.26),vec3(.26,.33,.49)+sun*vec3(.13,.16,.24),uNight);vec3 color=tex*vColor*light;float emission=step(.5,vUV.y)*step(.875,vUV.x);color=mix(color,tex*vColor*.95,emission*.70);float alpha=1.;if(uWater>.5){float ripple=sin(vPos.x*3.7+vPos.z*2.3+uTime*.65)*sin(vPos.z*4.1-uTime*.55);color=mix(vec3(.20,.56,.63),vec3(.13,.25,.39),uNight)+max(0.,ripple-.78)*.55;alpha=.72;}float fog=smoothstep(35.,91.,distance(vPos,uEye));vec3 fogColor=mix(vec3(.75,.85,.81),vec3(.10,.16,.24),uNight);gl_FragColor=vec4(mix(color,fogColor,fog),alpha);}`;
const SKYVS=`attribute vec2 aPos;varying vec2 vUV;void main(){vUV=aPos;gl_Position=vec4(aPos,1.,1.);}`;
const SKYFS=`precision mediump float;varying vec2 vUV;uniform vec3 uForward;uniform vec3 uRight;uniform vec3 uUp;uniform float uAspect;uniform float uNight;float rnd(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}void main(){vec3 d=normalize(uForward+uRight*vUV.x*uAspect*.727+uUp*vUV.y*.727);float h=clamp(d.y*1.3,0.,1.);vec3 c=mix(vec3(.76,.86,.82),vec3(.39,.64,.78),h);vec3 n=mix(vec3(.10,.16,.24),vec3(.035,.065,.14),h);float sd=dot(d,normalize(vec3(-.48,.82,.27)));c+=vec3(1.,.68,.30)*pow(max(sd,0.),50.)*.22;c=mix(c,vec3(1.,.94,.71),smoothstep(.9982,.9990,sd));n+=vec3(.72,.81,1.)*pow(max(sd,0.),30.)*.08;n=mix(n,vec3(.85,.91,1.),smoothstep(.9990,.9994,sd));float star=step(.9975,rnd(floor(d*260.)))*step(.07,d.y);n+=star*.55;gl_FragColor=vec4(mix(c,n,uNight),1.);}`;
const LINEVS=`attribute vec3 aPos;uniform mat4 uVP;void main(){gl_Position=uVP*vec4(aPos,1.);}`;
const LINEFS=`precision mediump float;void main(){gl_FragColor=vec4(.96,1.,.84,1.);}`;
function makeAtlas(gl){
 const c=document.createElement('canvas');c.width=128;c.height=32;const ctx=c.getContext('2d');
 const colors=[[115,165,77],[124,95,65],[131,146,147],[132,101,64],[214,220,202],[189,148,91],[213,199,151],[131,143,147],[189,169,112],[139,116,78],[71,83,88],[119,184,181],[128,164,87],[166,134,86],[226,227,210],[246,199,107]];
 for(let t=0;t<16;t++){const tx=(t%8)*16,ty=Math.floor(t/8)*16;for(let y=0;y<16;y++)for(let x=0;x<16;x++){
 let col=colors[t].slice(),v=(hash(x+t*19,y,t)-.5)*22;
 if(t===0){if(hash(x,y,71)>.90)v+=19;} // grass
 if(t===3){v+=(Math.floor(x/3)%2?12:-10);if((x+Math.floor(y/7))%7===0)v-=22;}
 if(t===4){v=(hash(Math.floor(x/2),Math.floor(y/2),3)-.5)*64;}
 if(t===5){if(y%5===0)v-=35;if((x+(Math.floor(y/5)%2)*7)%16===0)v-=13;}
 if(t===7){if(y%8===0||(x+(Math.floor(y/8)%2)*8)%16===0)v-=38;}
 if(t===12){col=y<4+Math.floor(hash(x,0)*2)?[114,159,70]:[124,97,65];}
 if(t===13){let ring=Math.floor(Math.max(Math.abs(x-7.5),Math.abs(y-7.5)))%3;v+=ring===0?-27:4;}
 if(t===15){v+=((x===0||x===15||y===0||y===15)?-65:14);}
 ctx.fillStyle=`rgb(${col.map(n=>clamp(n+v,0,255)).join(',')})`;ctx.fillRect(tx+x,ty+y,1,1);
 }}
 if(!gl)return c;
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return texture;
}
function tile(id,n){if(id===B.GRASS)return n[1]>0?0:n[1]<0?1:12;if(id===B.WOOD)return n[1]!==0?13:3;if(id===B.LAMP)return 15;return ({2:1,3:2,5:4,6:5,7:6,8:7,10:9,11:10,12:11})[id]??14;}
class VoxelRuntime{
 constructor(canvas,callbacks={}){
  this.canvas=canvas;this.cb=callbacks;const gl=canvas.getContext('webgl',{antialias:true,alpha:false,powerPreference:'high-performance'});this.software=!gl;this.ctx=gl?null:canvas.getContext('2d');if(!gl&&!this.ctx)throw Error('此浏览器无法创建图形画布，请在 Chrome 或 Edge 中打开。');this.gl=gl||{deleteBuffer(){},viewport(){},getError(){return 0;}};
  this.world=new Uint8Array(SIZE*SIZE*HEIGHT);this.heightmap=new Uint8Array(SIZE*SIZE);this.treeAt=new Map();this.trees=new Map();this.meshes=new Map();this.keys=new Set();this.edits={};this.collected=[];this.undo=[];this.active=true;this.input=false;this.locked=false;this.dragging=false;this.fly=false;this.slot=2;this.vy=0;this.grounded=false;this.night=0;this.bob=0;this.frame=0;this.last=0;this.lastAction=0;this.target=null;this.dead=false;this.listeners=[];this.touchMove={x:0,y:0};this.wood=0;this.stone=0;
  this.p={x:-9.5,y:6,z:17.5,yaw:-.17,pitch:.035};this.prog=gl?program(gl,VS,FS):null;this.sky=gl?program(gl,SKYVS,SKYFS):null;this.lines=gl?program(gl,LINEVS,LINEFS):null;this.atlas=makeAtlas(gl);this.locations={};
  if(gl)for(const [name,p]of Object.entries({world:this.prog,sky:this.sky,lines:this.lines})){const a={},u={};const na=gl.getProgramParameter(p,gl.ACTIVE_ATTRIBUTES),nu=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);for(let i=0;i<na;i++){const n=gl.getActiveAttrib(p,i).name;a[n]=gl.getAttribLocation(p,n);}for(let i=0;i<nu;i++){const n=gl.getActiveUniform(p,i).name;u[n]=gl.getUniformLocation(p,n);}this.locations[name]={a,u};}
  if(gl){this.skyBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.skyBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);this.lineBuffer=gl.createBuffer();
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);}this.bindInput();this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);this.resize();
  const loop=t=>{if(this.dead)return;this.frame=requestAnimationFrame(loop);if(!this.active||document.hidden){this.last=t;return;}const dt=clamp((t-this.last)/1000||0,0,.045);this.last=t;this.update(dt,t);this.render(t/1000);};this.frame=requestAnimationFrame(loop);
 }
 listen(el,type,fn,opts){el.addEventListener(type,fn,opts);this.listeners.push(()=>el.removeEventListener(type,fn,opts));}
 bindInput(){
  this.listen(document,'pointerlockchange',()=>{this.locked=document.pointerLockElement===this.canvas;if(this.locked&&(!this.active||!this.input)){this.pauseInput();return;}this.input=this.locked;this.keys.clear();this.syncCursor();this.cb.onControl?.(this.locked?'locked':'idle');});
  this.listen(document,'pointerlockerror',()=>{if(this.active&&this.input)this.cb.onControl?.('drag');});
  this.listen(document,'mousemove',e=>{if(this.active&&(this.locked||this.dragging)&&this.input){this.p.yaw-=e.movementX*.0022;this.p.pitch=clamp(this.p.pitch-e.movementY*.0022,-1.52,1.52);}});
  this.listen(this.canvas,'pointerdown',e=>{
   if(!this.active)return;if(e.pointerType==='touch'){this.input=true;this.dragging=true;this.touchLook={id:e.pointerId,x:e.clientX,y:e.clientY};this.canvas.setPointerCapture(e.pointerId);return;}
   if(this.locked){if(e.button===0)this.breakBlock();if(e.button===2)this.placeBlock();}
   else {this.enter();this.dragging=true;this.canvas.setPointerCapture(e.pointerId);}
  });
  this.listen(this.canvas,'pointermove',e=>{if(this.touchLook?.id===e.pointerId){this.p.yaw-=(e.clientX-this.touchLook.x)*.006;this.p.pitch=clamp(this.p.pitch-(e.clientY-this.touchLook.y)*.006,-1.52,1.52);this.touchLook.x=e.clientX;this.touchLook.y=e.clientY;}});
  const up=()=>{this.dragging=false;this.touchLook=null;};this.listen(this.canvas,'pointerup',up);this.listen(this.canvas,'pointercancel',up);this.listen(this.canvas,'lostpointercapture',up);
  this.listen(this.canvas,'contextmenu',e=>e.preventDefault());
  this.listen(this.canvas,'wheel',e=>{if(this.input){e.preventDefault();this.slot=(this.slot+(e.deltaY>0?1:5))%6;this.cb.onSlot?.(this.slot);}},{passive:false});
  this.listen(document,'keydown',e=>{
   if(!this.active||/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName))return;
   if(e.code==='KeyT'&&!e.repeat){e.preventDefault();this.pauseInput();this.cb.onAgent?.(this.target);return;}
   if(e.code==='Escape'){this.pauseInput();return;}
   if(!this.input)return;
   if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyQ','KeyR','KeyE','KeyF','KeyZ'].includes(e.code))e.preventDefault();
   this.keys.add(e.code);
   if(!e.repeat){if(e.code==='KeyE')this.interact();if(e.code==='KeyQ')this.placeBlock();if(e.code==='KeyR')this.breakBlock();if(e.code==='KeyF'){this.fly=!this.fly;this.vy=0;this.cb.onNotice?.(this.fly?'创造飞行已开启 · 空格上升 / Shift 下降':'已切回步行');this.changed();}if(e.code==='KeyZ')this.undoBlock();if(/^Digit[1-6]$/.test(e.code)){this.slot=Number(e.code.slice(-1))-1;this.cb.onSlot?.(this.slot);}}
  });
  this.listen(document,'keyup',e=>this.keys.delete(e.code));this.listen(window,'blur',()=>this.pauseInput());this.listen(document,'visibilitychange',()=>{if(document.hidden)this.pauseInput();});
  this.listen(this.canvas,'webglcontextlost',e=>{e.preventDefault();this.setActive(false);this.cb.onError?.('图形上下文已丢失。进度保存在本地；请刷新页面重新载入。');});
 }
 // Scope cursor visibility to the game canvas, so menus and host overlays keep theirs.
 syncCursor(){this.canvas.style.cursor=this.active&&this.input?'none':'';}
 enter(){
  if(!this.active)return;
  this.input=true;this.syncCursor();this.canvas.focus({preventScroll:true});
  if(matchMedia('(pointer:coarse)').matches){this.cb.onControl?.('touch');return;}
  // Called from the player's entry button or canvas gesture only.
  // A delayed rejection must never reactivate input after opening a menu.
  const fallback=()=>{if(this.active&&this.input)this.cb.onControl?.('drag');};
  try{const p=this.canvas.requestPointerLock?.();p?.catch?.(fallback);if(!this.canvas.requestPointerLock)fallback();}catch(e){fallback();}
 }
 pauseInput(){this.input=false;this.dragging=false;this.touchMove={x:0,y:0};this.keys.clear();this.syncCursor();if(document.pointerLockElement===this.canvas)document.exitPointerLock();}
 setActive(v){this.active=v;if(!v)this.pauseInput();else this.resize();}
 resize(){const r=this.canvas.parentElement.getBoundingClientRect();if(!r.width||!r.height)return;const dpr=this.software?1:Math.min(devicePixelRatio||1,1.6);this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr);this.aspect=r.width/r.height;this.gl.viewport(0,0,this.canvas.width,this.canvas.height);}
 inside(x,y,z){return x>=-HALF&&x<HALF&&z>=-HALF&&z<HALF&&y>=0&&y<HEIGHT;}
 get(x,y,z){return this.inside(x,y,z)?this.world[index(x,y,z)]:0;}
 put(x,y,z,id){if(this.inside(x,y,z))this.world[index(x,y,z)]=id;}
 surface(x,z){return this.heightmap[(z+HALF)*SIZE+x+HALF]||6;}
 river(z){return 8+Math.sin(z*.075)*3.2+Math.sin(z*.18)*.7;}
 generate(config,snapshot=null){
  this.config=clone(config);this.world.fill(0);this.trees.clear();this.treeAt.clear();
  for(let z=-HALF;z<HALF;z++)for(let x=-HALF;x<HALF;x++){
   const d=Math.abs(x-this.river(z)),edge=Math.max(Math.abs(x),Math.abs(z));let h=6+Math.floor((Math.sin(x*.115)*Math.cos(z*.095)+Math.sin((x+z)*.08))*.9);
   if(edge>25)h+=Math.floor((edge-25)*.32+Math.sin(z*.19+x*.06)*1.3);
   if(x>-30&&x<2&&z>-16&&z<23)h=6;
   if(d<3.25)h=3;else if(d<4.7)h=5;else if(d<6)h=6;
   h=clamp(h,3,18);this.heightmap[(z+HALF)*SIZE+x+HALF]=h;
   for(let y=0;y<h;y++)this.put(x,y,z,y===0?B.BEDROCK:y<h-3?B.STONE:y<h-1?B.DIRT:d<5.4?B.SAND:B.GRASS);
   if((Math.abs(x+12)<1.25&&z>-11&&z<23)||(Math.abs(z+3)<1.35&&x>-12&&x<4))this.put(x,h-1,z,B.PATH);
  }
  const spots=[[-9,10],[-18,15],[-3,3],[-17,-9],[-6,-13],[-26,18],[0,19],[-29,-15],[19,3],[25,-9],[24,15]];
  for(let z=-40;z<44;z+=7)for(let x=-40;x<44;x+=7){let tx=x+Math.floor(hash(x,z)*4),tz=z+Math.floor(hash(x,z,1)*4);if(Math.abs(tx-this.river(tz))<8)continue;if(tx>-29&&tx<2&&tz>-16&&tz<24)continue;if(hash(x,z,3)<.20)continue;spots.push([tx,tz]);}
  for(let i=0;i<spots.length;i++){
   const [x,z]=spots[i],y=this.surface(x,z),id='tree-'+String(i+1).padStart(3,'0'),height=4+(i%3===0?1:0),voxels=[];
   const set=(a,b,c,v)=>{if(!this.inside(a,b,c))return;if(v===B.LEAF&&this.get(a,b,c))return;this.put(a,b,c,v);const k=index(a,b,c);this.treeAt.set(k,id);voxels.push(k);};
   for(let j=0;j<height;j++)set(x,y+j,z,B.WOOD);
   for(let dy=-1;dy<=2;dy++){const rad=dy===2?1:2;for(let dz=-rad;dz<=rad;dz++)for(let dx=-rad;dx<=rad;dx++){if(Math.abs(dx)===2&&Math.abs(dz)===2&&hash(x+dx,z+dz,dy)>.24)continue;if(dx===0&&dz===0&&dy<0)continue;set(x+dx,y+height+dy,z+dz,B.LEAF);}}
   this.trees.set(id,{id,x:x+.5,y,z:z+.5,voxels});
  }
  this.makeCabin();if(config.bridge)this.makeBridge();
  if(snapshot){this.edits=clone(snapshot.edits||{});this.collected=[...(snapshot.collected||[])];this.p={...this.p,...snapshot.player};this.wood=snapshot.wood||0;this.stone=snapshot.stone||0;this.fly=!!snapshot.fly;this.slot=clamp(snapshot.slot??2,0,5);}
  for(const id of this.collected){const t=this.trees.get(id);if(t)for(const k of t.voxels)this.world[k]=0;}
  for(const [k,v]of Object.entries(this.edits))this.world[Number(k)]=v;
  for(let z=-HALF;z<HALF;z+=CHUNK)for(let x=-HALF;x<HALF;x+=CHUNK)this.rebuild(x,z);
  this.makeWater();this.makeClouds();this.vy=0;this.safePosition();this.cb.onSlot?.(this.slot);this.night=config.night?1:0;this.changed();
 }
 makeCabin(){
  const x0=-25,z0=-5,w=8,d=7,y0=6;
  for(let z=z0-1;z<=z0+d;z++)for(let x=x0-1;x<=x0+w;x++)this.put(x,y0-1,z,B.BRICK);
  for(let z=z0;z<z0+d;z++)for(let x=x0;x<x0+w;x++){
   this.put(x,y0,z,B.PLANK);
   for(let y=y0+1;y<=y0+4;y++)if(x===x0||x===x0+w-1||z===z0||z===z0+d-1){
    const door=z===z0+d-1&&x>=x0+3&&x<=x0+4&&y<=y0+3;
    const window=((x===x0||x===x0+w-1)&&z>=z0+2&&z<=z0+3&&y>=y0+2&&y<=y0+3)||(z===z0&&x>=x0+3&&x<=x0+4&&y===y0+3);
    if(!door)this.put(x,y,z,window?B.GLASS:((x===x0||x===x0+w-1)&&(z===z0||z===z0+d-1))?B.WOOD:B.PLANK);
   }
  }
  for(let x=x0-1;x<=x0+w;x++){const rise=Math.floor(Math.min(x-x0+1,x0+w-x)*.65);for(let z=z0-1;z<=z0+d;z++)this.put(x,y0+5+rise,z,B.WOOD);}
  this.put(x0+1,y0+1,z0+1,B.LAMP);this.put(x0+w-2,y0+1,z0+1,B.LAMP);
  for(let z=z0+d;z<z0+d+4;z++)for(let x=x0+2;x<=x0+5;x++)this.put(x,y0-1,z,B.PATH);
  for(const [x,z]of [[-15,4],[-15,-3],[-15,16],[1,-3]]){this.put(x,6,z,B.WOOD);this.put(x,7,z,B.LAMP);}
 }
 makeBridge(){for(let x=1;x<=15;x++)for(let z=-5;z<=-1;z++){this.put(x,5,z,B.PLANK);if((z===-5||z===-1)&&x%3===1){this.put(x,6,z,B.WOOD);this.put(x,7,z,B.LAMP);}}}
 opaque(x,y,z){return !!this.get(x,y,z);}
 rebuild(cx,cz){
  cx=Math.floor((cx+HALF)/CHUNK)*CHUNK-HALF;cz=Math.floor((cz+HALF)/CHUNK)*CHUNK-HALF;if(cx<-HALF||cx>=HALF||cz<-HALF||cz>=HALF)return;
  const vertices=[];const tint=this.config.treeStyle==='sakura'?[1.05,.69,.82]:this.config.treeStyle==='autumn'?[1.05,.81,.36]:[.61,.86,.37];
  for(let y=0;y<HEIGHT;y++)for(let z=cz;z<cz+CHUNK;z++)for(let x=cx;x<cx+CHUNK;x++){
   const id=this.get(x,y,z);if(!id)continue;
   for(const face of FACES){const n=face.n;if(this.get(x+n[0],y+n[1],z+n[2]))continue;
    const tex=tile(id,n),tu=tex%8,tv=Math.floor(tex/8),colors=[];const dirs=n[0]?[1,2]:n[1]?[0,2]:[0,1];
    for(let ci=0;ci<4;ci++){const c=face.c[ci];const p=[x+n[0],y+n[1],z+n[2]],s1=p.slice(),s2=p.slice(),co=p.slice();const a=dirs[0],b=dirs[1],sa=c[a]?1:-1,sb=c[b]?1:-1;s1[a]+=sa;s2[b]+=sb;co[a]+=sa;co[b]+=sb;
     const o1=this.opaque(...s1),o2=this.opaque(...s2),o3=this.opaque(...co);const ao=o1&&o2?3:Number(o1)+Number(o2)+Number(o3);let bright=(1-ao*.125)*(.96+hash(x,z,y)*.08);colors.push((id===B.LEAF?tint:[1,1,1]).map(v=>v*bright));
    }
    const uv=[[.02,.02],[.02,.98],[.98,.02],[.98,.98]];
    // Consistent outward winding; AO adds depth at adjacent blocks.
    for(const i of [0,1,2,2,1,3]){const c=face.c[i];vertices.push(x+c[0],y+c[1],z+c[2],...n,(tu+uv[i][0])/8,(tv+uv[i][1])/2,...colors[i]);}
   }
  }
  const key=cx+','+cz;const old=this.meshes.get(key);if(old)this.gl.deleteBuffer(old.buffer);this.meshes.set(key,this.upload(vertices));
 }
 upload(vertices){if(this.software)return{buffer:null,count:vertices.length/11,data:new Float32Array(vertices)};const gl=this.gl,buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);return{buffer,count:vertices.length/11};}
 makeWater(){const v=[];for(let z=-HALF;z<HALF;z++)for(let x=-HALF;x<HALF;x++)if(this.surface(x,z)<WATER){for(const i of [0,1,2,2,1,3]){const c=FACES[3].c[i];v.push(x+c[0],WATER,z+c[2],0,1,0,.82,.8,1,1,1);}}if(this.water)this.gl.deleteBuffer(this.water.buffer);this.water=this.upload(v);}
 makeClouds(){if(this.clouds)return;const v=[];for(let i=0;i<18;i++){const x=-90+hash(i,4)*180,z=-90+hash(i,6)*180,y=28+hash(i,8)*5,w=7+hash(i,3)*12,d=3+hash(i,1)*6;for(const f of FACES)for(const j of [0,1,2,2,1,3]){const c=f.c[j];v.push(x+c[0]*w,y+c[1]*.65,z+c[2]*d,...f.n,.8,.8,1.04,1.04,1.03);}}this.clouds=this.upload(v);}
 rebuildNear(x,z){const keys=new Set();for(const [a,b]of [[x,z],[x-1,z],[x+1,z],[x,z-1],[x,z+1]]){const cx=Math.floor((a+HALF)/CHUNK)*CHUNK-HALF,cz=Math.floor((b+HALF)/CHUNK)*CHUNK-HALF;keys.add(cx+','+cz);}for(const k of keys)this.rebuild(...k.split(',').map(Number));}
 collision(x,y,z){const r=.29,h=1.72;if(x-r<-HALF+.2||x+r>=HALF-.2||z-r<-HALF+.2||z+r>=HALF-.2||y+h>HEIGHT-.1)return true;for(let yy=Math.floor(y+.001);yy<=Math.floor(y+h-.001);yy++)for(let zz=Math.floor(z-r+.001);zz<=Math.floor(z+r-.001);zz++)for(let xx=Math.floor(x-r+.001);xx<=Math.floor(x+r-.001);xx++)if(this.get(xx,yy,zz))return true;return false;}
 safePosition(){const p=this.p;if(!this.collision(p.x,p.y,p.z)&&p.y>.1)return;for(let i=1;i<22;i++)if(!this.collision(p.x,p.y+i,p.z)&&p.y+i<HEIGHT-2){p.y+=i;return;}this.respawn(false);}
 respawn(notify=true){this.p={x:-9.5,y:6,z:17.5,yaw:-.17,pitch:.035};for(let y=6;y<HEIGHT-2;y++)if(!this.collision(this.p.x,y,this.p.z)){this.p.y=y;break;}this.vy=0;this.fly=false;this.changed();if(notify)this.cb.onNotice?.('已回到出生点，搭建内容和背包不变');}
 moveAxis(axis,amount){if(!amount)return;const p=this.p;const steps=Math.ceil(Math.abs(amount)/.14),step=amount/steps;for(let i=0;i<steps;i++){const q={...p,[axis]:p[axis]+step};if(!this.collision(q.x,q.y,q.z))p[axis]+=step;else if(axis!=='y'&&this.grounded&&!this.fly&&!this.collision(q.x,p.y+1.01,q.z)){p[axis]+=step;p.y+=1.01;}else{if(axis==='y'){if(step<0){p.y=Math.floor(p.y+.001);this.grounded=true;}else p.y=Math.ceil(p.y+1.72)-1.72-.002;this.vy=0;}break;}}}
 update(dt,time){
  this.night+=(Number(this.config?.night||false)-this.night)*Math.min(1,dt*3);
  if(this.input){let f=(this.keys.has('KeyW')||this.keys.has('ArrowUp')?1:0)-(this.keys.has('KeyS')||this.keys.has('ArrowDown')?1:0)-this.touchMove.y;let r=(this.keys.has('KeyD')||this.keys.has('ArrowRight')?1:0)-(this.keys.has('KeyA')||this.keys.has('ArrowLeft')?1:0)+this.touchMove.x;
   const n=Math.max(1,Math.hypot(f,r)),shift=this.keys.has('ShiftLeft')||this.keys.has('ShiftRight');let speed=(this.config?.speed||4.5)*(this.fly?1.65:shift?1.55:1),yaw=this.p.yaw;
   if(f||r){this.moveAxis('x',(-Math.sin(yaw)*f+Math.cos(yaw)*r)/n*speed*dt);this.moveAxis('z',(-Math.cos(yaw)*f-Math.sin(yaw)*r)/n*speed*dt);this.bob+=dt*10;}
   if(this.fly){this.grounded=false;this.moveAxis('y',((this.keys.has('Space')?1:0)-(shift?1:0))*speed*dt);}else{
    const wet=this.p.y<WATER-.2&&this.surface(Math.floor(this.p.x),Math.floor(this.p.z))<WATER;
    if(this.keys.has('Space')&&(this.grounded||wet))this.vy=wet?5:8.3;
    this.vy-=dt*(wet?5:24);if(wet)this.vy=Math.max(-1.5,this.vy);this.grounded=false;this.moveAxis('y',this.vy*dt);
   }
   if(this.p.y<.1)this.respawn(false);
  }
  const b=basis(this.p),eye=[this.p.x,this.p.y+1.56,this.p.z];this.target=this.raycast(eye,b.f,7);this.cb.onTarget?.(this.target);
  if(time-(this.lastStats||0)>300){this.cb.onStats?.({position:{...this.p},wood:this.wood,stone:this.stone,fly:this.fly,blocks:Object.keys(this.edits).length,trees:this.trees.size,fps:this.fps||0});this.lastStats=time;}
  this.fpsAcc=(this.fpsAcc||0)+dt;this.fpsFrames=(this.fpsFrames||0)+1;if(this.fpsAcc>=1){this.fps=Math.round(this.fpsFrames/this.fpsAcc);this.fpsAcc=0;this.fpsFrames=0;}
 }
 raycast(origin,dir,reach=7){let [x,y,z]=origin.map(Math.floor);const sx=dir[0]>=0?1:-1,sy=dir[1]>=0?1:-1,sz=dir[2]>=0?1:-1;const dd=dir.map(v=>Math.abs(v)<1e-9?Infinity:Math.abs(1/v));let tx=dd[0]*(sx>0?x+1-origin[0]:origin[0]-x),ty=dd[1]*(sy>0?y+1-origin[1]:origin[1]-y),tz=dd[2]*(sz>0?z+1-origin[2]:origin[2]-z),dist=0,normal=[0,0,0];for(let i=0;i<100&&dist<=reach;i++){const block=this.get(x,y,z);if(block)return{x,y,z,block,name:NAMES[block],normal,treeId:this.treeAt.get(index(x,y,z))||null,distance:dist};if(tx<=ty&&tx<=tz){x+=sx;dist=tx;tx+=dd[0];normal=[-sx,0,0];}else if(ty<=tz){y+=sy;dist=ty;ty+=dd[1];normal=[0,-sy,0];}else{z+=sz;dist=tz;tz+=dd[2];normal=[0,0,-sz];}}return null;}
 setBlock(x,y,z,id,record=true){if(!this.inside(x,y,z)||y===0)return false;const k=index(x,y,z),old=this.world[k];if(id===old)return false;if(Object.keys(this.edits).length>=12000&&!Object.hasOwn(this.edits,k)){this.cb.onNotice?.('本演示已达到 12,000 处方块修改上限；请先导出世界卡带。');return false;}if(record){this.undo.push({x,y,z,old,had:Object.hasOwn(this.edits,k),previous:this.edits[k]});this.undo=this.undo.slice(-40);}this.world[k]=id;this.edits[k]=id;this.rebuildNear(x,z);this.changed();return true;}
 breakBlock(){const t=this.target;if(!t)return this.cb.onNotice?.('请靠近并对准一个方块');if(t.y===0)return this.cb.onNotice?.('基岩是世界底部，不能破坏');if(t.treeId&&t.block===B.WOOD&&!this.harvestEnabled(t.treeId))return this.cb.onNotice?.('这棵树尚未启用采集。按 T，说“让树木可以被砍”。');if(this.setBlock(t.x,t.y,t.z,0)){this.cb.onNotice?.('已移除 '+t.name+' · Z 撤销');this.cb.onEffect?.('break');}}
 placeBlock(){const t=this.target;if(!t)return this.cb.onNotice?.('对准近处方块的一个表面，再放置');const [x,y,z]=[t.x+t.normal[0],t.y+t.normal[1],t.z+t.normal[2]];if(!this.inside(x,y,z)||y===0)return this.cb.onNotice?.('超出这个演示世界的边界');const old=this.get(x,y,z);if(old)return;this.put(x,y,z,HOTBAR[this.slot]);const blocked=this.collision(this.p.x,this.p.y,this.p.z);this.put(x,y,z,old);if(blocked)return this.cb.onNotice?.('这个位置会挡住你，请挪开一点再放置');if(this.setBlock(x,y,z,HOTBAR[this.slot]))this.cb.onEffect?.('place');}
 harvestEnabled(id){return this.config.treeRules?.[id]?.harvest??this.config.harvest;}
 interact(){const t=this.target;if(!t?.treeId){this.cb.onNotice?.('靠近树干并对准它，按 E 采集整棵树');return;}if(this.collected.includes(t.treeId))return this.cb.onNotice?.('这棵树已经采集过了');if(!this.harvestEnabled(t.treeId))return this.cb.onNotice?.('先按 T，让 Agent 启用这棵树的采集玩法');const tree=this.trees.get(t.treeId),chunks=new Set();for(const k of tree.voxels){if(Object.hasOwn(this.edits,k))continue;this.world[k]=0;const [x,y,z]=decode(k);for(const [a,b]of [[x,z],[x-1,z],[x+1,z],[x,z-1],[x,z+1]])chunks.add(`${Math.floor((a+HALF)/16)*16-HALF},${Math.floor((b+HALF)/16)*16-HALF}`);}this.collected.push(tree.id);const reward=this.config.treeRules?.[tree.id]?.yield??this.config.yield;this.wood+=reward;for(const k of chunks)this.rebuild(...k.split(',').map(Number));this.changed();this.cb.onNotice?.(`采集成功 · 木材 +${reward}`);this.cb.onEffect?.('harvest');}
 undoBlock(){const last=this.undo.pop();if(!last)return this.cb.onNotice?.('暂时没有可以撤销的手动方块操作');const k=index(last.x,last.y,last.z);this.world[k]=last.old;if(last.had)this.edits[k]=last.previous;else delete this.edits[k];this.rebuildNear(last.x,last.z);this.safePosition();this.changed();this.cb.onNotice?.('已撤销上一次方块操作');}
 snapshot(){return{player:{...this.p},wood:this.wood,stone:this.stone,edits:clone(this.edits),collected:[...this.collected],fly:this.fly,slot:this.slot};}
 changed(){this.cb.onChange?.();}
 drawMesh(mesh,locations){if(!mesh?.count)return;const gl=this.gl,a=locations.a;gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);for(const [name,size,off]of [['aPos',3,0],['aNormal',3,12],['aUV',2,24],['aColor',3,32]]){const loc=a[name];if(loc==null||loc<0)continue;gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,44,off);}gl.drawArrays(gl.TRIANGLES,0,mesh.count);}
 render(time){if(this.software){if(time-(this.lastSoftFrame||0)<.04)return;this.lastSoftFrame=time;this.renderSoftware(time);return;}const gl=this.gl,b=basis(this.p),eye=[this.p.x,this.p.y+1.56,this.p.z],vp=multiply(projection(this.aspect||1.6),view(eye,b));
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);for(let i=0;i<8;i++)gl.disableVertexAttribArray(i);
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.useProgram(this.sky);let {a,u}=this.locations.sky;gl.bindBuffer(gl.ARRAY_BUFFER,this.skyBuffer);gl.enableVertexAttribArray(a.aPos);gl.vertexAttribPointer(a.aPos,2,gl.FLOAT,false,0,0);gl.uniform3fv(u.uForward,b.f);gl.uniform3fv(u.uRight,b.r);gl.uniform3fv(u.uUp,b.u);gl.uniform1f(u.uAspect,this.aspect||1);gl.uniform1f(u.uNight,this.night);gl.drawArrays(gl.TRIANGLES,0,3);
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.useProgram(this.prog);({a,u}=this.locations.world);gl.uniformMatrix4fv(u.uVP,false,vp);gl.uniform3fv(u.uEye,eye);gl.uniform1f(u.uNight,this.night);gl.uniform1f(u.uTime,time);gl.uniform1f(u.uWater,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.atlas);gl.uniform1i(u.uAtlas,0);
  for(const mesh of this.meshes.values())this.drawMesh(mesh,this.locations.world);this.drawMesh(this.clouds,this.locations.world);
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.uniform1f(u.uWater,1);this.drawMesh(this.water,this.locations.world);gl.depthMask(true);gl.disable(gl.BLEND);
  if(this.target){const t=this.target,v=[],e=.006;const corners=[[0,0,0],[1,0,0],[1,0,1],[0,0,1],[0,1,0],[1,1,0],[1,1,1],[0,1,1]];for(const [i,j]of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]])for(const k of [i,j])v.push(t.x+corners[k][0]*(1+2*e)-e,t.y+corners[k][1]*(1+2*e)-e,t.z+corners[k][2]*(1+2*e)-e);
   for(let i=0;i<8;i++)gl.disableVertexAttribArray(i);gl.useProgram(this.lines);({a,u}=this.locations.lines);gl.bindBuffer(gl.ARRAY_BUFFER,this.lineBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(a.aPos);gl.vertexAttribPointer(a.aPos,3,gl.FLOAT,false,0,0);gl.uniformMatrix4fv(u.uVP,false,vp);gl.drawArrays(gl.LINES,0,24);
  }
 }

 renderSoftware(time){
  const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height,p=this.p,b=basis(p),eye=[p.x,p.y+1.56,p.z],focal=h/(2*Math.tan(72*Math.PI/360)),night=this.night;
  const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t),rgb=c=>'rgb('+c.map(v=>Math.max(0,Math.min(255,Math.round(v)))).join(',')+')';
  const skyTop=mix([114,177,206],[12,21,42],night),skyBottom=mix([194,221,211],[28,43,60],night);
  const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,rgb(skyTop));gradient.addColorStop(.8,rgb(skyBottom));gradient.addColorStop(1,rgb(skyBottom));ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
  if(night>.5){ctx.fillStyle='#d8e3dc';for(let i=0;i<48;i++){let sx=hash(i,45)*w,sy=hash(i,11)*h*.6;ctx.globalAlpha=.25+hash(i,8)*.65;ctx.fillRect(sx,sy,1.5,1.5);}ctx.globalAlpha=1;}
  const trans=(x,y,z)=>{const v=[x-eye[0],y-eye[1],z-eye[2]];return[v[0]*b.r[0]+v[2]*b.r[2],v[0]*b.u[0]+v[1]*b.u[1]+v[2]*b.u[2],v[0]*b.f[0]+v[1]*b.f[1]+v[2]*b.f[2]];};
  const palette=[[115,165,77],[124,95,65],[131,146,147],[132,101,64],[214,220,202],[189,148,91],[213,199,151],[131,143,147],[189,169,112],[139,116,78],[71,83,88],[119,184,181],[117,135,72],[166,134,86],[226,227,210],[246,199,107]];
  const faces=[],meshes=[...this.meshes.values(),this.clouds,this.water];
  for(const mesh of meshes){if(!mesh?.data)continue;const data=mesh.data,water=mesh===this.water;for(let i=0;i<data.length;i+=66){
   const x=data[i],y=data[i+1],z=data[i+2],nx=data[i+3],ny=data[i+4],nz=data[i+5];if((eye[0]-x)*nx+(eye[1]-y)*ny+(eye[2]-z)*nz<=0)continue;
   let points=[0,11,55,22].map(off=>trans(data[i+off],data[i+off+1],data[i+off+2]));
   if(points.every(v=>v[2]<=.085)||points.every(v=>v[2]>85))continue;
   if(points.some(v=>v[2]<.085)){const clipped=[];for(let j=0;j<points.length;j++){const a=points[j],bb=points[(j+1)%points.length],ina=a[2]>=.085,inb=bb[2]>=.085;if(ina)clipped.push(a);if(ina!==inb){const t=(.085-a[2])/(bb[2]-a[2]);clipped.push([a[0]+(bb[0]-a[0])*t,a[1]+(bb[1]-a[1])*t,.085]);}}points=clipped;if(points.length<3)continue;}
   const projected=points.map(v=>[w/2+v[0]/v[2]*focal,h/2-v[1]/v[2]*focal]);if(projected.every(v=>v[0]<-1)||projected.every(v=>v[0]>w+1)||projected.every(v=>v[1]<-1)||projected.every(v=>v[1]>h+1))continue;
   const depth=points.reduce((a,v)=>a+v[2],0)/points.length;
   const tex=Math.floor(data[i+6]*8)+Math.floor(data[i+7]*2)*8,col=palette[tex]||palette[0];
   const sun=Math.max(0,nx*-.48+ny*.82+nz*.27),base=water?mix([71,161,177],[37,70,99],night):col.map((v,k)=>v*data[i+8+k]*(.67+sun*.35)*(1-night*.57));
   const dist=Math.hypot(x-eye[0],y-eye[1],z-eye[2]),fog=Math.max(0,Math.min(.96,(dist-34)/57));const color=mix(base,skyBottom,fog*fog*(3-2*fog));
   faces.push({points:projected,depth,color,water,tex,x,y,z,face:ny||nx*.8||nz*.7});
  }}
  faces.sort((a,b)=>b.depth-a.depth);
  ctx.lineJoin='round';ctx.lineWidth=.45;
  for(const face of faces){const ps=face.points;ctx.fillStyle=rgb(face.color);ctx.strokeStyle=ctx.fillStyle;ctx.globalAlpha=face.water?.78:1;ctx.beginPath();ctx.moveTo(...ps[0]);for(let j=1;j<ps.length;j++)ctx.lineTo(...ps[j]);ctx.closePath();ctx.fill();ctx.stroke();
   // A sparse inset patch gives the near voxels a quiet pixel-like surface without external textures.
   if(!face.water&&face.depth<22&&ps.length===4&&hash(face.x,face.z,face.y)>.43){const c=[(ps[0][0]+ps[2][0])/2,(ps[0][1]+ps[2][1])/2];ctx.globalAlpha=.09;ctx.fillStyle=hash(face.x,face.y)>.5?'#fffbe4':'#324524';ctx.beginPath();for(let j=0;j<4;j++){const v=[c[0]+(ps[j][0]-c[0])*.45,c[1]+(ps[j][1]-c[1])*.45];j?ctx.lineTo(...v):ctx.moveTo(...v);}ctx.closePath();ctx.fill();}
  }ctx.globalAlpha=1;
  if(this.target){const t=this.target,vs=[[0,0,0],[1,0,0],[1,0,1],[0,0,1],[0,1,0],[1,1,0],[1,1,1],[0,1,1]].map(v=>trans(t.x+v[0],t.y+v[1],t.z+v[2]));ctx.strokeStyle='#f1ffd2';ctx.lineWidth=1.25;for(const [i,j]of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]])if(vs[i][2]>.09&&vs[j][2]>.09){ctx.beginPath();ctx.moveTo(w/2+vs[i][0]/vs[i][2]*focal,h/2-vs[i][1]/vs[i][2]*focal);ctx.lineTo(w/2+vs[j][0]/vs[j][2]*focal,h/2-vs[j][1]/vs[j][2]*focal);ctx.stroke();}}
 }

 dispose(){this.dead=true;cancelAnimationFrame(this.frame);this.pauseInput();this.resizeObserver.disconnect();this.listeners.forEach(f=>f());for(const m of this.meshes.values())this.gl.deleteBuffer(m.buffer);for(const m of [this.water,this.clouds])if(m)this.gl.deleteBuffer(m.buffer);if(this.software)return;this.gl.deleteBuffer(this.skyBuffer);this.gl.deleteBuffer(this.lineBuffer);this.gl.deleteTexture(this.atlas);[this.prog,this.sky,this.lines].forEach(p=>this.gl.deleteProgram(p));}
}
window.WorldRuntime={VoxelRuntime,B,NAMES,HOTBAR,SIZE,HALF,HEIGHT,index,decode,hash,basis};
})();
