import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../app/store.mjs';
import { EMPTY_SCENE, INITIAL_SNAPSHOT, compileScene, validateSnapshot, validateObjectScope, clone } from '../app/scene.mjs';

const tree=()=>({...clone(EMPTY_SCENE),objects:[{id:'tree-one',name:'第一棵树',position:{x:0,y:6,z:6},parts:[{offset:{x:0,y:0,z:0},size:{x:1,y:4,z:1},material:'wood'},{offset:{x:-1,y:3,z:-1},size:{x:3,y:3,z:3},material:'leaves'}]}]});
fs.mkdirSync('test-results/core',{recursive:true});
const project=()=>new ProjectStore(fs.mkdtempSync(path.resolve('test-results/core/project-')));

test('空白起点没有预置对象，编译结果确定',()=>{const b=compileScene(EMPTY_SCENE);assert.deepEqual(b.voxels,[]);assert.equal(b.hash,compileScene(clone(EMPTY_SCENE)).hash);});
test('选中对象的修改不能覆盖世界环境或其他对象',()=>{const before=tree(),after=tree();after.objects[0].parts[0].size.y=6;assert.doesNotThrow(()=>validateObjectScope(before,after,'tree-one'));after.night=true;assert.throws(()=>validateObjectScope(before,after,'tree-one'));assert.doesNotThrow(()=>validateObjectScope(before,after,null));});
test('通用长方体内容被编译为带对象身份的三维格子',()=>{const b=compileScene(tree());assert.equal(b.voxels.length,30);assert.ok(b.voxels.every(v=>v[4]==='tree-one'));});
test('拒绝脚本、未知字段和不支持的材质',()=>{assert.throws(()=>compileScene({...tree(),script:'alert(1)'}));const s=tree();s.objects[0].parts[0].material='__proto__';assert.throws(()=>compileScene(s));});
test('拒绝重复对象身份、跨对象覆盖和超出地面的内容',()=>{const s=tree();s.objects.push(clone(s.objects[0]));assert.throws(()=>compileScene(s));s.objects[1].id='other';assert.throws(()=>compileScene(s),/重叠/);const out=tree();out.objects[0].position.y=5;assert.throws(()=>compileScene(out),/超出/);});
test('限制生成资源规模和进度格式',()=>{const s=tree();s.objects[0].parts=Array.from({length:4},()=>({offset:{x:0,y:0,z:0},size:{x:24,y:24,z:24},material:'stone'}));assert.throws(()=>compileScene(s),/预算/);assert.throws(()=>validateSnapshot({...INITIAL_SNAPSHOT,player:{...INITIAL_SNAPSHOT.player,x:NaN}}));});
test('候选隔离，应用时保存最新位置，回退也保留当前位置',()=>{
  const p=project(),base=p.data.current,b=p.build(tree());p.stage(b,'树',base,'task');assert.equal(p.data.current,base);
  const latest=clone(INITIAL_SNAPSHOT);latest.player.x=11.5;const tx=p.prepare(b.id,base,latest);assert.equal(p.data.current,base);assert.equal(tx.loadSnapshot.player.x,11.5);
  p.commit(tx.id,latest);assert.equal(p.data.current,b.id);assert.equal(p.data.snapshot.player.x,11.5);p.rollback(base);const t2=p.prepare(base,b.id,latest);p.commit(t2.id,latest);assert.equal(p.data.current,base);assert.equal(p.data.snapshot.player.x,11.5);
});
test('过期候选、旧页面保存和重复提交均被拒绝',()=>{const p=project(),b=p.build(tree()),base=p.data.current;p.stage(b,'树',base,null);assert.throws(()=>p.prepare(b.id,'v-00000000000000000000',INITIAL_SNAPSHOT));const tx=p.prepare(b.id,base,INITIAL_SNAPSHOT);p.commit(tx.id,INITIAL_SNAPSHOT);assert.throws(()=>p.commit(tx.id,INITIAL_SNAPSHOT));assert.throws(()=>p.save(base,INITIAL_SNAPSHOT));});
test('加载失败中止事务，旧版本、最新存档和候选均保留',()=>{const p=project(),b=p.build(tree()),base=p.data.current;p.stage(b,'树',base,null);const latest=clone(INITIAL_SNAPSHOT);latest.player.z=18;const tx=p.prepare(b.id,base,latest);p.abort(tx.id);assert.equal(p.data.current,base);assert.equal(p.data.snapshot.player.z,18);assert.equal(p.data.candidate.id,b.id);assert.equal(fs.readdirSync(path.join(p.root,'backups')).length,1);});
test('服务重启恢复未提交事务，未完成任务不会成为已应用版本',()=>{const p=project(),b=p.build(tree()),base=p.data.current;p.stage(b,'树',base,null);p.prepare(b.id,base,INITIAL_SNAPSHOT);p.change(d=>d.tasks.push({id:'test',status:'running'}));const resumed=new ProjectStore(p.root);assert.equal(resumed.data.current,base);assert.equal(resumed.data.applying,null);assert.equal(resumed.data.tasks[0].status,'interrupted');assert.equal(resumed.data.candidate.id,b.id);});
test('写入失败不会提前改变内存中的已应用版本',()=>{const p=project(),base=p.data.current,b=p.build(tree());p.stage(b,'树',base,null);const tx=p.prepare(b.id,base,INITIAL_SNAPSHOT);p.file=path.join(p.root,'bad-target');fs.mkdirSync(p.file);assert.throws(()=>p.commit(tx.id,INITIAL_SNAPSHOT));assert.equal(p.data.current,base);});
test('导入完整存档先形成候选，明确恢复文件中的位置',()=>{const p=project(),base=p.data.current,progress=clone(INITIAL_SNAPSHOT);progress.player.x=9;p.importSave({format:'craftmine.save/1',scene:tree(),snapshot:progress});assert.equal(p.data.current,base);const tx=p.prepare(p.data.candidate.id,base,INITIAL_SNAPSHOT);assert.equal(tx.snapshot.player.x,.5);assert.equal(tx.loadSnapshot.player.x,9);p.commit(tx.id,progress);assert.equal(p.exportSave().snapshot.player.x,9);});
test('篡改过的构建被拒绝，原型数据没有混入新项目',()=>{const p=project(),file=path.join(p.root,'builds',p.data.current,'build.json');const d=JSON.parse(fs.readFileSync(file));d.scene.title='tampered';fs.writeFileSync(file,JSON.stringify(d));assert.throws(()=>p.readBuild(p.data.current),/校验失败/);assert.equal(p.data.snapshot.format,'craftmine.progress/1');});
