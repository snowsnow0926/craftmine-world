import test from 'node:test';
import assert from 'node:assert/strict';
import {createGodotGameplayAcceptance} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-godot-gameplay-acceptance.ts';

// Contract-only tests. These injected callbacks are never evidence of gameplay
// or model success; live evidence must come from the actual host surface.
function fixture() {
  let viewport=[1280,720],instance='instance',failure=null;
  const calls=[];
  const access={
    observe:async()=>({format:'craftmine.godot-observation/1',baseId:'first-person',worldId:'world',buildId:'build',instanceId:instance,payload:{viewportSize:viewport}}),
    action:async(op,args)=>{calls.push({op,args});return failure?{error:failure}:{action:op};},
    capture:async(width,height)=>{viewport=[width,height];return {pngBase64:'iVBORw0KGgo-test-only',width,height};},
  };
  return {access,calls,setInstance:value=>{instance=value;},setFailure:value=>{failure=value;}};
}
test('finite native sequence uses real operation callbacks and preserves raw results',async()=>{
  const f=fixture(),run=createGodotGameplayAcceptance(f.access),result=await run('godotPlay');
  assert.deepEqual(f.calls.map(x=>x.op),['resume','equip','look','equip','look','equip','equip','equip']);
  assert.equal(result.actions.length,8);assert.equal(result.captures.length,2);
  assert.deepEqual(result.actions[2].result,{action:'look'});
  assert.equal(result.captures[1].afterAction,4);
});
test('unknown operations cannot become state restore or arbitrary commands',async()=>{
  const f=fixture(),run=createGodotGameplayAcceptance(f.access);
  for(const value of ['restore-state','look','initialize','prompt','set-world-id'])await assert.rejects(run(value),/Unknown fixed/);
  assert.equal(f.calls.length,0);
});
test('viewport mismatch cannot produce successful capture evidence',async()=>{
  const f=fixture();f.access.capture=async()=>({pngBase64:'iVBORw0KGgo-test-only',width:1280,height:720});
  await assert.rejects(createGodotGameplayAcceptance(f.access)('godotCapture600'),/does not match/);
});
test('identity change invalidates evidence and failed request releases controller',async()=>{
  const f=fixture(),run=createGodotGameplayAcceptance(f.access);
  f.access.action=async()=>{f.setInstance('different');return {};};
  await assert.rejects(run('godotPlay'),/identity changed/);
  assert.equal((await run('godotCapture720')).image.width,1280);
});
test('failed gameplay callback does not generate expected observations',async()=>{
  const f=fixture();f.setFailure('unknown equipment');
  await assert.rejects(createGodotGameplayAcceptance(f.access)('godotPlay'),/operation failed: unknown equipment/);
  assert.equal(f.calls.length,1);
});
