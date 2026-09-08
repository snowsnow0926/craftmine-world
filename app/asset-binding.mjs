import { exactKeys,bounded } from './gameplay.mjs';
import { identity,decodeAsset,fromBase64 } from './asset-decode.mjs';
export const WORLD_ASSET_LIMITS={assets:16,bytes:32*1024*1024,triangles:200000,draws:256,texturePixels:16*1024*1024};
export const assetKey=ref=>ref.id+'@'+ref.version;
export function validateAssetReference(ref){
  exactKeys(ref,['id','version','hash']);
  if(typeof ref.id!=='string'||!/^asset-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(ref.id)||!Number.isInteger(ref.version)||ref.version<1||ref.version>100000||typeof ref.hash!=='string'||!/^([a-f0-9]{64})$/.test(ref.hash))throw Error('外观需要真实素材的固定版本和哈希');
}
export function validateAppearance(value){
  if(value===null)return;
  exactKeys(value,['asset','offset','size','rotationY','fit']);validateAssetReference(value.asset);
  for(const [key,min,max]of [['offset',-24,24],['size',.02,24]]){exactKeys(value[key],['x','y','z']);for(const n of Object.values(value[key]))bounded(n,min,max);}
  bounded(value.rotationY,-180,180);if(!['contain','stretch'].includes(value.fit))throw Error('外观适配方式无效');
}
export function appearanceBounds(object){
  const a=object.appearance;if(!a)return null;const angle=a.rotationY*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
  const half={x:(c*a.size.x+s*a.size.z)/2,y:a.size.y/2,z:(s*a.size.x+c*a.size.z)/2},center=Object.fromEntries(['x','y','z'].map(k=>[k,object.position[k]+a.offset[k]+a.size[k]/2]));
  return {min:Object.fromEntries(['x','y','z'].map(k=>[k,center[k]-half[k]])),max:Object.fromEntries(['x','y','z'].map(k=>[k,center[k]+half[k]]))};
}
export function checkAppearanceBounds(object){const b=appearanceBounds(object);if(b&&(b.min.x< -46||b.min.z< -46||b.min.y<5.99999||b.max.x>46||b.max.z>46||b.max.y>38))throw Error('素材外观超出世界边界');}
export function sceneAssetReferences(scene){
  const refs=new Map();for(const o of scene.objects)if(o.appearance){const ref=o.appearance.asset;validateAssetReference(ref);const key=assetKey(ref);if(refs.has(key)&&refs.get(key).hash!==ref.hash)throw Error('同一素材版本不能引用不同内容');refs.set(key,ref);}
  if(refs.size>WORLD_ASSET_LIMITS.assets)throw Error('世界最多使用 16 个不同素材版本');return [...refs.values()];
}
export function decodeWorldAssets(scene,assets){
  const refs=sceneAssetReferences(scene);if(!Array.isArray(assets)||assets.length!==refs.length)throw Error('世界素材不完整，请恢复对应版本的素材包');
  const decoded=new Map();let bytes=0,pixels=0,triangles=0,draws=0;
  for(const ref of refs){
    const asset=assets.find(a=>a.id===ref.id&&a.version===ref.version);if(!asset||asset.hash!==ref.hash)throw Error('世界素材版本或内容不匹配');
    const raw=fromBase64(asset.data);bytes+=raw.length;if(bytes>WORLD_ASSET_LIMITS.bytes)throw Error('世界素材超过 32 MB 原始文件预算');
    const model=decodeAsset(raw,asset.mime),images=model.kind==='image'?[model]:model.images;pixels+=images.reduce((n,i)=>n+i.width*i.height,0);if(pixels>WORLD_ASSET_LIMITS.texturePixels)throw Error('世界素材纹理超过 16M 像素预算');
    decoded.set(assetKey(ref),{asset,model});
  }
  for(const object of scene.objects)if(object.appearance){const {model}=decoded.get(assetKey(object.appearance.asset));triangles+=model.kind==='image'?2:model.triangles;draws+=model.kind==='image'?1:model.draws.length;}
  if(triangles>WORLD_ASSET_LIMITS.triangles||draws>WORLD_ASSET_LIMITS.draws)throw Error('世界素材超过 200,000 个三角面或 256 次绘制预算');return decoded;
}
export function appearanceMatrix(object,bounds){
  const a=object.appearance,axes=['x','y','z'],span=bounds.max.map((n,i)=>n-bounds.min[i]),scales=span.map((n,i)=>n>1e-8?a.size[axes[i]]/n:Infinity),uniform=Math.min(...scales);
  if(!Number.isFinite(uniform)||uniform<=0)throw Error('素材没有可适配的几何尺寸');
  const scale=scales.map(n=>a.fit==='contain'||!Number.isFinite(n)?uniform:n),angle=a.rotationY*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),matrix=identity();
  matrix[0]=c*scale[0];matrix[2]=-s*scale[0];matrix[5]=scale[1];matrix[8]=s*scale[2];matrix[10]=c*scale[2];
  const center=bounds.min.map((n,i)=>(n+bounds.max[i])/2),destination=axes.map(k=>object.position[k]+a.offset[k]+a.size[k]/2);
  for(let i=0;i<3;i++)matrix[12+i]=destination[i]-matrix[i]*center[0]-matrix[4+i]*center[1]-matrix[8+i]*center[2];return matrix;
}
export function defaultAppearance(object,asset){
  const min={},max={};for(const k of ['x','y','z']){min[k]=Math.min(...object.parts.map(p=>p.offset[k]));max[k]=Math.max(...object.parts.map(p=>p.offset[k]+p.size[k]));}
  return {asset:{id:asset.id,version:asset.version,hash:asset.hash},offset:min,size:Object.fromEntries(['x','y','z'].map(k=>[k,Math.max(.02,max[k]-min[k])])),rotationY:0,fit:'contain'};
}
