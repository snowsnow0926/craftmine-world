// Fixed audited source adapter, not an installation registry. Output uses the
// existing package/resource format and sceneInstall contract.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {packStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../../plugins/craftmine-world/package-format.mjs';
export const CITY_COMMIT='4535092b740b378b700efd9df9e27a631815b84a';
export const CITY_MODELS={building:{path:'models/building-small-a.glb',sha256:'22ce989013bd16b1732e81798e343cf85f947e92b6c93825b18131feded48e07'},
  road:{path:'models/road-straight.glb',sha256:'008a6305de778439d1a99be78a3e0945c72a9bc9cc0bade1b51a666d5db01d0b'}};
const TEXTURE={path:'models/Textures/colormap.png',sha256:'106cf02e0d6dccded6d9f90c2ae6a51eb94c6301645fea159e834c44ed4708a3'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function buildKenneyCityPackage({sourceRoot,kind}){
  const selected=CITY_MODELS[kind];if(!selected)throw Error('KENNEY_MODULE_KIND_INVALID');
  const observed=execFileSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{windowsHide:true,encoding:'utf8'}).trim();
  if(observed!==CITY_COMMIT||execFileSync('git',['-C',sourceRoot,'status','--porcelain'],{windowsHide:true,encoding:'utf8'}).trim())throw Error('KENNEY_SOURCE_IDENTITY_CHANGED');
  const assetId='kenney-city-'+kind,files={};
  for(const input of [selected,TEXTURE]){const bytes=fs.readFileSync(path.join(sourceRoot,input.path));if(hash(bytes)!==input.sha256)throw Error('KENNEY_ASSET_HASH_MISMATCH');files[input.path]=bytes;}
  const glb=files[selected.path],json=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString('utf8'));
  if(glb.readUInt32LE(0)!==0x46546c67||glb.readUInt32LE(4)!==2||json.images?.length!==1||json.images[0].uri!=='Textures/colormap.png'||json.buffers?.some(item=>item.uri))throw Error('KENNEY_GLB_DEPENDENCIES_CHANGED');
  for(const name of ['LICENSE.md','README.md'])files['licenses/'+name]=fs.readFileSync(path.join(sourceRoot,name));
  const provenance={format:'craftmine.fixed-upstream-module/1',repository:'https://github.com/KenneyNL/Starter-Kit-City-Builder',commit:CITY_COMMIT,
    assets:[selected,TEXTURE],assetLicense:'CC0-1.0 (upstream README declaration)',codeLicense:'MIT',fontIncluded:false,
    adaptation:'Host-authored StaticBody3D wrapper and triangle-mesh collision; no upstream game scripts, sample map or font included'};
  files['provenance.json']=Buffer.from(JSON.stringify(provenance,null,2)+'\n');
  files['attribution.json']=Buffer.from(JSON.stringify({format:'craftmine.resource-attribution/1',
    source:{repository:provenance.repository,commit:CITY_COMMIT},
    licenses:{code:{spdx:'MIT',text:'res://addons/'+assetId+'/licenses/LICENSE.md'},
      assets:{spdx:'CC0-1.0',declaration:'res://addons/'+assetId+'/licenses/README.md'}},
    provenance:'res://addons/'+assetId+'/provenance.json'},null,2)+'\n');
  const template=fs.readFileSync(new URL('../fixtures/kenney-city-module.gd',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  files['module.gd']=Buffer.from(template.replaceAll('__ASSET_ID__',assetId).replaceAll('__KIND__',kind));
  files['module.gd.uid']=Buffer.from('uid://b'+hash(assetId+'/module.gd').slice(0,11)+'\n');
  files['module.tscn']=Buffer.from(`[gd_scene load_steps=3 format=3]\n\n[ext_resource type="Script" path="res://addons/${assetId}/module.gd" id="1"]\n[ext_resource type="PackedScene" path="res://addons/${assetId}/${selected.path}" id="2"]\n\n[node name="KenneyModule" type="StaticBody3D"]\nscript = ExtResource("1")\ncollision_layer = 2\ncollision_mask = 0\nmetadata/craftmine_attribution = "res://addons/${assetId}/attribution.json"\n\n[node name="Visual" parent="." instance=ExtResource("2")]\n`);
  const content={assetId,version:1,kind:'object',files:Object.entries(files).map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)})),dependencies:[],
    entry:{entities:[kind],sceneInstall:{mode:'instance',sceneFile:'module.tscn',identityField:'entity_id',identityType:'string',exports:{model_scale_percent:100,quarter_turns:0,solid:true,label:kind}}},
    interfaces:{parameters:{model_scale_percent:{type:'integer',minimum:25,maximum:800},quarter_turns:{type:'integer',minimum:0,maximum:3},solid:{type:'boolean'},label:{type:'string',maxLength:80}}},
    compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},state:{},
    licenses:{code:{spdx:'MIT',path:'licenses/LICENSE.md'},assets:{spdx:'CC0-1.0',declaration:'licenses/README.md'},provenance:'provenance.json'}};
  const manifest={format:'craftmine.resource/1',content,contentHash:contentHash(content)};
  const archive=packStaticPackage({root:{id:assetId,version:1},resources:[{manifest,files}]});
  return {assetId,archive,archiveSha256:hash(archive),manifest,provenance};
}
