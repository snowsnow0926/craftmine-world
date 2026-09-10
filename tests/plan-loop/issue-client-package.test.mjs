// Narrow contract tests. No Electron, Godot, input or network is launched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {issueClientArguments,assertIssueSourceIdentity,assertIssuePackageFeatures,inspectIssuePackage} from './issue-client-package.mjs';

const absolute=path.resolve('fixture'),commit='a'.repeat(40),digest='b'.repeat(64);
const common=['--source-root',absolute,'--deps-app',absolute];
const packaged=[...common,'--packaged-root',absolute,'--expected-commit',commit,'--expected-build-manifest-sha256',digest];

test('packaged issue mode is explicit and denies all development binary/runtime overrides',()=>{
 const value=issueClientArguments([...packaged,'--output-root',absolute]);
 assert.equal(value.packaged,absolute);assert.equal(value.runtime,null);assert.equal(value.outputRoot,absolute);
 for(const key of ['--runtime-source','--core-bin','--host-bin'])assert.throws(()=>issueClientArguments([...packaged,key,absolute]));
 for(const args of [[...common,'--packaged-root',absolute],[...packaged,'--core-bin'],[...packaged,'--unknown','x'],[...packaged,'--output-root','relative'],[...packaged,'--output-root',absolute,'--output-root',absolute],[...packaged,'--expected-commit',commit]])assert.throws(()=>issueClientArguments(args));
});

test('development remains separately labelled and may explicitly borrow pinned native binaries',()=>{
 const value=issueClientArguments([...common,'--runtime-source',absolute,'--core-bin',absolute,'--host-bin',absolute]);
 assert.equal(value.packaged,null);assert.equal(value.runtime,absolute);assert.equal(value.coreBin,absolute);
 assert.throws(()=>issueClientArguments([...common,'--runtime-source',absolute,'--expected-commit',commit]));
});

function sourceFixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'issue-package-source-'));
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init']);fs.writeFileSync(path.join(root,'source.txt'),'fixed source');git(['add','source.txt']);
 git(['-c','user.name=Local Fixture','-c','user.email=fixture@invalid.test','commit','-m','fixture']);
 return {root,commit:git(['rev-parse','HEAD'])};
}

test('each read-only launch guard rejects changed commit and newly dirty actual source',()=>{
 const f=sourceFixture();assert.equal(assertIssueSourceIdentity(f.root,f.commit),f.commit);
 assert.throws(()=>assertIssueSourceIdentity(f.root,commit),/ISSUE_SOURCE_COMMIT_CHANGED/);
 fs.appendFileSync(path.join(f.root,'source.txt'),'dirty');assert.throws(()=>assertIssueSourceIdentity(f.root,f.commit),/ISSUE_SOURCE_NOT_CLEAN/);
});

test('packaged old issue-record-only main cannot impersonate followup capability',()=>{
 assertIssuePackageFeatures(Buffer.from('"issue.followupPrepare" "issue.followup"'));
 for(const source of ['"issue.create" "issue.read"','"issue.followup"','"issue.followupPrepare"'])assert.throws(()=>assertIssuePackageFeatures(Buffer.from(source)),/PACKAGE_ISSUE_FEATURE_MISSING/);
});

test('a missing package is an error even when a valid source fixture is available',async()=>{
 const f=sourceFixture();await assert.rejects(inspectIssuePackage({root:f.root,packaged:path.join(f.root,'missing-package'),expectedCommit:f.commit,expectedManifestHash:digest}),/ENOENT/);
});

test('the actual runner stop rejects after the finite post-kill deadline and records failure',async()=>{
 const source=fs.readFileSync(new URL('./issue-client-native.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('async function stop(){'),source.indexOf('\nfunction snapshot('));
 const launch={},waits=[],timers=[];let kills=0;
 const context=vm.createContext({ended:false,launch,rpc:async()=>{},delay:async ms=>{waits.push(ms);},exit:new Promise(()=>{}),child:{kill(){kills++;}},setTimeout(callback,ms){timers.push(ms);queueMicrotask(callback);return 1;},clearTimeout(){}});
 const stop=vm.runInContext(code+';stop',context);
 await assert.rejects(stop(),/CLIENT_STOP_TIMEOUT/);assert.equal(kills,1);assert.deepEqual(waits,[20000]);assert.deepEqual(timers,[5000]);assert.equal(launch.forcedStop,true);assert.equal(launch.stopTimeout,true);
 await assert.rejects(stop(),/CLIENT_STOP_TIMEOUT/);assert.equal(kills,1);
});
