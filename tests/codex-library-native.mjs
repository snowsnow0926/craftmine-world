// Real CLI domain host + Rust, without a model, engine worker, UI or player input.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CodexWorldHost} from '../scripts/lib/codex-world-host.mjs';
import {APPROVED_POMERANIAN_ID,APPROVED_POMERANIAN_SHA256} from '../desktop/build-approved-pomeranian-package.mjs';
const [runtime,pluginRoot]=process.argv.slice(2);
assert.ok([runtime,pluginRoot].every(item=>item&&path.isAbsolute(item)),'Pass runtime and freshly built plugin paths');
fs.mkdirSync('test-results',{recursive:true});
const data=fs.mkdtempSync(path.resolve('test-results/codex-library-native-'));
const state={runtime,pluginRoot,worldId:'codex-library-world',projectId:'codex-library-project',sessionId:'codex-library-session',coreData:path.join(data,'core')};
const host=new CodexWorldHost({state,data});
const context={projectId:state.projectId,sessionId:state.sessionId,turnId:randomUUID()};
const report={format:'craftmine.codex-library-native/1',modelCalls:0,engineLaunches:0,uiLaunches:0,data,ok:false};
try{
  await host.start({engines:false});await host.initializeBlank();
  await host.begin(context,'Use the existing accepted white Pomeranian companion.');
  const invoke=async(name,args)=>{
    const tool=host.tools.find(tool=>tool.name===name);assert.ok(tool,'CLI tool must be registered: '+name);
    return tool.execute(args,{...context,toolCallId:randomUUID(),executionId:randomUUID()});
  };
  report.search=await invoke('godot_source_library',{mode:'search',query:'同款博美'});
  const card=report.search.result.items.find(item=>item.assetId===APPROVED_POMERANIAN_ID);assert.ok(card);
  const ref={assetId:card.assetId,version:card.version,contentHash:card.contentHash};
  const read=await invoke('godot_source_library',{mode:'read',ref});
  assert.equal(read.resources[0].entry.appearances[0].sha256,APPROVED_POMERANIAN_SHA256);
  assert.equal(JSON.stringify(read).includes(data),false,'Catalog result must not expose host paths');
  report.modelSearch=await invoke('asset_library',{mode:'search',scope:'local-library',mediaKind:'model',query:'博美'});
  assert.ok(report.modelSearch.result.items.some(item=>item.assetId==='cw.model.approved-pomeranian'));
  await assert.rejects(invoke('godot_source_library',{mode:'propose-group',items:[{ref},{ref}]}),/SOURCE_LIBRARY_GROUP_TOO_LARGE_INSTALL_SEPARATELY/);
  const proposed=await invoke('godot_source_library',{mode:'propose',ref,position:{x:-2,y:0,z:-4}});
  report.proposal=proposed.proposal;assert.equal(report.proposal.requiresPlayerAction,true);
  await host.end(context,'completed');
  report.installation=await host.hostRequest('package.request',{method:'installSourceProposal',args:{worldId:state.worldId,proposalId:report.proposal.proposalId}});
  assert.equal(report.installation.applied,false);assert.equal(report.installation.instanceIds.length,1);
  assert.deepEqual(await host.hostRequest('package.request',{method:'installSourceProposal',args:{worldId:state.worldId,proposalId:report.proposal.proposalId}}),report.installation);
  const rows=await host.hostRequest('package.request',{method:'sourceProposals',args:{worldId:state.worldId}});
  assert.equal(rows.items.length,1);assert.equal(rows.items[0].requiresPlayerAction,false);
  assert.deepEqual(rows.items[0].installation.instanceIds,report.installation.instanceIds);
  await assert.rejects(host.hostRequest('package.request',{method:'installSourceProposal',args:{worldId:'other',proposalId:report.proposal.proposalId}}),/WORLD_MISMATCH/);
  report.ok=true;report.limit='Native search/proposal/source installation only; no executable check/adoption/playability claim.';
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await host.stop();fs.writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,report:path.join(data,'report.json'),error:report.error?.split('\n')[0]}));}
