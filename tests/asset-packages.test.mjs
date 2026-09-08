import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore } from '../app/store.mjs';
import { INITIAL_SNAPSHOT,withAppearanceFormat } from '../app/scene.mjs';
import { defaultAppearance } from '../app/asset-binding.mjs';
import { assetContent } from '../app/assets.mjs';
import { behaviorScene } from './behavior-fixtures.mjs';
import { png } from './asset-fixtures.mjs';
const fixture=()=>new ProjectStore(fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-package-')));
const add=(s,old=null,color=[220,30,60,255])=>{const a=s.assets.prepare(s.data,{id:old?.id||null,baseVersion:old?.version||null,name:'门',filename:'door.png',mime:'image/png',data:png(4,10,color).toString('base64')});s.change(d=>s.assets.register(d,a));return a;};
const commit=s=>{const tx=s.prepare(s.data.candidate.id,s.data.current,s.data.snapshot);s.commit(tx.id,tx.loadSnapshot);};
function source(){const s=fixture(),a=add(s),scene=withAppearanceFormat({...behaviorScene(),format:'craftmine.scene/4'});scene.objects[0].appearance=defaultAppearance(scene.objects[0],a);s.importSave({format:'craftmine.save/1',scene,snapshot:INITIAL_SNAPSHOT});commit(s);return {s,a};}
test('完整存档只打包实际使用的固定版本，第二项目候选与应用可恢复同一构建',()=>{
  const {s,a}=source(),newer=add(s,a,[20,200,80,255]),save=s.exportSave();assert.equal(newer.version,2);assert.equal(save.format,'craftmine.save/2');assert.deepEqual(save.assets,[a]);
  const t=fixture(),before=t.data.current,prepared=t.prepareSave(save);assert.equal(t.data.assets,undefined);assert.equal(fs.existsSync(t.assets.file(a.id,1)),false);assert.equal(prepared.build.id,s.data.current);
  t.importSave(save);assert.equal(t.data.current,before);assert.equal(t.data.candidate.id,s.data.current);commit(t);assert.equal(t.data.current,s.data.current);assert.deepEqual(new ProjectStore(t.root).exportSave(),save);
});
test('对象及完整创作包带原始资源，模块内容与旧版本保持不可变',()=>{
  const {s,a}=source(),t=fixture();for(const kind of ['object','creation']){const ref=s.data.moduleBindings[kind][kind==='object'?'door-one':'sliding-door'],pack=s.exportModule(ref.id,ref.version);assert.equal(pack.format,'craftmine.module-package/1');assert.deepEqual(pack.assets,[a]);const before=t.data.current;t.importModule(pack);assert.equal(t.data.current,before);assert.equal(t.data.candidate,null);assert.deepEqual(t.exportModule(ref.id,ref.version),pack);}
});
test('缺失、重复、多余素材与篡改包在登记文件或候选前拒绝',()=>{
  const {s}=source(),t=fixture(),save=s.exportSave(),unchanged=structuredClone(t.data),cases=[];
  let bad=structuredClone(save);bad.assets=[];cases.push(bad);bad=structuredClone(save);bad.assets.push(bad.assets[0]);cases.push(bad);bad=structuredClone(save);bad.assets[0].data=png(4,10,[1,2,3,255]).toString('base64');cases.push(bad);bad=structuredClone(save);bad.assets[0].hash='0'.repeat(64);cases.push(bad);
  for(const value of cases){assert.throws(()=>t.importSave(value));assert.deepEqual(t.data,unchanged);assert.equal(fs.existsSync(t.assets.file(save.assets[0].id,1)),false);}
});
test('同一素材版本的有效但不同内容无法覆盖已有文件，包内其他新素材也不登记',()=>{
  const {s,a}=source(),t=fixture();t.change(d=>t.assets.register(d,a));const before=structuredClone(t.data),file=t.assets.file(a.id,1),bytes=fs.readFileSync(file),bad=s.exportSave();bad.assets[0].data=png(4,10,[1,2,3,255]).toString('base64');Object.assign(bad.assets[0],assetContent(bad.assets[0]));bad.scene.objects[0].appearance.asset.hash=bad.assets[0].hash;
  assert.throws(()=>t.prepareSave(bad),/同一素材版本/);assert.deepEqual(t.data,before);assert.deepEqual(fs.readFileSync(file),bytes);
});
test('导入保存失败不提前提交项目索引，旧场景与进度保持原样',()=>{
  const {s}=source(),t=fixture(),save=s.exportSave(),before=structuredClone(t.data),disk=fs.readFileSync(t.file);t.assets.write=()=>{throw Error('测试磁盘不可写');};assert.throws(()=>t.importSave(save),/磁盘不可写/);assert.deepEqual(t.data,before);assert.deepEqual(fs.readFileSync(t.file),disk);
});
test('旧存档及旧模块仍原样导出，缺失原始文件可由完整包恢复',()=>{
  const old=fixture();assert.equal(old.exportSave().format,'craftmine.save/1');const {s,a}=source(),save=s.exportSave(),file=s.assets.file(a.id,1);fs.unlinkSync(file);const reopened=new ProjectStore(s.root);assert.throws(()=>reopened.exportSave(),/缺失/);reopened.importSave(save);commit(reopened);assert.deepEqual(reopened.exportSave(),save);
});
