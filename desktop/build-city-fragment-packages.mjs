import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packStaticPackage,unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {contentHash,validatePath} from '../plugins/craftmine-world/package-format.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(ok,code)=>{if(!ok)throw Error(code);};
export function buildCityFragmentPackages({repository}){
 const root=path.join(repository,'desktop/godot/components/city-fragments'),inventory=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 check(inventory.format==='craftmine.city-fragments/1'&&inventory.entries.length===3,'CITY_FRAGMENT_INVENTORY_INVALID');
 return inventory.entries.map(item=>{
  check(/^[a-z-]+$/.test(item.slug)&&/^cw\.city\.[a-z-]+$/.test(item.id),'CITY_FRAGMENT_ID_INVALID');const directory=path.join(root,item.slug),manifestBytes=fs.readFileSync(path.join(directory,'component.json'));
  check(sha(manifestBytes)===item.componentSha256,'CITY_FRAGMENT_MANIFEST_CHANGED');const m=JSON.parse(manifestBytes),files={};
  check(m.id===item.id&&m.version===1&&m.geometry.boundaryTrianglesExcluded===0,'CITY_FRAGMENT_GEOMETRY_INVALID');
  for(const file of m.files){validatePath(file.path);const filename=path.join(directory,file.path);check(fs.lstatSync(filename).isFile()&&!fs.lstatSync(filename).isSymbolicLink(),'CITY_FRAGMENT_FILE_INVALID');const bytes=fs.readFileSync(filename);check(bytes.length===file.bytes&&sha(bytes)===file.sha256,'CITY_FRAGMENT_FILE_CHANGED');files[file.path]=bytes;}
  check(Object.values(files).reduce((sum,b)=>sum+b.length,0)<=4*1024*1024,'CITY_FRAGMENT_TOO_LARGE');
  for(const source of m.source.sources){const file=path.join(repository,m.source.sourceTemplate,'assets/blender',source.file);check(sha(fs.readFileSync(file))===source.sourceSha256,'CITY_FRAGMENT_ORIGINAL_CHANGED');}
  const content={assetId:m.id,version:1,kind:m.kind,files:m.files,dependencies:[],entry:{entities:['fragment'],label:m.label,aliases:m.aliases,description:'Reusable static fragment extracted from the accepted canyon city. Includes authored geometry, material shader and triangle collision; preserves the receiving world. No guards, quests, weather, camera or player replacement.',capabilities:m.capabilities,sceneInstall:{mode:'instance',sceneFile:'fragment.tscn',identityField:'entity_id',identityType:'String'},placement:{anchor:'ground-at-source-anchor',dimensionsMm:m.geometry.dimensionsMm,sourceAnchorMm:m.anchor.map(v=>v*1000)},geometry:{meshInstances:m.geometry.meshInstances,triangles:m.geometry.triangles,collisionTriangles:m.geometry.collisionTriangles,buildings:m.buildings,animations:0,skins:0,sourceTriangleSubset:true},ground:m.ground,route:{kind:m.route.kind,startMm:m.route.start.map(v=>v*1000),endMm:m.route.end.map(v=>v*1000)},sourceRequirements:[],lineage:{...m.source,sources:m.source.sources.map(({boxes,...source})=>({...source,boxesMm:boxes.map(box=>({min:box.min.map(v=>Math.round(v*1000)),max:box.max.map(v=>Math.round(v*1000))}))}))}},interfaces:{},compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},state:{kind:'static-component-no-player-state',identity:'entity_id',progress:'receiving-world-player-progress'},licenses:{status:'source-declared-unverified',declarationFile:'ORIGINAL_ASSETS_LICENSE.txt',provenanceFile:'provenance.json',claim:'Original source contains an MIT declaration; generated reference-derived geometry rights are not independently verified'}};
  if(m.preview)content.entry.preview=m.preview;
  if(m.navigation)content.entry.navigation=m.navigation;
  const rootContentHash=contentHash(content),bytes=packStaticPackage({root:{id:m.id,version:1},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:rootContentHash},files}]});check(bytes.length<=5*1024*1024,'CITY_FRAGMENT_ZIP_TOO_LARGE');unpackStaticPackage(bytes);
  const preview=m.preview?{file:m.id+'.png',bytes:files['preview.png']}:null;
  if(preview)check(preview.bytes.length<=512*1024,'CITY_FRAGMENT_PREVIEW_TOO_LARGE');
  const file=m.id+'.zip';return {file,bytes,...(preview?{preview}:{}),entry:{assetId:m.id,version:1,kind:m.kind,file,bytes:bytes.length,sha256:sha(bytes),rootContentHash,label:m.label,tags:['builtin','prefab','reusable-world-content','city-fragment','approved-demo',...m.tags,...m.aliases],...(preview?{preview:{file:preview.file,bytes:preview.bytes.length,sha256:sha(preview.bytes),scope:'component-view'}}:{}),source:{origin:'Craftmine approved canyon city static fragment / 1',author:'Craftmine World player / Codex-authored source',license:'Source-declared MIT; generated/reference rights unverified',licenseStatus:'unverified'}}};
 });
}
