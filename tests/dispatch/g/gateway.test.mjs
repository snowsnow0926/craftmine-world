import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../vendor/pi-desktop/packages/agent-runtime/package.json',import.meta.url));
const {build}=require('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-turn-gateway.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {CraftmineTurnGateway}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function setup(request=async()=>({ok:true})){
  const active=new Map([['s','t']]);
  const gateway=new CraftmineTurnGateway(id=>active.get(id),()=>new Set(['plugin_craftmine_world_project_inspect']),request);
  gateway.bind({sessionId:'s',turnId:'t',projectId:'p',selectedWorld:'w'});
  return {gateway,active};
}
test('world turn gates host tools even with forged mode and arbitrary plugin names',()=>{
  const {gateway}=setup();
  for(const toolName of ['Read','Write','Edit','Bash','BrowserPreview','plugin_other_run','mcp_any']){
    assert.throws(()=>gateway.assertTool({sessionId:'s',turnId:'t',toolName,mode:'agent'}),/TOOL_SCOPE_DENIED/);
  }
  gateway.assertTool({sessionId:'s',turnId:'t',toolName:'plugin_craftmine_world_project_inspect'});
  gateway.assertTool({sessionId:'generic',toolName:'Read'});
  assert.throws(()=>gateway.assertTool({sessionId:'s',turnId:'old',toolName:'plugin_craftmine_world_project_inspect'}),/ACTIVE_TURN_REQUIRED/);
});
test('turn scope is immutable and stale finalization cannot erase a successor',()=>{
  const {gateway,active}=setup();
  assert.throws(()=>gateway.bind({sessionId:'s',turnId:'t',projectId:'p',selectedWorld:'other'}),/REBIND_REFUSED/);
  active.set('s','new');gateway.bind({sessionId:'s',turnId:'new',projectId:'p',selectedWorld:'next'});
  gateway.end('s','t');assert.equal(gateway.get('s').selectedWorld,'next');
  assert.throws(()=>{gateway.get('s').selectedWorld='forged';},TypeError);
  gateway.end('s','new');
  assert.throws(()=>gateway.assertTool({sessionId:'s',turnId:'new',toolName:'Bash'}),/ACTIVE_TURN_REQUIRED/);
  active.set('s','generic');gateway.beginGeneric('s','generic');
  gateway.assertTool({sessionId:'s',turnId:'generic',toolName:'Bash'});
});
test('private model context rejects forged identity and stale reply after stop',async()=>{
  let resolve;
  const {gateway,active}=setup(()=>new Promise(done=>{resolve=done;}));
  await assert.rejects(gateway.invoke('core.call',{sessionId:'s',turnId:'t'}),/METHOD_DENIED/);
  for(const key of ['context','binding','projectId','worldId','selectedWorld','generation'])await assert.rejects(gateway.invoke('craftmine.context',{sessionId:'s',turnId:'t',[key]:'forged'}),/FORGED_IDENTITY/);
  const pending=gateway.invoke('craftmine.context',{sessionId:'s',turnId:'t'});
  active.delete('s');resolve({world:'late'});await assert.rejects(pending,/STALE_REPLY/);
});
