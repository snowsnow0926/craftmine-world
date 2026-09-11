import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHeadlessPermissionBridge,installHeadlessPermissionBridge} from '../vendor/pi-desktop/apps/desktop/src/lib/headless-permission.ts';
import {validateHeadlessPermissionEnvelope} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-permission.ts';
const permission=()=>({sessionId:'session-a',requestId:'request-a',toolCallId:'call-a',toolName:'plugin_craftmine_world_godot_project_patch',risk:'medium',reason:'Plugin-provided tool requires approval',argsPreview:{path:'scripts/plane.gd',source:'extends Node3D'},provider:{secretValue:'never-return'}});
function fixture(){let head=permission();const calls=[];const bridge=createHeadlessPermissionBridge({head:id=>id==='session-a'?head:null,resolve:async(...args)=>{calls.push(args);head=null;}});return {bridge,calls,setHead:value=>head=value};}
const envelope=(method,payload)=>({type:'craftmine-headless',id:'control-1',method,payload});
test('protected envelope reaches the ordinary store resolver once with the reviewed request',async()=>{
  const f=fixture(),scope={__craftmineHeadless:{},__craftmineHeadlessPermission:f.bridge};
  const pending=vm.runInNewContext(validateHeadlessPermissionEnvelope(envelope('headlessPermissionPending',{sessionId:'session-a'}),true),scope);
  assert.equal(pending.toolName,permission().toolName);assert.deepEqual(pending.argsPreview,permission().argsPreview);assert.equal(JSON.stringify(pending).includes('never-return'),false);
  const result=await vm.runInNewContext(validateHeadlessPermissionEnvelope(envelope('headlessPermissionResolve',{sessionId:'session-a',requestId:'request-a',decision:'allow-once'}),true),scope);
  assert.equal(result.status,'resolved');assert.deepEqual(f.calls,[['session-a','request-a','allow-once']]);
  await assert.rejects(f.bridge.resolve({sessionId:'session-a',requestId:'request-a',decision:'allow-once'}),/ALREADY_ATTEMPTED/);
});
test('deny follows the same normal resolver without granting a session permission',async()=>{
  const f=fixture();f.bridge.pending({sessionId:'session-a'});await f.bridge.resolve({sessionId:'session-a',requestId:'request-a',decision:'deny'});assert.equal(f.calls[0][2],'deny');
});
test('unobserved, old head, changed arguments and other sessions cannot be approved',async()=>{
  for(const mutation of ['unobserved','next','arguments','session']){
    const f=fixture();if(mutation!=='unobserved')f.bridge.pending({sessionId:'session-a'});
    if(mutation==='next')f.setHead({...permission(),requestId:'request-b'});
    if(mutation==='arguments')f.setHead({...permission(),argsPreview:{path:'other.gd'}});
    await assert.rejects(f.bridge.resolve({sessionId:mutation==='session'?'session-b':'session-a',requestId:'request-a',decision:'allow-once'}),/CHANGED/);assert.equal(f.calls.length,0);
  }
});
test('no session grants, arbitrary fields, missing parent or absent renderer guard',async()=>{
  const f=fixture();f.bridge.pending({sessionId:'session-a'});
  for(const payload of [{sessionId:'session-a',requestId:'request-a',decision:'allow-session'},{sessionId:'session-a',requestId:'request-a',decision:'allow-once',script:'x'}])await assert.rejects(f.bridge.resolve(payload),/INVALID/);
  const req=envelope('headlessPermissionPending',{sessionId:'session-a'});
  assert.throws(()=>validateHeadlessPermissionEnvelope(req,false),/PARENT_REQUIRED/);
  assert.throws(()=>validateHeadlessPermissionEnvelope({...req,extra:true},true),/ENVELOPE_INVALID/);
  assert.throws(()=>vm.runInNewContext(validateHeadlessPermissionEnvelope(req,true),{}),/RENDERER_UNAVAILABLE/);
  const scope={};assert.equal(installHeadlessPermissionBridge(scope,{head:()=>null,resolve:async()=>{}}),false);assert.equal(scope.__craftmineHeadlessPermission,undefined);
});
test('failed or concurrent resolution is never retried and never clears a successor itself',async()=>{
  let attempts=0,release;const blocker=new Promise(resolve=>release=resolve);
  const bridge=createHeadlessPermissionBridge({head:permission,resolve:async()=>{attempts++;await blocker;throw Error('PERMISSION_TIMEOUT');}});
  bridge.pending({sessionId:'session-a'});const payload={sessionId:'session-a',requestId:'request-a',decision:'deny'},first=bridge.resolve(payload);
  await assert.rejects(bridge.resolve(payload),/ALREADY_ATTEMPTED/);release();await assert.rejects(first,/PERMISSION_TIMEOUT/);await assert.rejects(bridge.resolve(payload),/ALREADY_ATTEMPTED/);assert.equal(attempts,1);
});
test('finite projection strips state and credential fields, rejects malformed cross-session heads',()=>{
  const f=fixture();f.setHead({...permission(),argsPreview:{secretValue:'hidden',nested:{api_key:'hidden',path:'plane.gd'}}});const head=f.bridge.pending({sessionId:'session-a'});assert.equal(JSON.stringify(head).includes('hidden'),false);assert.equal(head.argsPreview.nested.path,'plane.gd');
  f.setHead({...permission(),sessionId:'session-b'});assert.throws(()=>f.bridge.pending({sessionId:'session-a'}),/INVALID/);
});
