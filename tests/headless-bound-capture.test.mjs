import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';
import {validateGodotViewCaptureIdentity} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-view-capture.ts';
const source=fs.readFileSync('vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-bound-capture.ts','utf8');const js=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'');const context={validateGodotViewCaptureIdentity,Error};vm.runInNewContext(js+'\nglobalThis.run=runHeadlessBoundCapture',context);
const request={type:'craftmine-headless',id:'request',method:'godotCaptureBoundView',payload:{worldId:'world',buildId:'build',instanceId:'instance'}};
test('authorized finite forwarding uses real host identity argument and preserves refusal',async()=>{
 let calls=0;const access={enabled:true,state:()=>({state:'paused'}),capture:async identity=>{calls++;assert.deepEqual(JSON.parse(JSON.stringify(identity)),request.payload);return{pngBase64:'real-host-frame'};}};
 assert.deepEqual(await context.run(request,access),{pngBase64:'real-host-frame'});assert.equal(calls,1);
 access.capture=async()=>{throw Error('GODOT_VIEW_CAPTURE_DETACHED');};await assert.rejects(context.run(request,access),/GODOT_VIEW_CAPTURE_DETACHED/);
});
test('missing headless authorization, wrong command, size or arbitrary fields never reach host',async()=>{
 let calls=0;const access={enabled:true,state:()=>{calls++;},capture:async()=>{calls++;}};
 for(const input of [{...request,method:'godotCaptureView'},{...request,js:'evil'},{...request,payload:{...request.payload,width:1280}},{...request,payload:{worldId:'world',buildId:'build'}}])await assert.rejects(context.run(input,access),/HEADLESS_BOUND_CAPTURE_|GODOT_VIEW_CAPTURE_IDENTITY/);
 await assert.rejects(context.run(request,{...access,enabled:false}),/HEADLESS_BOUND_CAPTURE_DENIED/);assert.equal(calls,0);
});
test('state snapshot has a separate empty envelope and cannot capture',async()=>{
 let calls=0;const access={enabled:true,state:()=>({formal:{instanceId:'actual'}}),capture:async()=>{calls++;}};
 assert.deepEqual(await context.run({type:'craftmine-headless',id:'request',method:'godotCaptureBoundState'},access),{formal:{instanceId:'actual'}});
 await assert.rejects(context.run({...request,method:'godotCaptureBoundState'},access),/HEADLESS_BOUND_CAPTURE_FIELDS/);assert.equal(calls,0);
});
