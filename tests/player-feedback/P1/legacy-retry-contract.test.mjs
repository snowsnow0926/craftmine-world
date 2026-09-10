import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {BRIDGE,OLD_BRIDGE,NEW_BRIDGE,sha,assertNativeFailure,assertRepair} from './legacy-retry-contract.mjs';
const file=(path,sha256,bytes=1)=>({path,sha256,bytes});
const before=()=>({passed:true,loadError:'Runtime request timed out: load [requests=15/15]',worldId:'own',candidateId:'old-candidate',
 init:{status:'failed',playable:false,reason:'GODOT_INITIAL_LOAD_FAILED',failureStage:'confirm',launchFailure:{candidateId:'old-candidate',applicationId:'old-application'}},
 application:{id:'old-application',worldId:'own',status:'aborted'},job:{status:'passed',candidateId:'old-candidate',jobId:'old-job'},
 project:{revision:1,manifestHash:'old-source',files:[file(BRIDGE,OLD_BRIDGE),file('game.gd','game-hash')]},guards:[],coreClose:{code:0}});
const after=b=>({init:{status:'confirmed',playable:true,candidateId:'new-candidate'},job:{status:'passed',candidateId:'new-candidate',jobId:'new-job',buildId:'new-build'},formal:{buildId:'new-build'},
 project:{revision:2,manifestHash:'new-source',files:[file(BRIDGE,NEW_BRIDGE),file('game.gd','game-hash')]},oldProject:structuredClone(b.project),oldApplication:structuredClone(b.application)});
test('known historical bridge bytes are pinned independently of current authored source',()=>{
 const root=path.resolve(import.meta.dirname,'../../..');const bytes=execFileSync('git',['show','eae279915094f09d987ef0eb747eba20ef92cd0e:desktop/godot/shared/runtime_bridge.gd'],{cwd:root});assert.equal(sha(bytes),OLD_BRIDGE);
 assert.notEqual(sha(fs.readFileSync(path.join(root,'desktop/godot/shared/runtime_bridge.gd'))),OLD_BRIDGE);
});
test('requires real-shaped passed check, native load error, durable abort and complete shutdown',()=>{
 assertNativeFailure(before());
 for(const change of [b=>b.job.status='failed',b=>b.loadError='simulated failure',b=>b.loadError+=' FAILURE_RECORD_UNCONFIRMED',b=>b.application.status='prepared',b=>b.init.playable=true,b=>b.guards.push('focus'),b=>b.coreClose.code=1]){const b=before();change(b);assert.throws(()=>assertNativeFailure(b));}
});
test('new candidate and job cannot substitute for preservation of the old revision',()=>{
 const b=before();assertRepair(b,after(b));
 for(const change of [a=>a.init.candidateId='old-candidate',a=>a.job.jobId='old-job',a=>a.project.files[1].sha256='changed-game',a=>a.oldProject.files[0].sha256=NEW_BRIDGE,a=>a.oldApplication.status='applied',a=>a.job.status='failed',a=>a.project.files.push(file('extra.gd','extra'))]){const a=after(b);change(a);assert.throws(()=>assertRepair(b,a));}
});
