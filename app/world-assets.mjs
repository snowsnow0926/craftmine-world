import { AssetRenderer } from './asset-renderer.mjs';
import { assetKey,appearanceMatrix,decodeWorldAssets } from './asset-binding.mjs';
export class WorldAssets {
  constructor(engine){this.engine=engine;this.renderers=new Map();this.disposed=false;}
  async load(build){
    const decoded=decodeWorldAssets(build.scene,build.assets||[]);if(!decoded.size)return;
    if(this.engine.software)throw Error('此世界的图片或 3D 素材需要 WebGL，已保留原世界');
    try{for(const [key,{model}]of decoded){
      if(this.disposed)throw Error('世界已关闭');const renderer=new AssetRenderer(this.engine.gl);this.renderers.set(key,renderer);await renderer.load(model);
    }}catch(error){this.dispose();throw error;}
  }
  mesh(object){if(!object.appearance)return null;const renderer=this.renderers.get(assetKey(object.appearance.asset));if(!renderer)throw Error('对象素材未载入');return {asset:true,renderer,matrix:appearanceMatrix(object,renderer.model.bounds),center:['x','y','z'].map(k=>object.position[k]+object.appearance.offset[k]+object.appearance.size[k]/2),tint:object.appearanceTint||null};}
  drawAll(meshes){
    for(const mesh of meshes)this.draw(mesh,'opaque');const p=this.engine.p,distance=mesh=>Math.hypot(mesh.center[0]-p.x,mesh.center[1]-p.y-1.56,mesh.center[2]-p.z);for(const mesh of [...meshes].sort((a,b)=>distance(b)-distance(a)))this.draw(mesh,'blend');
  }
  draw(mesh,alphaPass){
    const e=this.engine,gl=e.gl,vp=gl.getUniform(e.prog,e.locations.world.u.uVP);
    for(let i=0;i<8;i++)gl.disableVertexAttribArray(i);
    try{mesh.renderer.draw(vp,mesh.matrix,{night:e.night,tint:mesh.tint,alphaPass});}
    finally{for(let i=0;i<8;i++)gl.disableVertexAttribArray(i);gl.useProgram(e.prog);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,e.atlas);gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.frontFace(gl.CCW);gl.depthMask(true);gl.disable(gl.BLEND);}
  }
  dispose(){this.disposed=true;for(const renderer of this.renderers.values())renderer.dispose();this.renderers.clear();}
}
