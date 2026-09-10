import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fixture} from './issue-export-fixture.mjs';
import {assertIssueExport,issueExportError} from '../player-product/issue-export-client-contract.mjs';

test('native acceptance predicate accepts actual exporter bytes and binds every collected field',async()=>{
 const f=await fixture(),receipt=await f.call(),bytes=await fs.readFile(f.target);
 assertIssueExport(bytes,receipt,f.before,f.input);
 for(const mutate of [
  d=>{d.record.description=d.record.description.trim();},
  d=>{d.record.context.buildId='another';},
  d=>{d.followups[0].context.instanceId='another';},
  d=>{d.followups[0].client.version='another';},
  d=>{d.followups[0].text='another';},
  d=>{d.playerStatus='recorded';},
  d=>{d.revision=0;},
  d=>{d.internalPath='private';},
 ]){
  const document=JSON.parse(bytes);mutate(document);const changed=Buffer.from(JSON.stringify(document));
  const selfConsistent={...receipt,bytes:changed.length,sha256:createHash('sha256').update(changed).digest('hex')};
  assert.throws(()=>assertIssueExport(changed,selfConsistent,f.before,f.input));
 }
 assert.throws(()=>assertIssueExport(bytes,{...receipt,operationId:'another'},f.before,f.input));
 assert.throws(()=>assertIssueExport(bytes,{...receipt,path:'private'},f.before,f.input));
});

test('specific domain rejection cannot be satisfied by timeout, unsupported RPC or unrelated error',()=>{
 for(const message of ['ISSUE_REVISION_CHANGED','Error: ISSUE_REVISION_CHANGED',"Error: Error invoking remote method 'pi-plugin-panel-invoke': Error: ISSUE_REVISION_CHANGED"])assert.equal(issueExportError(Error(message),'ISSUE_REVISION_CHANGED'),true);
 for(const message of ['Timed out worldPanel','Client exited','Unsupported product panel acceptance channel','ISSUE_INVALID_INPUT','Other ISSUE_REVISION_CHANGED','ISSUE_REVISION_CHANGED: extra'])assert.equal(issueExportError(Error(message),'ISSUE_REVISION_CHANGED'),false);
});

test('actual finite headless panel allowlist adds only existing issue channels and denies an export-all bypass',async()=>{
 const source=await fs.readFile('vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless.ts','utf8');
 const section=source.slice(source.indexOf('case "worldPanel":'),source.indexOf('case "draftProbe":'));
 const match=section.match(/new Set\((\[[^\n]+?\])\)/);assert.ok(match);
 const channels=new Set(JSON.parse(match[1]));
 for(const channel of ['issue.followupPrepare','issue.followup','issue.export'])assert.ok(channels.has(channel));
 for(const channel of ['issue.exportAll','issue.import','fs.writeFile','godotRuntime.exportSource','eval'])assert.equal(channels.has(channel),false);
 assert.ok(section.includes('Unsupported product panel acceptance channel'));
});
