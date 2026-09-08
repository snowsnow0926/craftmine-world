import { identity,multiplyMatrix,ASSET_LIMITS } from './asset-decode.mjs';
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=v=>{const d=Math.hypot(...v)||1;return v.map(n=>n/d);},dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0);
const VS=`attribute vec3 aPosition;attribute vec3 aNormal;attribute vec2 aUV;attribute vec4 aColor;uniform mat4 uVP;uniform mat4 uModel;uniform mat3 uNormal;varying vec3 vNormal;varying vec2 vUV;varying vec4 vColor;void main(){vNormal=uNormal*aNormal;vUV=aUV;vColor=aColor;gl_Position=uVP*uModel*vec4(aPosition,1.);}`;
const FS=`precision highp float;uniform sampler2D uTexture;uniform vec4 uColor;uniform float uAlpha;uniform float uCutoff;uniform float uUnlit;uniform float uNight;uniform vec2 uWrap;varying vec3 vNormal;varying vec2 vUV;varying vec4 vColor;
float wrap(float x,float mode){if(mode<.5)return clamp(x,0.,1.);if(mode<1.5)return fract(x);return 1.-abs(mod(x,2.)-1.);}
vec3 linear(vec3 v){return mix(pow((v+.055)/1.055,vec3(2.4)),v/12.92,step(v,vec3(.04045)));}
vec3 srgb(vec3 v){v=max(vec3(0.),v);return mix(1.055*pow(v,vec3(1./2.4))-.055,12.92*v,step(v,vec3(.0031308)));}
void main(){vec4 tex=texture2D(uTexture,vec2(wrap(vUV.x,uWrap.x),wrap(vUV.y,uWrap.y)));vec4 color=vec4(linear(tex.rgb),tex.a)*uColor*vColor;if(uAlpha>.5&&uAlpha<1.5&&color.a<uCutoff)discard;if(uAlpha<1.5)color.a=1.;vec3 n=normalize(vNormal);if(!gl_FrontFacing)n=-n;float sun=max(0.,dot(n,normalize(vec3(-.4,.8,.5))));vec3 light=mix(vec3(.64+sun*.46),vec3(.2,.27,.4)+sun*.12,uNight);gl_FragColor=vec4(srgb(color.rgb*mix(light,vec3(1.),uUnlit)),color.a);}`;
function makeProgram(gl){
  const shaders=[],program=gl.createProgram();
  try{for(const [type,source]of [[gl.VERTEX_SHADER,VS],[gl.FRAGMENT_SHADER,FS]]){const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('素材着色器无法编译：'+gl.getShaderInfoLog(shader));gl.attachShader(program,shader);}gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('素材渲染器无法连接');return program;}
  catch(error){gl.deleteProgram(program);throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
}
function imageModel(decoded,bitmap){
  const half=bitmap.width/bitmap.height/2,vertices=[];const points=[[-half,-.5,0,0,1],[half,-.5,0,1,1],[-half,.5,0,0,0],[half,.5,0,1,0]];
  for(const i of [0,1,2,2,1,3]){const p=points[i];vertices.push(...p.slice(0,3),0,0,1,...p.slice(3),1,1,1,1);}
  return {draws:[{vertices:new Float32Array(vertices),material:0}],materials:[{color:[1,1,1,1],alpha:'BLEND',cutoff:.5,doubleSided:true,unlit:true,texture:{image:0,wrapS:33071,wrapT:33071,nearest:false}}],bounds:{min:[-half,-.5,0],max:[half,.5,0]},triangles:2,kind:'image'};
}
export class AssetRenderer {
  constructor(gl){
    if(!gl)throw Error('素材预览需要 WebGL');this.gl=gl;this.program=makeProgram(gl);this.meshes=[];this.textures=[];this.disposed=false;
    this.attributes=Object.fromEntries(['aPosition','aNormal','aUV','aColor'].map(name=>[name,gl.getAttribLocation(this.program,name)]));this.uniforms=Object.fromEntries(['uVP','uModel','uNormal','uColor','uTexture','uAlpha','uCutoff','uUnlit','uNight','uWrap'].map(name=>[name,gl.getUniformLocation(this.program,name)]));
  }
  async load(decoded){
    this.clear();const gl=this.gl,images=decoded.kind==='image'?[decoded]:decoded.images;let model=decoded;
    try{
      for(const image of images){
        const bitmap=await createImageBitmap(new Blob([image.bytes],{type:image.mime}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
        try{
          if(this.disposed)throw Error('素材预览已关闭');
          if(bitmap.width>ASSET_LIMITS.imageSide||bitmap.height>ASSET_LIMITS.imageSide||!((bitmap.width===image.width&&bitmap.height===image.height)||(bitmap.width===image.height&&bitmap.height===image.width)))throw Error('图片解码尺寸与预检不一致');
          if(decoded.kind==='image')model=imageModel(decoded,bitmap);
          const texture=gl.createTexture();this.textures.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        }finally{bitmap.close();}
      }
      const white=gl.createTexture();this.textures.push(white);this.white=white;gl.bindTexture(gl.TEXTURE_2D,white);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      this.model=model;
      for(const draw of model.draws){const buffer=gl.createBuffer();this.meshes.push({buffer,count:draw.vertices.length/12,material:draw.material});gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,draw.vertices,gl.STATIC_DRAW);}
      if(gl.getError()!==gl.NO_ERROR)throw Error('素材无法上传至图形设备');return {kind:decoded.kind,triangles:model.triangles,images:images.length,bounds:model.bounds};
    }catch(error){this.clear();throw Error('素材载入失败：'+error.message);}
  }
  draw(vp,modelMatrix=identity(),{night=0}={}){
    if(!this.model||this.disposed)return;const gl=this.gl,u=this.uniforms,a=this.attributes;
    const cofactor=[cross(modelMatrix.slice(4,7),modelMatrix.slice(8,11)),cross(modelMatrix.slice(8,11),modelMatrix.slice(0,3)),cross(modelMatrix.slice(0,3),modelMatrix.slice(4,7))],det=dot(modelMatrix.slice(0,3),cofactor[0]);if(Math.abs(det)<1e-16)return;
    gl.useProgram(this.program);gl.enable(gl.DEPTH_TEST);gl.activeTexture(gl.TEXTURE0);gl.uniform1i(u.uTexture,0);gl.uniformMatrix4fv(u.uVP,false,vp);gl.uniformMatrix4fv(u.uModel,false,modelMatrix);gl.uniformMatrix3fv(u.uNormal,false,cofactor.flat().map(n=>n/det));gl.uniform1f(u.uNight,night);
    const wrap=value=>value===33071?0:value===33648?2:1;
    for(const mesh of [...this.meshes].sort((a,b)=>Number(this.model.materials[a.material].alpha==='BLEND')-Number(this.model.materials[b.material].alpha==='BLEND'))){
      const material=this.model.materials[mesh.material],texture=material.texture;
      material.doubleSided?gl.disable(gl.CULL_FACE):gl.enable(gl.CULL_FACE);gl.frontFace(det<0?gl.CW:gl.CCW);
      if(material.alpha==='BLEND'){gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);}else{gl.disable(gl.BLEND);gl.depthMask(true);}
      gl.bindTexture(gl.TEXTURE_2D,texture?this.textures[texture.image]:this.white);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,texture?.nearest?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,texture?.nearest?gl.NEAREST:gl.LINEAR);gl.uniform2fv(u.uWrap,[wrap(texture?.wrapS??33071),wrap(texture?.wrapT??33071)]);gl.uniform4fv(u.uColor,material.color);gl.uniform1f(u.uAlpha,{OPAQUE:0,MASK:1,BLEND:2}[material.alpha]);gl.uniform1f(u.uCutoff,material.cutoff);gl.uniform1f(u.uUnlit,material.unlit?1:0);
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);for(const [name,size,offset]of [['aPosition',3,0],['aNormal',3,12],['aUV',2,24],['aColor',4,32]])if(a[name]>=0){gl.enableVertexAttribArray(a[name]);gl.vertexAttribPointer(a[name],size,gl.FLOAT,false,48,offset);}gl.drawArrays(gl.TRIANGLES,0,mesh.count);
    }
    gl.depthMask(true);gl.frontFace(gl.CCW);gl.disable(gl.BLEND);gl.enable(gl.CULL_FACE);
  }
  clear(){const gl=this.gl;for(const mesh of this.meshes)gl.deleteBuffer(mesh.buffer);for(const texture of this.textures)gl.deleteTexture(texture);this.meshes=[];this.textures=[];this.model=null;}
  dispose(){if(this.disposed)return;this.disposed=true;this.clear();this.gl.deleteProgram(this.program);}
}
export class AssetPreview {
  constructor(canvas){this.canvas=canvas;this.gl=canvas.getContext('webgl',{alpha:true,antialias:true,preserveDrawingBuffer:true});this.renderer=new AssetRenderer(this.gl);this.angle=.55;this.zoom=1;this.observer=new ResizeObserver(()=>this.render());this.observer.observe(canvas);}
  async load(decoded){const result=await this.renderer.load(decoded);this.angle=decoded.kind==='image'?0:.55;this.zoom=1;this.render();return result;}
  rotate(delta){this.angle+=delta;this.render();}
  scale(factor){this.zoom=Math.max(.35,Math.min(3,this.zoom*factor));this.render();}
  render(){
    const model=this.renderer.model;if(!model||this.renderer.disposed)return;const gl=this.gl,canvas=this.canvas,box=canvas.getBoundingClientRect(),w=Math.max(1,Math.round(box.width||canvas.width)),h=Math.max(1,Math.round(box.height||canvas.height));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const center=model.bounds.min.map((n,i)=>(n+model.bounds.max[i])/2),radius=Math.max(.01,Math.hypot(...model.bounds.max.map((n,i)=>(n-model.bounds.min[i])/2))),distance=radius/Math.sin(Math.PI/8)*Math.max(1,h/w)*1.15/this.zoom,pitch=model.kind==='image'?0:.2,eye=[center[0]+Math.sin(this.angle)*distance*Math.cos(pitch),center[1]+Math.sin(pitch)*distance,center[2]+Math.cos(this.angle)*distance*Math.cos(pitch)],forward=unit(center.map((n,i)=>n-eye[i])),right=unit(cross(forward,[0,1,0])),up=cross(right,forward),view=[right[0],up[0],-forward[0],0,right[1],up[1],-forward[1],0,right[2],up[2],-forward[2],0,-dot(right,eye),-dot(up,eye),dot(forward,eye),1],near=radius*.001,far=radius*20,f=1/Math.tan(Math.PI/8),projection=[f/(w/h),0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];
    gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);this.renderer.draw(multiplyMatrix(projection,view));
  }
  pixels(){const gl=this.gl,data=new Uint8Array(this.canvas.width*this.canvas.height*4);gl.readPixels(0,0,this.canvas.width,this.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);let visible=0;for(let i=3;i<data.length;i+=4)if(data[i])visible++;return {visible,total:data.length/4,error:gl.getError()};}
  dispose(){this.observer.disconnect();this.renderer.dispose();}
}
