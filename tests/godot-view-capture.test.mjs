import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';import {createHash} from 'node:crypto';
import {captureBoundGodotView,validateGodotViewCaptureIdentity,WORLD_VIEW_CAPTURE_MAX_PNG_BYTES} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-view-capture.ts';
const source=fs.readFileSync('vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts','utf8');
const compiled=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
const context={captureBoundGodotView,validateGodotViewCaptureIdentity,Buffer,Error,console,setTimeout,clearTimeout,resolve:value=>value,realpath:async value=>value,sep:'/'};
vm.runInNewContext(compiled+'\nglobalThis.Host=GodotWorldViewHost',context);
function frame({width=320,height=240,painted=true,pngBytes=64}={}){
 const bitmap=Buffer.alloc(width*height*4);if(painted)for(let i=3;i<bitmap.length;i+=4)bitmap[i]=255;
 const png=Buffer.alloc(pngBytes);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(width,16);png.writeUInt32BE(height,20);
 return{getSize:()=>({width,height}),toBitmap:()=>bitmap,toPNG:()=>png,resize:({width,height})=>frame({width,height,painted})};
}
function fixture(){
 const calls=[];let destroyed=false,bounds={x:5,y:15,width:320,height:240};
 const forbidden=name=>()=>{calls.push(name);throw Error('FORBIDDEN '+name);};
 const contents={isDestroyed:()=>destroyed,capturePage:async()=>{calls.push('capturePage');return frame();},focus:forbidden('focus'),sendInputEvent:forbidden('input'),executeJavaScript:forbidden('JS'),invalidate:forbidden('invalidate'),startPainting:forbidden('painting'),setSize:forbidden('size'),send:forbidden('send')};
 const view={webContents:contents,getBounds:()=>({...bounds}),setBounds:forbidden('bounds')};
 const owner={isDestroyed:()=>false,contentView:{children:[view],addChildView:forbidden('attach'),removeChildView:forbidden('detach')},focus:forbidden('ownerFocus'),show:forbidden('show'),setContentSize:forbidden('resize'),setMinimumSize:forbidden('minimum')};
 const identity={worldId:'world',buildId:'build',instanceId:'instance'};
 const instance={...identity,alive:true,closed:false,view,runtime:{pause:forbidden('pause'),resume:forbidden('resume'),request:forbidden('runtimeRequest')}};
 const host=Object.create(context.Host.prototype);Object.assign(host,{options:{window:()=>owner,allowedRoots:()=>['/builds']},current:instance,pending:null,stagedRequest:null,stagedCandidateId:null,candidateVisible:false,visible:true,surfaceVisible:true,currentState:{...identity,state:'paused'},generation:1,starting:new Set(),checkpointPromise:null,savePromise:null,captureBounds:null,transitioning:false,disposed:false,closing:null,frozen:{instance},syncHolds:0});
 return{host,instance,contents,view,owner,identity,calls,setBounds:value=>{bounds=value;},destroy:()=>{destroyed=true;},candidate(){host.pending={...instance,buildId:'candidate-build',instanceId:'candidate-instance'};host.current={...instance,view:{...view,webContents:{}}};host.stagedRequest={worldId:'world',buildId:'candidate-build'};host.stagedCandidateId='candidate-1';host.candidateVisible=true;return{worldId:'world',buildId:'candidate-build',instanceId:'candidate-instance',candidateId:'candidate-1'};}};
}
test('formal paused view returns exact own PNG and preserves runtime/window state',async()=>{
 const f=fixture(),state=f.host.currentState,frozen=f.host.frozen;const result=await f.host.captureView(f.identity);
 assert.equal(result.scope,'formal');assert.equal(result.candidateId,null);assert.equal(result.width,320);assert.equal(result.height,240);assert.equal(result.sha256,createHash('sha256').update(Buffer.from(result.pngBase64,'base64')).digest('hex'));assert.ok(Number.isFinite(Date.parse(result.capturedAt)));assert.equal(f.host.currentState,state);assert.equal(f.host.frozen,frozen);assert.equal(f.host.syncHolds,0);assert.deepEqual(f.calls,['capturePage']);
});
test('visible candidate is explicitly bound; formal cannot capture its pixels',async()=>{
 const f=fixture(),id=f.candidate();await assert.rejects(f.host.captureView(f.identity),/IDENTITY_CHANGED|BUSY/);await assert.rejects(f.host.captureView({...id,candidateId:'forged'}),/CANDIDATE_CHANGED/);
 const result=await f.host.captureView(id);assert.equal(result.scope,'candidate');assert.equal(result.candidateId,id.candidateId);assert.equal(result.buildId,id.buildId);assert.deepEqual(f.calls,['capturePage']);
 f.host.stagedCandidateId=null;await assert.rejects(f.host.captureView(id),/CANDIDATE_CHANGED/);
});
test('staging accepts candidate id only through trusted options',async()=>{
 const f=fixture();f.host.pause=async()=>{};f.host.startReplacement=async request=>{f.host.pending={...f.instance,buildId:request.buildId};f.host.stagedRequest=request;return{state:'paused'};};
 await f.host.stageCandidate({worldId:'world',buildId:'candidate-build',revision:1,root:'/builds/candidate',artifacts:[{}]},{candidateId:'trusted'});assert.equal(f.host.stagedCandidateId,'trusted');
});
test('wrong identity, transition, detached, hidden and unready views refuse before reading',async()=>{
 for(const mutate of [f=>{f.identity.worldId='other';},f=>{f.host.transitioning=true;},f=>{f.host.checkpointPromise=Promise.resolve();},f=>{f.host.savePromise=Promise.resolve();},f=>{f.owner.contentView.children=[];},f=>{f.host.surfaceVisible=false;},f=>{f.host.currentState.state='loading';},f=>{f.destroy();}]){
  const f=fixture();mutate(f);await assert.rejects(f.host.captureView(f.identity),/GODOT_VIEW_CAPTURE_/);assert.deepEqual(f.calls,[]);
 }
});
test('identity/view/size/attachment changes during native capture discard the pixels',async()=>{
 for(const mutate of [f=>{f.host.current={...f.instance,instanceId:'new'};},f=>{f.instance.view={...f.view};},f=>{f.view.webContents={...f.contents};},f=>{f.setBounds({x:5,y:15,width:321,height:240});},f=>{f.owner.contentView.children=[];},f=>{f.destroy();}]){
  const f=fixture();f.contents.capturePage=async()=>{mutate(f);return frame();};await assert.rejects(f.host.captureView(f.identity),/GODOT_VIEW_CAPTURE_/);
 }
});
test('candidate promotion or id change during capture cannot relabel returned pixels',async()=>{
 for(const mutate of [f=>{f.host.current=f.host.pending;f.host.pending=null;f.host.stagedRequest=null;},f=>{f.host.stagedCandidateId='other';}]){const f=fixture(),id=f.candidate();f.contents.capturePage=async()=>{mutate(f);return frame();};await assert.rejects(f.host.captureView(id),/GODOT_VIEW_CAPTURE_/);}
});
test('one timed-out read stays bounded and late completion cannot become a new response',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();let resolve;f.contents.capturePage=()=>{f.calls.push('capturePage');return new Promise(r=>{resolve=r;});};
 const request=f.host.captureView(f.identity),failed=assert.rejects(request,/GODOT_VIEW_CAPTURE_TIMEOUT/);
 await assert.rejects(f.host.captureView(f.identity),/GODOT_VIEW_CAPTURE_PENDING/);t.mock.timers.tick(4000);await failed;
 await assert.rejects(f.host.captureView(f.identity),/GODOT_VIEW_CAPTURE_PENDING/);assert.deepEqual(f.calls,['capturePage']);resolve(frame());await Promise.resolve();
 f.contents.capturePage=async()=>frame();assert.equal((await f.host.captureView(f.identity)).scope,'formal');
});
test('empty, mismatched or oversized captures fail; valid black pixels are accepted',async()=>{
 for(const [image,error]of [[frame({painted:false}),/EMPTY_FRAME/],[{getSize:()=>({width:0,height:240})},/DIMENSIONS/],[frame({pngBytes:WORLD_VIEW_CAPTURE_MAX_PNG_BYTES+1}),/PNG_LIMIT/]]){const f=fixture();f.contents.capturePage=async()=>image;await assert.rejects(f.host.captureView(f.identity),error);}
 const f=fixture();f.setBounds({x:0,y:0,width:8192,height:8192});await assert.rejects(f.host.captureView(f.identity),/DIMENSIONS/);assert.deepEqual(f.calls,[]);
});

