import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGLB,decodeAsset,fromBase64,imageInfo,ASSET_LIMITS } from '../app/asset-decode.mjs';
import { triangleFixture,packGLB,png } from './asset-fixtures.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../app/store.mjs';
import { validateAsset } from '../app/assets.mjs';
test('GLB 实际索引网格、节点层级、负缩放和非均匀缩放保留几何与朝向',()=>{
  const f=triangleFixture();f.json.nodes=[{translation:[2,3,4],children:[1]},{mesh:0,scale:[-2,3,1]}];
  const model=decodeGLB(f.bytes());assert.equal(model.triangles,1);assert.deepEqual(model.bounds,{min:[1,3,4],max:[3,6,4]});assert.deepEqual(Array.from(model.draws[0].vertices.slice(3,6)),[0,0,1]);
});
test('交错顶点、内嵌贴图、UV 和颜色从 GLB 原数据读取',()=>{
  const model=decodeGLB(triangleFixture({texture:true,interleaved:true}).bytes());assert.equal(model.images[0].width,4);assert.equal(model.materials[0].texture.image,0);assert.deepEqual(Array.from(model.draws[0].vertices.slice(6,8)),[0,1]);assert.equal(model.draws[0].vertices.length,36);
});
test('三角带和三角扇转换保持一致的面朝向，归一化顶点颜色正确展开',()=>{
  for(const mode of [5,6]){
    const f=triangleFixture(),points=mode===5?[-1,0,0,1,0,0,-1,1,0,1,1,0]:[-1,0,0,1,0,0,1,1,0,-1,1,0],bin=Buffer.alloc(48);points.forEach((n,i)=>bin.writeFloatLE(n,i*4));
    f.json.bufferViews=[{buffer:0,byteOffset:0,byteLength:48}];f.json.accessors=[{bufferView:0,componentType:5126,count:4,type:'VEC3'}];f.json.meshes[0].primitives[0]={attributes:{POSITION:0},mode};const model=decodeGLB(packGLB(f.json,bin));assert.equal(model.triangles,2);for(let i=5;i<model.draws[0].vertices.length;i+=12)assert.equal(model.draws[0].vertices[i],1);
  }
  const f=triangleFixture(),bin=Buffer.alloc(56);f.bin.copy(bin);Buffer.from([255,0,0,255,0,255,0,128,0,0,255,255]).copy(bin,44);f.json.bufferViews.push({buffer:0,byteOffset:44,byteLength:12});f.json.accessors.push({bufferView:2,componentType:5121,normalized:true,count:3,type:'VEC4'});f.json.meshes[0].primitives[0].attributes.COLOR_0=2;
  const model=decodeGLB(packGLB(f.json,bin));assert.deepEqual([...model.draws[0].vertices.slice(8,12)],[1,0,0,1]);assert.ok(Math.abs(model.draws[0].vertices[23]-128/255)<1e-6);
});
test('稀疏访问器叠加到默认零数据，不接受重复或越界的稀疏索引',()=>{
  const f=triangleFixture(),indices=Buffer.from([0,1,2,0]),values=Buffer.from(f.bin.subarray(0,36));f.bin=Buffer.concat([indices,values]);f.json.bufferViews=[{buffer:0,byteOffset:0,byteLength:3},{buffer:0,byteOffset:4,byteLength:36}];f.json.accessors=[{componentType:5126,count:3,type:'VEC3',sparse:{count:3,indices:{bufferView:0,componentType:5121},values:{bufferView:1}}}];delete f.json.meshes[0].primitives[0].indices;
  assert.equal(decodeGLB(packGLB(f.json,f.bin)).triangles,1);f.bin[2]=1;assert.throws(()=>decodeGLB(packGLB(f.json,f.bin)),/严格递增/);
});
test('坏头、缓冲区越界、循环、外部文件和未支持的动画与压缩明确拒绝',()=>{
  const mutations=[f=>f.json.nodes[0].children=[0],f=>f.json.bufferViews[0].byteOffset=9000,f=>f.json.images=[{uri:'file:///C:/private.png'}],f=>f.json.images=[{uri:'https://example.com/private.png'}],f=>f.json.animations=[{}],f=>f.json.extensionsRequired=['KHR_draco_mesh_compression'],f=>f.json.meshes[0].primitives[0].material=1,f=>f.json.accessors[0].count=ASSET_LIMITS.vertices+1];
  for(const mutate of mutations){const f=triangleFixture();mutate(f);assert.throws(()=>decodeGLB(f.bytes()));}const bytes=triangleFixture().bytes();bytes[0]=0;assert.throws(()=>decodeGLB(bytes),/文件头/);
});
test('巨大计数在分配前拒绝，重复实例计算累计三角面预算',()=>{
  const f=triangleFixture();f.json.accessors[0].count=2**31;assert.throws(()=>decodeGLB(f.bytes()),/顶点数量/);
  const repeated=triangleFixture();repeated.json.nodes=Array.from({length:129},()=>({mesh:0}));repeated.json.scenes[0].nodes=repeated.json.nodes.map((_,i)=>i);assert.throws(()=>decodeGLB(repeated.bytes()),/子网格预算/);
});
test('图片格式与解压尺寸预检，过大文件和伪装图片不能进入导入流程',()=>{
  const bytes=png();assert.deepEqual(imageInfo(bytes),{mime:'image/png',width:4,height:4});assert.equal(decodeAsset(fromBase64(bytes.toString('base64')),'image/png').kind,'image');
  const large=Buffer.from(bytes);large.writeUInt32BE(60000,16);assert.throws(()=>imageInfo(large),/图片宽度/);assert.throws(()=>decodeAsset(bytes,'image/jpeg'),/声明/);assert.throws(()=>imageInfo(Buffer.from('<svg onload="alert(1)"></svg>')));assert.throws(()=>fromBase64('==='));assert.throws(()=>fromBase64('a'.repeat(Math.ceil(ASSET_LIMITS.bytes/3)*4+4)));
});
test('素材固定身份和版本，篡改及同版本冲突不能覆盖历史文件',()=>{
  fs.mkdirSync('test-results',{recursive:true});const store=new ProjectStore(fs.mkdtempSync(path.resolve('test-results/asset-unit-'))),library=store.assets,first=library.prepare(store.data,{id:null,baseVersion:null,name:'营地标记',filename:'camp.png',mime:'image/png',data:png().toString('base64')});store.change(d=>library.register(d,first));
  const second=library.prepare(store.data,{id:first.id,baseVersion:1,name:'营地标记',filename:'camp-v2.png',mime:'image/png',data:png(4,4,[235,91,48,255]).toString('base64')});store.change(d=>library.register(d,second));assert.equal(second.id,first.id);assert.equal(second.version,2);assert.deepEqual(library.read(store.data,first.id,1),first);
  const bad=structuredClone(first);bad.data=second.data;assert.throws(()=>validateAsset(bad),/哈希/);const conflict={...second,version:1};assert.throws(()=>store.change(d=>library.register(d,conflict)),/原版本未覆盖/);assert.deepEqual(library.read(store.data,first.id,1),first);
  const target=new ProjectStore(fs.mkdtempSync(path.resolve('test-results/asset-target-')));target.change(d=>target.assets.register(d,first));assert.deepEqual(target.assets.read(target.data,first.id,1),first);assert.equal(target.data.current,store.data.current);
  const bytes=fs.readFileSync(library.file(first.id,1),'utf8');fs.writeFileSync(library.file(first.id,1),bytes.replace(first.hash,'0'.repeat(64)));assert.throws(()=>library.read(store.data,first.id,1),/哈希/);assert.throws(()=>library.file('../../project',1),/身份/);
});
