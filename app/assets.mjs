import fs from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { canonicalJSON } from './canonical.mjs';
import { decodeAsset,fromBase64 } from './asset-decode.mjs';
import { sceneAssetReferences,decodeWorldAssets } from './asset-binding.mjs';
const ID=/^asset-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw Error('素材字段无效');};
const string=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('素材名称或文件名无效');};
const version=v=>{if(!Number.isInteger(v)||v<1||v>100000)throw Error('素材版本无效');};
export function assetContent(input){
  string(input.name,80);string(input.filename,160);if(/[\\/\x00-\x1f]/.test(input.filename))throw Error('素材文件名不能包含路径');if(!['image/png','image/jpeg','model/gltf-binary'].includes(input.mime))throw Error('请选择 PNG、JPEG 或 GLB 文件');
  const bytes=fromBase64(input.data),decoded=decodeAsset(bytes,input.mime),meta=decoded.kind==='model'?{triangles:decoded.triangles,images:decoded.images.length,bounds:decoded.bounds}:{width:decoded.width,height:decoded.height,bounds:decoded.bounds};
  const hash=createHash('sha256').update(canonicalJSON({name:input.name,filename:input.filename,mime:input.mime,kind:decoded.kind})).update(bytes).digest('hex');
  return {kind:decoded.kind,bytes:bytes.length,meta,hash};
}
export function validateAsset(input){
  exact(input,['format','id','version','name','filename','kind','mime','hash','bytes','meta','data','created']);if(input.format!=='craftmine.asset/1'||typeof input.id!=='string'||!ID.test(input.id))throw Error('素材包身份无效');version(input.version);if(!Number.isSafeInteger(input.created)||input.created<0)throw Error('素材时间无效');
  const checked=assetContent(input);for(const key of ['kind','bytes','meta','hash'])if(canonicalJSON(input[key])!==canonicalJSON(checked[key]))throw Error('素材内容、尺寸或哈希校验失败');return structuredClone(input);
}
export class AssetLibrary {
  constructor(root,write){this.root=path.join(root,'assets');this.write=write;}
  manifest(data,scene,text=''){
    const selected=sceneAssetReferences(scene),entries=[...(data.assets||[])].reverse().sort((a,b)=>Number(text.includes(b.name))-Number(text.includes(a.name)));
    for(const entry of entries){if(selected.length>=24)break;const record=entry.versions.find(v=>v.version===entry.latest);if(!selected.some(r=>r.id===entry.id&&r.version===record.version))selected.push({id:entry.id,version:record.version,hash:record.hash});}
    return selected.map(ref=>{const entry=data.assets.find(a=>a.id===ref.id),record=entry?.versions.find(v=>v.version===ref.version);if(!record||record.hash!==ref.hash)throw Error('当前外观素材索引不一致');return {...ref,name:record.name,kind:entry.kind,meta:record.meta};});
  }
  resolve(data,scene){const assets=sceneAssetReferences(scene).map(ref=>this.read(data,ref.id,ref.version));decodeWorldAssets(scene,assets);return assets;}
  file(id,v){if(typeof id!=='string'||!ID.test(id))throw Error('素材身份无效');version(v);return path.join(this.root,id,v+'.json');}
  read(data,id,v){
    const entry=(data.assets||[]).find(a=>a.id===id),record=entry?.versions.find(r=>r.version===v);if(!record)throw Error('素材版本不存在，请导入对应素材包');
    const file=this.file(id,v);if(!fs.existsSync(file))throw Error('素材文件缺失，请重新导入此版本');const asset=validateAsset(JSON.parse(fs.readFileSync(file,'utf8')));if(asset.id!==id||asset.version!==v||asset.hash!==record.hash)throw Error('素材文件与版本索引不一致');return asset;
  }
  prepare(data,input){
    if(input?.format!==undefined)return validateAsset(input);
    exact(input,['id','baseVersion','name','filename','mime','data']);const content=assetContent(input),entry=(data.assets||[]).find(a=>a.id===input.id);
    if(input.id!==null){if(!entry||input.baseVersion!==entry.latest)throw Error('素材版本已改变，请重新选择版本再导入');if(entry.kind!==content.kind)throw Error('同一素材的新版需保持图片或模型类别');}
    else if(input.baseVersion!==null)throw Error('新素材不能指定旧版本');
    const same=entry?.versions.find(r=>r.hash===content.hash);if(same)return this.read(data,entry.id,same.version);
    return {format:'craftmine.asset/1',id:entry?.id||'asset-'+randomUUID(),version:(entry?.latest||0)+1,name:input.name,filename:input.filename,mime:input.mime,...content,data:input.data,created:Date.now()};
  }
  preflight(data,assets){const trial=structuredClone(data);for(const asset of assets)this.register(trial,asset,{persist:false});}
  register(data,input,{persist=true}={}){
    const asset=validateAsset(input);data.assets??=[];let entry=data.assets.find(a=>a.id===asset.id),existing=entry?.versions.find(r=>r.version===asset.version);
    if(existing){if(existing.hash!==asset.hash)throw Error('同一素材版本存在不同内容，原版本未覆盖');const file=this.file(asset.id,asset.version);if(fs.existsSync(file))this.read(data,asset.id,asset.version);else if(persist)this.write(file,asset);return;}
    if(entry&&entry.kind!==asset.kind)throw Error('素材类别冲突');if(!entry&&data.assets.length>=256||entry?.versions.length>=64)throw Error('素材库已达到 256 项或单项 64 个版本的上限');
    const total=data.assets.reduce((sum,e)=>sum+e.versions.reduce((s,r)=>s+r.bytes,0),0);if(total+asset.bytes>512*1024*1024)throw Error('素材库已达到 512 MB 容量，请先导出整理');
    const file=this.file(asset.id,asset.version);if(fs.existsSync(file)){const prior=validateAsset(JSON.parse(fs.readFileSync(file,'utf8')));if(prior.hash!==asset.hash)throw Error('素材文件版本冲突，未覆盖原文件');}else if(persist)this.write(file,asset);
    if(!entry){entry={id:asset.id,kind:asset.kind,name:asset.name,latest:asset.version,versions:[]};data.assets.push(entry);}
    entry.versions.push({version:asset.version,hash:asset.hash,name:asset.name,filename:asset.filename,bytes:asset.bytes,meta:asset.meta,time:asset.created});entry.versions.sort((a,b)=>a.version-b.version);if(asset.version>=entry.latest){entry.latest=asset.version;entry.name=asset.name;}
  }
}
