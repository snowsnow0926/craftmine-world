// Rebuild source inventory and declarative scenes from the selected original GLBs.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const root=path.resolve('desktop/godot/components/curated-starter'),sourceDirectory=process.argv[2];
assert.ok(sourceDirectory&&path.isAbsolute(sourceDirectory),'Pass the absolute directory containing the two original Kenney ZIPs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources={nature:{name:'Kenney Nature Kit',version:'2.1',url:'https://kenney.nl/assets/nature-kit',archive:'kenney_nature-kit.zip',prefix:'Models/GLTF format/'},castle:{name:'Kenney Castle Kit',version:'2.0',url:'https://kenney.nl/assets/castle-kit',archive:'kenney_castle-kit.zip',prefix:'Models/GLB format/'}};
const choices=[
 ['nature','tree_oak','tree-oak','橡树',['树木','阔叶','自然'],4,false],
 ['nature','tree_detailed','tree-detailed','繁茂阔叶树',['树木','阔叶','自然'],4,false],
 ['nature','tree_pineRoundA','tree-pine','圆冠松树',['树木','针叶','自然'],4,false],
 ['nature','grass','grass','草丛',['草地','地表点缀'],2,false],
 ['nature','flower_redA','flower-red','红色花丛',['花','地表点缀'],2,false],
 ['nature','plant_bushDetailed','bush','浓密灌木',['灌木','地表点缀'],2,false],
 ['nature','rock_smallA','rock','小型岩石',['岩石','自然'],3,true],
 ['nature','bridge_wood','bridge-wood','木桥',['桥','道路','静态地形'],3,true],
 ['nature','fence_simple','fence-wood','木围栏',['围栏','边界','静态地形'],3,true],
 ['castle','wall','wall','城墙直段',['城墙','模块','静态地形'],3,true],
 ['castle','wall-corner','wall-corner','城墙转角',['城墙','转角','模块'],3,true],
 ['castle','wall-doorway','wall-doorway','城墙门洞',['城墙','通道','模块'],3,true],
 ['castle','door','door','木门静态模型',['门','装饰','静态模型'],3,true],
 ['castle','tower-square-base','tower-base','方塔基座',['塔楼','基座','模块'],3,true],
 ['castle','tower-square-mid','tower-mid','方塔中段',['塔楼','中段','模块'],3,true],
 ['castle','tower-square-top','tower-top','方塔垛口',['塔楼','顶部','模块'],3,true],
];
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const mul=(a,b)=>Array.from({length:16},(_,i)=>{const col=Math.floor(i/4),row=i%4;return a[row]*b[col*4]+a[4+row]*b[col*4+1]+a[8+row]*b[col*4+2]+a[12+row]*b[col*4+3];});
const point=(m,v)=>[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
function matrix(n){if(n.matrix)return n.matrix;const [x,y,z,w]=n.rotation??[0,0,0,1],[sx,sy,sz]=n.scale??[1,1,1],[tx,ty,tz]=n.translation??[0,0,0];return [(1-2*y*y-2*z*z)*sx,(2*x*y+2*w*z)*sx,(2*x*z-2*w*y)*sx,0,(2*x*y-2*w*z)*sy,(1-2*x*x-2*z*z)*sy,(2*y*z+2*w*x)*sy,0,(2*x*z+2*w*y)*sz,(2*y*z-2*w*x)*sz,(1-2*x*x-2*y*y)*sz,0,tx,ty,tz,1];}
function inspectGLB(bytes){
 assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
 let json,bin;for(let offset=12;offset<bytes.length;){const size=bytes.readUInt32LE(offset),kind=bytes.readUInt32LE(offset+4),data=bytes.subarray(offset+8,offset+8+size);assert.equal(data.length,size);if(kind===0x4e4f534a)json=JSON.parse(data.toString());else if(kind===0x004e4942)bin=data;else throw Error('Unexpected GLB chunk');offset+=8+size;}
 assert.ok(json&&bin);assert.ok(!json.animations?.length&&!json.skins?.length,'Static assets only');
 assert.ok(json.buffers?.length===1&&!json.buffers[0].uri&&json.buffers[0].byteLength<=bin.length,'Embedded geometry required');
 const externals=(json.images??[]).filter(image=>image.uri).map(image=>image.uri);
 assert.ok(externals.every(uri=>uri==='Textures/colormap.png'),'Unexpected external dependency');
 function accessor(index){const a=json.accessors[index],v=json.bufferViews[a.bufferView],size={5121:1,5123:2,5125:4,5126:4}[a.componentType],count={SCALAR:1,VEC3:3}[a.type];assert.ok(!a.sparse&&v.buffer===0&&size&&count);const stride=v.byteStride??size*count,start=(v.byteOffset??0)+(a.byteOffset??0);assert.ok(start+(a.count-1)*stride+size*count<=bin.length);return Array.from({length:a.count},(_,i)=>Array.from({length:count},(_,j)=>{const at=start+i*stride+j*size;return a.componentType===5126?bin.readFloatLE(at):a.componentType===5125?bin.readUInt32LE(at):a.componentType===5123?bin.readUInt16LE(at):bin.readUInt8(at);}));}
 const faces=[],seen=new Set();let meshInstances=0,primitives=0;
 function visit(index,parent){assert.ok(!seen.has(index),'GLB scene must be a tree');seen.add(index);const n=json.nodes[index],transform=mul(parent,matrix(n));assert.ok(!n.skin);if(n.mesh!==undefined){meshInstances++;for(const p of json.meshes[n.mesh].primitives){assert.ok((p.mode??4)===4&&!p.targets);primitives++;const positions=accessor(p.attributes.POSITION),indices=p.indices===undefined?positions.map((_,i)=>i):accessor(p.indices).map(row=>row[0]);assert.equal(indices.length%3,0);for(const i of indices){assert.ok(Number.isSafeInteger(i)&&positions[i]);const value=point(transform,positions[i]);assert.ok(value.every(Number.isFinite));faces.push(value);}}}for(const child of n.children??[])visit(child,transform);}
 const scene=json.scenes[json.scene??0];assert.ok(scene?.nodes?.length);for(const node of scene.nodes)visit(node,identity);
 const min=[0,1,2].map(axis=>Math.min(...faces.map(v=>v[axis]))),max=[0,1,2].map(axis=>Math.max(...faces.map(v=>v[axis])));
 return {faces,min,max,externalDependencies:externals,declaredNodes:json.nodes.length,activeNodes:seen.size,meshInstances,primitives,triangles:faces.length/3,materials:json.materials?.length??0,animations:0,skins:0,extensions:json.extensionsUsed??[]};
}
const write=(relative,text)=>{fs.mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});fs.writeFileSync(path.join(root,relative),text);};
const identityScript='extends Node3D\n\n## Instance identity only; this static asset has no gameplay behavior.\n@export var entity_id: String = ""\n';
const number=value=>String(Math.abs(value)<0.0000005?0:Number(value.toFixed(6)));
const items=[];
for(const [group,name,slug,label,tags,scale,solid] of choices){
 const id='cw.'+group+'.'+slug,sourcePath='models/'+group+'/'+name+'.glb',bytes=fs.readFileSync(path.join(root,sourcePath)),mesh=inspectGLB(bytes);
 const scriptPath='scripts/'+id+'.gd';write(scriptPath,identityScript);assert.ok(/^uid:\/\/[a-z0-9]+\s*$/.test(fs.readFileSync(path.join(root,scriptPath+'.uid'),'utf8')),'Retain the distinct engine-created script UID');
 const importPath=sourcePath+'.import';write(importPath,'[remap]\nimporter="scene"\nimporter_version=1\ntype="PackedScene"\n\n[params]\nmeshes/generate_lods=false\n');
 const size=mesh.max.map((v,i)=>v-mesh.min[i]),offset=[-(mesh.min[0]+mesh.max[0])/2,-mesh.min[1],-(mesh.min[2]+mesh.max[2])/2].map(v=>v*scale);
 const entryScene='scenes/'+id+'.tscn',visualScene=solid?'scenes/'+id+'-visual.tscn':entryScene;
 const resources=`[ext_resource type="Script" path="res://addons/${id}/${scriptPath}" id="1"]\n[ext_resource type="PackedScene" path="res://addons/${id}/${sourcePath}" id="2"]\n`;
 const nodes=`[node name="Component" type="Node3D"]\nscript = ExtResource("1")\n\n[node name="Visual" parent="." instance=ExtResource("2")]\nposition = Vector3(${offset.map(number).join(', ')})\nscale = Vector3(${scale}, ${scale}, ${scale})\n`;
 write(visualScene,'[gd_scene load_steps=3 format=3]\n\n'+resources+'\n'+nodes);
 if(solid){const data=mesh.faces.flatMap(v=>v.map((n,i)=>n*scale+offset[i])).map(number).join(', ');write(entryScene,'[gd_scene load_steps=4 format=3]\n\n'+resources+'\n[sub_resource type="ConcavePolygonShape3D" id="Shape"]\ndata = PackedVector3Array('+data+')\nbackface_collision = true\n\n'+nodes+'\n[node name="StaticCollision" type="StaticBody3D" parent="."]\ncollision_layer = 1\ncollision_mask = 0\n\n[node name="Shape" type="CollisionShape3D" parent="StaticCollision"]\nshape = SubResource("Shape")\n');}
 const relatives=[sourcePath,importPath,scriptPath,scriptPath+'.uid',entryScene,...(solid?[visualScene]:[]),'licenses/kenney-'+group+'-License.txt','licenses/CRAFTMINE_WRAPPERS_MIT.txt',...mesh.externalDependencies.map(uri=>'models/'+group+'/'+uri)];
 const files=relatives.map(file=>{const data=fs.readFileSync(path.join(root,file));return {path:file,bytes:data.length,sha256:hash(data)};});
 items.push({id,label,tags,kind:'object',version:'1.0.0',source:group,sourcePath:sources[group].prefix+name+'.glb',sourceFile:sourcePath,sourceSha256:hash(bytes),entryScene,visualScene,files,importConfiguration:{path:importPath,format:'godot-scene-import',parameters:{'meshes/generate_lods':false},sourceGlbUnchanged:true,cacheTargetsIncluded:false},usage:solid?'静态场景结构；可选无碰撞visual场景。不是可开关门、机关或战斗角色。':'静态自然装饰，可通过；没有采集、成长或战斗行为。',placement:{units:'metres',scale,anchor:'bottom-center',dimensionsMm:size.map(v=>Math.round(v*scale*1000)),visualOffsetMm:offset.map(v=>Math.round(v*1000)),sourceBounds:{min:mesh.min,max:mesh.max},notes:group==='castle'?'模块原模型轴向保留；平移、旋转后拼接。门洞不被包围盒封死。':'接地高度已在包装场景修正，原GLB字节未变。'},geometry:{declaredNodes:mesh.declaredNodes,activeNodes:mesh.activeNodes,primitives:mesh.primitives,meshInstances:mesh.meshInstances,triangles:mesh.triangles,materials:mesh.materials,animations:0,skins:0},dependencies:{selfContained:mesh.externalDependencies.length===0,external:mesh.externalDependencies,extensions:mesh.extensions},collision:{mode:solid?'static-trimesh':'none',visualOnlyScene:visualScene,triangles:solid?mesh.triangles:0,notes:solid?'仅静态关卡使用，碰撞由原三角形变换后生成；不用于动态刚体。':'草木装饰不阻挡玩家，未添加粗略整冠碰撞。'}});
}
const sourceRecords=Object.fromEntries(Object.entries(sources).map(([id,source])=>{const bytes=fs.readFileSync(path.join(sourceDirectory,source.archive)),licenseFile='licenses/kenney-'+id+'-License.txt';return [id,{...source,archiveBytes:bytes.length,archiveSha256:hash(bytes),license:'CC0-1.0',licenseFile,licenseSha256:hash(fs.readFileSync(path.join(root,licenseFile)))}];}));
const uniqueFiles=[...new Map(items.flatMap(item=>item.files).map(file=>[file.path,file])).values()];
const manifest={format:'craftmine.curated-source-manifest/1',id:'curated-starter',version:'1.0.0',purpose:'内部精选原始素材清单，供既有 packStaticPackage 使用；不是新公共包格式。',sources:sourceRecords,items,totals:{items:items.length,files:uniqueFiles.length,sourceGlbBytes:items.reduce((n,i)=>n+i.files.find(f=>f.path===i.sourceFile).bytes,0),uniquePayloadBytes:uniqueFiles.reduce((n,f)=>n+f.bytes,0),triangles:items.reduce((n,i)=>n+i.geometry.triangles,0)},limits:['静态素材，不含机关/AI/战斗功能。','ArrayMesh在当前普通对象拾取器中尚有覆盖限制，不宣称精准选择已通过。','尺寸来自原始三角形与节点变换，接地/碰撞仍须引擎验证。']};
write('manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({root,...manifest.totals,dimensions:items.map(i=>({id:i.id,mm:i.placement.dimensionsMm,triangles:i.geometry.triangles}))},null,2));