test('workbench child capture preserves the owning compositor representation without changing layout',async()=>{
 for(const [sourceWidth,sourceHeight]of [[1216,865],[1200,800],[3840,2160]]){
  const f=fixture(),bounds={x:275,y:150,width:525,height:650};f.setBounds(bounds);
  f.contents.capturePage=async()=>{f.calls.push('capturePage');return frame({width:sourceWidth,height:sourceHeight});};
  const r=await f.host.captureView(f.identity);
  assert.deepEqual([r.viewWidth,r.viewHeight,r.sourceWidth,r.sourceHeight],[525,650,sourceWidth,sourceHeight]);
  assert.deepEqual(f.view.getBounds(),bounds);assert.deepEqual(f.calls,['capturePage']);
  assert.ok(Math.abs(r.width*sourceHeight-r.height*sourceWidth)<=Math.max(sourceWidth,sourceHeight));
  assert.ok(r.width<=1920&&r.height<=1080);assert.equal(r.resized,sourceWidth>1920||sourceHeight>1080);
 }
});

test('independent source dimensions do not permit truncated bitmaps or falsely labelled PNGs',async()=>{
 for(const mutation of [image=>({...image,toBitmap:()=>Buffer.alloc(16)}),image=>({...image,toPNG:()=>frame().toPNG()})]){
  const f=fixture();f.setBounds({x:275,y:150,width:525,height:650});f.contents.capturePage=async()=>mutation(frame({width:1200,height:800}));
  await assert.rejects(f.host.captureView(f.identity),/EMPTY_FRAME|INVALID_IMAGE/);
 }
});
test('4K and scaled displays resize only the captured image and report original pixel/DIP dimensions',async()=>{
 for(const [viewWidth,viewHeight,width,height]of [[3840,2160,3840,2160],[1920,1080,3840,2160]]){
  const f=fixture();f.setBounds({x:0,y:0,width:viewWidth,height:viewHeight});f.contents.capturePage=async()=>frame({width,height});
  const r=await f.host.captureView(f.identity);assert.deepEqual([r.viewWidth,r.viewHeight,r.sourceWidth,r.sourceHeight,r.width,r.height],[viewWidth,viewHeight,width,height,1920,1080]);assert.equal(r.resized,true);assert.deepEqual(f.calls,[]);
 }
});
test('native errors are sanitized and request object mutation cannot change output identity',async()=>{
 const f=fixture();f.contents.capturePage=async()=>{throw Error('secret C:/private/path');};await assert.rejects(f.host.captureView(f.identity),error=>error.message==='GODOT_VIEW_CAPTURE_FAILED');
 const second=fixture();second.contents.capturePage=async()=>{second.identity.candidateId='forged';return frame();};assert.equal((await second.host.captureView(second.identity)).candidateId,null);
});
test('oversized source pixels are refused before bitmap copying and noisy output gets one smaller derivative',async()=>{
 const huge=fixture();huge.contents.capturePage=async()=>({getSize:()=>({width:8192,height:8192}),toBitmap:()=>assert.fail('oversized bitmap must not be copied')});await assert.rejects(huge.host.captureView(huge.identity),/DIMENSIONS/);
 const noisy=fixture();noisy.setBounds({x:0,y:0,width:1920,height:1080});noisy.contents.capturePage=async()=>frame({width:1920,height:1080,pngBytes:WORLD_VIEW_CAPTURE_MAX_PNG_BYTES+1});
 const result=await noisy.host.captureView(noisy.identity);assert.equal(result.sourceWidth,1920);assert.equal(result.sourceHeight,1080);assert.equal(result.width,1280);assert.equal(result.height,720);assert.equal(result.resized,true);
});
