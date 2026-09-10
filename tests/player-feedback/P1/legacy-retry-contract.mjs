import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const BRIDGE = 'craftmine_shared/runtime_bridge.gd';
export const OLD_BRIDGE = '318fdb30c40a6165a2080ff12190571fada156ba321f83c3264bae91e4052c76';
export const NEW_BRIDGE = 'faf11c86dc06006a37c65855cd48659107fbe19cc439d771aab45dbf866417a2';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function inventory(directory) {
  const files=[];
  function visit(dir, prefix='') {
    assert.ok(!fs.lstatSync(dir).isSymbolicLink());
    for(const name of fs.readdirSync(dir).sort()) {
      const file=path.join(dir,name), relative=prefix+name, stat=fs.lstatSync(file);
      assert.ok(!stat.isSymbolicLink(),'No link traversal');
      if(stat.isDirectory())visit(file,relative+'/');
      else { assert.ok(stat.isFile()); files.push({path:relative,bytes:stat.size,sha256:sha(fs.readFileSync(file))}); }
    }
  }
  visit(directory); return files;
}
export function assertNativeFailure(report) {
  assert.equal(report.passed,true);
  assert.match(report.loadError,/Runtime request timed out: load/);
  assert.ok(!report.loadError.includes('FAILURE_RECORD_UNCONFIRMED'));
  assert.equal(report.init.status,'failed'); assert.equal(report.init.playable,false);
  assert.equal(report.init.reason,'GODOT_INITIAL_LOAD_FAILED');
  assert.equal(report.init.failureStage,'confirm');
  assert.equal(report.init.launchFailure.candidateId,report.candidateId);
  assert.equal(report.application.id,report.init.launchFailure.applicationId);
  assert.equal(report.application.status,'aborted');
  assert.equal(report.application.worldId,report.worldId);
  assert.equal(report.job.status,'passed'); assert.equal(report.job.candidateId,report.candidateId);
  assert.equal(report.project.files.find(f=>f.path===BRIDGE)?.sha256,OLD_BRIDGE);
  assert.deepEqual(report.guards,[]); assert.equal(report.coreClose.code,0);
}
export function assertRepair(before, after) {
  assert.equal(after.init.status,'confirmed'); assert.equal(after.init.playable,true);
  assert.notEqual(after.init.candidateId,before.candidateId);
  assert.equal(after.job.status,'passed'); assert.equal(after.job.candidateId,after.init.candidateId);
  assert.notEqual(after.job.jobId,before.job.jobId);
  assert.ok(after.project.revision>before.project.revision);
  assert.notEqual(after.project.manifestHash,before.project.manifestHash);
  const old=new Map(before.project.files.map(f=>[f.path,{bytes:f.bytes,sha256:f.sha256}]));
  assert.equal(after.project.files.length,old.size);
  for(const file of after.project.files) {
    assert.ok(old.has(file.path));
    if(file.path===BRIDGE)assert.equal(file.sha256,NEW_BRIDGE);
    else assert.deepEqual({bytes:file.bytes,sha256:file.sha256},old.get(file.path),'Only the bridge may change: '+file.path);
  }
  assert.deepEqual(after.oldProject,before.project,'Old source revision must remain readable');
  assert.deepEqual(after.oldApplication,before.application,'Old aborted application must remain unchanged');
  assert.equal(after.formal.buildId,after.job.buildId);
}
