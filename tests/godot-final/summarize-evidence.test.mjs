import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {summarizeEvidence,renderMarkdown} from './summarize-evidence.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'craftmine-evidence-summary-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return {root,write:async (relative,value)=>{
    const file=path.join(root,relative);await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value));return file;
  }};
}
const finishedAt='2026-09-10T01:00:00Z';
test('keeps failed run, later successful rerun and unfinished run separately',async t=>{
  const f=await fixture(t);
  await f.write('test-results/desktop-native-complete-a/report.json',{finishedAt,steps:[{name:'restore',passed:false,error:'secret=PRIVATE_VALUE'}],calls:[{prompt:'ORIGINAL_PROMPT'}]});
  await f.write('test-results/desktop-native-complete-b/report.json',{finishedAt,steps:[{name:'restore',passed:true}]});
  await f.write('test-results/desktop-native-complete-c/report.json',{steps:[{name:'restore',passed:true}]});
  const report=await summarizeEvidence({root:f.root});
  assert.deepEqual(report.reports.map(r=>r.state),['failed','passed','running']);
  assert.equal(report.reports[0].tasks[0].state,'failed');
  assert.equal(report.formalModel.state,'not-executed');assert.equal(report.formalModel.assertions,141);
  assert.equal(report.package.state,'not-verified');
  const output=JSON.stringify(report)+renderMarkdown(report);
  assert.ok(!output.includes('PRIVATE_VALUE'));assert.ok(!output.includes('ORIGINAL_PROMPT'));
  assert.ok(!Object.hasOwn(report,'passRate'));assert.ok(!Object.hasOwn(report.formalModel,'cost'));
});
test('damaged JSON remains visible with original byte hash; absent report remains running',async t=>{
  const f=await fixture(t);const bytes='{interrupted json';
  await f.write('test-results/desktop-native-complete-broken/report.json',bytes);
  await fs.mkdir(path.join(f.root,'test-results/desktop-native-complete-unwritten'),{recursive:true});
  const report=await summarizeEvidence({root:f.root});
  assert.equal(report.reports[0].state,'invalid');
  assert.equal(report.reports[0].sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(report.reports[1].state,'running');assert.equal(report.reports[1].error,'ENOENT');
});
test('separates actual recovery, authored native scenario and narrative; preserves failure items',async t=>{
  const f=await fixture(t);
  await f.write('test-results/desktop-native-recovery-gql5Pk/fault-evidence-a/report.json',{finishedAt,steps:[{name:'restart',passed:true}]});
  await f.write('docs/dispatch-reports/godot-final/windows/mining/report.json',{passed:true,worlds:[{baseId:'mining-sandbox',formal:{buildId:'build-1'},checks:['native save']}],checks:[{fault:'invalid-primary',passed:false}]});
  await f.write('docs/dispatch-reports/godot-final/plugin/MINING_COPY_CLOSEOUT.md','Unverified prose says 100% pass.');
  await f.write('test-results/unrelated-fixture/report.json',{passed:true});
  const summary=await summarizeEvidence({root:f.root});assert.equal(summary.reports.length,3);
  const native=summary.reports.find(r=>r.kind==='native-fixed-scenario');assert.equal(native.state,'failed');
  assert.equal(native.tasks.find(t=>t.name==='native save').assertionSource,'parent-report-claim');
  assert.equal(native.worldIdentities[0].buildId,'build-1');assert.equal(native.startedAt,null);
  assert.equal(summary.reports.find(r=>r.kind==='narrative-only').state,'not-evaluated');
  assert.equal(summary.reports.find(r=>r.kind==='actual-client-recovery').state,'passed');
});
test('package directory alone is not installer evidence; valid payload receipt stays distinct from clean install',async t=>{
  const f=await fixture(t);const p='test-results/package-evidence.json';
  await f.write(p,{format:'craftmine.package-evidence/2',files:[{path:'resources/app.asar'}]});
  assert.equal((await summarizeEvidence({root:f.root,packageEvidence:p})).package.state,'not-verified');
  await f.write(p,{format:'craftmine.package-evidence/2',commit:'a'.repeat(40),sourceArchiveHash:'b'.repeat(64),buildManifestSha256:'c'.repeat(64),extraction:{verified:true},installers:[{path:'Setup.exe',bytes:2,sha256:'d'.repeat(64)},{path:'Setup.exe.blockmap',bytes:1,sha256:'e'.repeat(64)}],installerExecuted:false,cleanWindowsVerified:false,signature:'unsigned-local-preview'});
  const pkg=(await summarizeEvidence({root:f.root,packageEvidence:p})).package;
  assert.equal(pkg.state,'recorded-payload-verification');assert.equal(pkg.cleanWindowsVerified,false);assert.equal(pkg.installerExecuted,false);
});
