import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sceneDiff,upgradeScene,compileScene,EMPTY_SCENE,INITIAL_SNAPSHOT } from '../app/scene.mjs';
import { diffLines,reviewEntities } from '../app/scene-diff.mjs';
import { behaviorScene } from './behavior-fixtures.mjs';
import { legacyFloraScene,floraScene } from './scene-fixtures.mjs';
import { ProjectStore } from '../app/store.mjs';

test('差异按稳定身份区分对象、参数和源码，保留重命名与世界设置变化',()=>{
  const before=behaviorScene(),after=structuredClone(before);after.objects[0].name='新木门';after.objects[0].position.x+=1;after.objects[0].parts[0].solid=false;after.behaviors[0].params.openX=2;after.behaviors[0].code+='\n// revised';after.title='新世界';after.night=true;
  const diff=sceneDiff(before,after),object=diff.details.items.find(i=>i.kind==='object'),behavior=diff.details.items.find(i=>i.kind==='behavior');
  assert.equal(object.id,'door-one');assert.equal(object.beforeName,'木滑门');assert.deepEqual(object.fields,['name','position','parts']);assert.deepEqual(behavior.fields,['params','code']);
  assert.deepEqual(diff.details.items.find(i=>i.kind==='world').fields,['title','night']);
  const values=reviewEntities({before:{scene:before},after:{scene:after}},behavior);assert.equal(values.before.params.openX,1.2);assert.equal(values.after.params.openX,2);
});
test('同名对象仍分清新增和移除，旧格式升级不会凭空制造几何差异',()=>{
  const before=floraScene(),after=structuredClone(before);after.objects[0].id='another-flower';
  const rows=sceneDiff(before,after).details.items;assert.equal(rows.length,2);assert.equal(rows.find(i=>i.change==='added').id,'another-flower');assert.equal(rows.find(i=>i.change==='removed').id,'flower-one');
  const legacy=legacyFloraScene(),hash=compileScene(legacy).hash;assert.equal(sceneDiff(legacy,upgradeScene(legacy)).details.items.length,0);assert.equal(compileScene(legacy).hash,hash);
});
test('源码对比保留所有更改行，长单行源码也不会丢失',()=>{
  const a='a\nb\nc\nd\ne\nf\ng\nh',b='a\nb\nc\nnew-d\ne\nnew-f\ng\nh',rows=diffLines(a,b);
  assert.ok(rows.some(r=>r.type==='removed'&&r.text==='d'));assert.ok(rows.some(r=>r.type==='added'&&r.text==='new-d'));assert.ok(rows.some(r=>r.type==='added'&&r.text==='new-f'));
  const long='x'.repeat(32000);assert.equal(diffLines('',long).find(r=>r.type==='added').text,long);
});
test('读取候选预览重新核对真实构建且不写项目，过期和应用中请求被拒绝',()=>{
  fs.mkdirSync('test-results',{recursive:true});const store=new ProjectStore(fs.mkdtempSync(path.resolve('test-results/review-unit-'))),base=store.data.current,next=store.build(floraScene());
  store.stage(next,'预览变化',base,null);store.change(d=>{d.candidate.diff={added:['不真实的缓存']};});const bytes=fs.readFileSync(store.file,'utf8');
  const review=store.reviewCandidate(next.id,base);assert.equal(review.before.hash,compileScene(EMPTY_SCENE).hash);assert.equal(review.after.hash,next.hash);assert.equal(review.diff.details.items.filter(i=>i.kind==='object').length,5);assert.deepEqual(review.diff.details.items.find(i=>i.kind==='world').fields,['title']);assert.equal(review.diff.details.items.length,6);assert.equal(fs.readFileSync(store.file,'utf8'),bytes);
  assert.throws(()=>store.reviewCandidate(base,base),/候选已改变/);store.prepare(next.id,base,INITIAL_SNAPSHOT);assert.throws(()=>store.reviewCandidate(next.id,base),/候选已改变/);
});
