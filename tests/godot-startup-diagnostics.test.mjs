import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {createGodotStartupProbe} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-startup-diagnostics.ts';

function fixture(executeJavaScript) {
  return Object.assign(new EventEmitter(),{executeJavaScript,getOSProcessId:()=>42,
    isOffscreen:()=>true,isPainting:()=>true,getBackgroundThrottling:()=>false});
}
test('startup evidence separates engine ready from scene load and never includes page strings or URLs',async()=>{
  let calls=0;
  const contents=fixture(async(script,gesture)=>{
    calls++;assert.equal(gesture,false);assert(!script.includes('craftmineRuntime'));
    return {ready:'complete',visibility:'hidden',canvas:[1280,784],raf:false,url:'secret-token',status:'secret-token'};
  });
  const probe=createGodotStartupProbe(contents);probe.phase('scene-load');
  contents.emit('paint');contents.emit('paint');
  const text=await probe.failure();
  assert.match(text,/phase=scene-load.*paints=2.*renderer=42.*page=responded.*raf=false.*canvas=1280x784/);
  assert(!text.includes('secret-token'));assert.equal(calls,1);assert.equal(contents.listenerCount('paint'),0);
  probe.dispose();assert.equal(contents.listenerCount('paint'),0);
});
test('a blocked page cannot block failure retirement; late probe settlement has no effect',async()=>{
  let release;const contents=fixture(()=>new Promise(resolve=>{release=resolve;}));
  const probe=createGodotStartupProbe(contents);probe.phase('wait-ready');
  const text=await probe.failure();assert.match(text,/phase=wait-ready.*page=timeout/);
  assert.equal(contents.listenerCount('paint'),0);release({ready:'complete',canvas:[640,360],raf:true});
  await new Promise(resolve=>setImmediate(resolve));assert.match(text,/page=timeout/);
});
test('destroyed renderer and hostile probe values cannot mask the original host failure',async()=>{
  const broken=fixture(async()=>{throw Error('secret-token');});
  broken.getOSProcessId=()=>{throw Error('destroyed');};
  assert.match(await createGodotStartupProbe(broken).failure(),/native=unavailable page=unavailable/);
  const hostile=fixture(async()=>({ready:'secret-token',visibility:'secret-token',canvas:['secret-token',NaN],raf:'secret-token'}));
  const text=await createGodotStartupProbe(hostile).failure();assert(!text.includes('secret-token'));assert(!text.includes('canvas='));
});
test('successful startup disposes its observer without executing a diagnostic page script',()=>{
  const contents=fixture(()=>assert.fail('success must not probe the page'));
  const probe=createGodotStartupProbe(contents);probe.dispose();probe.dispose();
  assert.equal(contents.listenerCount('paint'),0);
});
