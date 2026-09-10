import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPresentation} from '../../../plugins/craftmine-world/apply-presentation.mjs';
const preview={job:{id:'check-1'}}, good={current:true,status:'completed',acceptance:{passed:true}};
for(const [name,args,code] of [
  ['no preview',{},'no-preview'],['busy',{preview,busy:true},'busy'],['closing',{preview,closing:true},'closing'],
  ['pending voxel receipt',{preview,attempt:{operationId:'old'}},'confirming'],['pending Godot receipt',{preview:{godot:true},attempt:{godot:true}},'confirming'],
  ['missing review',{preview},'review-missing'],['loading review',{preview,reviewLoading:true},'review-loading'],
  ['read failure',{preview,reviewError:'offline'},'review-unavailable'],['historical review',{preview,review:{...good,current:false}},'stale'],
  ...['running','failed','cancelled','interrupted'].map(status=>[status,{preview,review:{...good,status}},'review-'+status]),
  ['unknown status',{preview,review:{...good,status:'future'}},'review-unknown'],
  ['missing acceptance',{preview,review:{current:true,status:'completed'}},'review-incomplete'],
  ['advisory warnings',{preview,review:{...good,acceptance:{passed:false}}},'review-warnings'],
  ['ready',{preview,review:good},'ready'],['Godot preview',{preview:{godot:true}},'godot-preview'],
  ['apply rejected',{preview:{godot:true},applyError:'STALE'},'apply-error'],
]) test(name,()=>{const value=applyPresentation(args);assert.equal(value.code,code);assert.ok(value.reason&&value.next);});
test('preserves the existing primary and advisory button admission matrix',()=>{
  for(const p of [null,preview,{godot:true}])for(const r of [null,good,{...good,current:false},{...good,status:'running'},{...good,acceptance:{passed:false}},{...good,acceptance:null}])
  for(const a of [null,{operationId:'x'},{godot:true}])for(const busy of [false,true])for(const closing of [false,true]){
    const value=applyPresentation({preview:p,review:r,attempt:a,busy,closing});
    assert.equal(value.primaryDisabled,busy||closing||(!!a&&!a.godot)||!p||(!p.godot&&(!r?.current||r.status!=='completed'||!r.acceptance?.passed)));
    const hidden=r?.status!=='completed'||r.acceptance?.passed!==false;
    assert.equal(value.warningHidden,hidden);
    assert.equal(value.warningDisabled,busy||closing||!!a||!p||!r?.current||hidden);
  }
});
test('arbitrary server strings are not interpolated into player instructions',()=>{
  const value=applyPresentation({preview,reviewError:'<img src=x onerror=alert(1)>'});
  assert.ok(!JSON.stringify(value).includes('<img'));
});
