// Reviewed composition of existing static assets; never a runtime/model tool.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(repository,'desktop/godot/components/curated-starter'),target=path.join(repository,'desktop/godot/components/forest-gateway'),id='cw.scene.forest-gateway';
const upstream=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),hash=b=>createHash('sha256').update(b).digest('hex');
const choices=['cw.nature.tree-oak','cw.nature.tree-pine','cw.nature.grass','cw.nature.flower-red','cw.nature.bush','cw.nature.rock','cw.castle.wall-doorway'];
const selected=choices.map(id=>upstream.items.find(item=>item.id===id));assert.ok(selected.every(Boolean));
const write=(name,text)=>{const file=path.join(target,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const copied=new Map();
for(const item of selected){
 for(const file of item.files.filter(file=>file.path.startsWith('models/')||file.path.startsWith('licenses/'))){const bytes=fs.readFileSync(path.join(source,file.path));assert.equal(hash(bytes),file.sha256);assert.equal(bytes.length,file.bytes);write(file.path,bytes);copied.set(file.path,{path:file.path,bytes:file.bytes,sha256:file.sha256});}
 const slug=item.id.split('.').at(-1);
 let scene=fs.readFileSync(path.join(source,item.entryScene),'utf8').replace(/\r\n/g,'\n');
 scene=scene.replace(/^\[ext_resource type="Script"[^\n]+\n/m,'').replace(/^script = ExtResource\("1"\)\n/m,'').replace(/load_steps=(\d+)/,(_,n)=>'load_steps='+(Number(n)-1)).replaceAll('res://addons/'+item.id+'/','res://addons/'+id+'/');
 write('parts/'+slug+'.tscn',scene);
}
const placements=[];
const add=(name,asset,group,x,z,scale=1,yaw=0)=>placements.push({name,asset,group,position:[x,0,z],scale,yawDegrees:yaw});
add('OakFrontLeft','tree-oak','Trees',-4.3,4.2,1.15,24);
add('PineFrontRight','tree-pine','Trees',4.5,3.4,1.22,-18);
add('OakMiddleLeft','tree-oak','Trees',-3.8,-1.5,.95,-36);
add('OakMiddleRight','tree-oak','Trees',4.2,-1.8,1.03,62);
add('PineBackLeft','tree-pine','Trees',-4.5,-6,1.15,16);
add('OakBackRight','tree-oak','Trees',3.4,-6.5,1.1,-24);
add('PineFarLeft','tree-pine','Trees',-2.5,-10,1.08,48);
add('OpenStoneGateway','wall-doorway','Gateway',0,0,1.5,90);
const grasses=[[-2.5,5.3,.95,20],[-3.1,4.7,.8,85],[-2.6,3.6,1.1,150],[-3.6,2.8,.85,215],[-2.2,2.2,.75,44],[-2.5,.8,.8,120],[-3.4,-2.1,.95,250],[-2.2,-3.1,.8,35],[-3.3,-4.4,1.1,75],[-2.3,-6,.85,180],[-4.2,-6.8,.9,280],[2.1,5.6,.85,310],[3,4.8,1.05,12],[2.4,3.5,.8,96],[3.7,2.4,.95,177],[2.1,1.9,.8,251],[2.4,-1.8,.85,60],[3.2,-2.8,1.05,132],[2,-3.8,.8,203],[3.4,-4.9,.9,271],[2.3,-6.7,1,30],[3.8,-7.8,.85,114]];
grasses.forEach(([x,z,s,r],i)=>add('Grass'+String(i+1).padStart(2,'0'),'grass','GroundCover',x,z,s,r));
const flowers=[[-2.1,4.8,.9],[-2.6,4.3,1.1],[-1.9,2.9,.85],[-2.5,-2,.95],[-2.1,-4.1,1.1],[1.9,5.2,1],[2.3,4.7,.85],[2,2.7,1.1],[2.3,-2.8,1],[2,-5.7,.9]];
flowers.forEach(([x,z,s],i)=>add('Flower'+String(i+1).padStart(2,'0'),'flower-red','GroundCover',x,z,s,i*37));
[[-4.7,2.7,1.1],[4.2,1.2,.95],[-4.6,-4.3,1],[4,-6.5,1.15]].forEach(([x,z,s],i)=>add('Bush'+(i+1),'bush','Shrubs',x,z,s,i*67));
[[-2.25,5.2,1],[2.7,4.3,.8],[-2.9,-3.6,1.2],[2.7,-5.2,1.1]].forEach(([x,z,s],i)=>add('Rock'+(i+1),'rock','Rocks',x,z,s,i*53));
// Pinned engine transformed mesh bounds determine this composition's bottom center.
const originOffset=[-0.0656027794,0,2.8334188461];
for(const item of placements)item.position=item.position.map((n,axis)=>Number((n+originOffset[axis]).toFixed(8)));
const scripts='scripts/forest_gateway.gd';write(scripts,'extends Node3D\n\n## Identity only. This is a designed static scene, not generated gameplay.\n@export var entity_id: String = ""\n');
let scene='[gd_scene load_steps=9 format=3]\n\n[ext_resource type="Script" path="res://addons/'+id+'/'+scripts+'" id="identity"]\n';
for(const item of selected){const slug=item.id.split('.').at(-1);scene+='[ext_resource type="PackedScene" path="res://addons/'+id+'/parts/'+slug+'.tscn" id="'+slug+'"]\n';}
scene+='\n[node name="ForestGateway" type="Node3D"]\nscript = ExtResource("identity")\n';
for(const group of ['Trees','Gateway','GroundCover','Shrubs','Rocks']){
 scene+='\n[node name="'+group+'" type="Node3D" parent="."]\n';
 for(const item of placements.filter(item=>item.group===group))scene+='\n[node name="'+item.name+'" parent="'+group+'" instance=ExtResource("'+item.asset+'")]\nposition = Vector3('+item.position.join(', ')+')\nrotation_degrees = Vector3(0, '+item.yawDegrees+', 0)\nscale = Vector3('+[item.scale,item.scale,item.scale].join(', ')+')\n';
}
write('scenes/forest_gateway.tscn',scene);write('layout.json',JSON.stringify({format:'craftmine.authored-scene-layout/1',id,forward:[0,0,-1],placements},null,2)+'\n');
write('.gitattributes','* -text\n');
const files=[];const walk=(dir,rel='')=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const name=rel+item.name;if(item.isDirectory())walk(path.join(dir,item.name),name+'/');else if(!['component.json','.gitattributes'].includes(name)){const bytes=fs.readFileSync(path.join(dir,item.name));files.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}}};walk(target);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
const count=asset=>placements.filter(item=>item.asset===asset).length,triangles=selected.reduce((n,item)=>n+item.geometry.triangles*count(item.id.split('.').at(-1)),0);
const manifest={format:'craftmine.godot-component/1',id,version:'1.0.0',kind:'scene',label:'林间入口',tags:['树林','入口','小径','静态预制场景'],entryScene:'scenes/forest_gateway.tscn',identityField:'entity_id',identityType:'String',engineVersion:'4.7.2-stable',renderer:'gl_compatibility',files,sources:upstream.sources,composition:{author:'Craftmine World contributors',license:'MIT',licenseFile:'licenses/CRAFTMINE_WRAPPERS_MIT.txt',designedPrefab:true,modelGenerated:false},sourceAssets:[...copied.values()],placement:{anchor:'bottom-center',dimensionsMm:[12807,6668,18374]},geometry:{meshInstances:placements.length,triangles,trees:7,treeSilhouettes:2,animations:0,skins:0},collision:{mode:'static-trimesh',triangles:564,scope:'doorframe-and-four-rocks'},sceneContract:{forward:[0,0,-1],gateCenter:originOffset,pathStart:[originOffset[0],0,6+originOffset[2]],pathEnd:[originOffset[0],0,-8+originOffset[2]],recommendedCamera:[originOffset[0],2,9+originOffset[2]],recommendedLookAt:[originOffset[0],2,-1+originOffset[2]],approachClearWidth:2.4,gateClearWidth:1.4,gateFacing:'opening faces local +Z / -Z',groundIncluded:false,lightingIncluded:false},recommendedLighting:'cw.environment.natural-daylight',usage:'设计好的林间入口静态场景；沿局部-Z进入，门洞保持可通过，树木与地被为装饰。不是模型自主作品，不含开关门、成长、敌人或任务行为。'};
write('component.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({directory:target,id,kind:manifest.kind,meshes:placements.length,triangles,files:files.length}));
