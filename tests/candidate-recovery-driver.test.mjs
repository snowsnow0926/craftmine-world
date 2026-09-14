import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=new URL('./fb02-packaged-candidate-lifecycle.mjs',import.meta.url);
function prepare(t,extra=[]){
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-driver-contract-'));
 t.after(()=>{assert.equal(path.dirname(out),os.tmpdir());fs.rmSync(out,{recursive:true,force:true});});
 const pack=path.join(out,'missing-package'),profile=path.join(out,'missing-profile'),results=path.join(out,'must-not-be-created');
 const args=[fileURLToPath(script),out,profile,'world-test','--candidate-reload-recovery','--packaged-root',pack,'--resources',path.join(pack,'resources'),...extra];
 const run=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,env:{...process.env,CRAFTMINE_CREATION_OUTPUT_ROOT:results}});
 assert.equal(fs.existsSync(results),false);assert.equal(fs.existsSync(profile),false);assert.equal(fs.existsSync(pack),false);
 return {run,pack};
}
test('recovery driver prepares without reading a package/profile or launching an application',t=>{
 const {run,pack}=prepare(t);assert.equal(run.status,0,run.stderr);
 const result=JSON.parse(run.stdout.trim());assert.equal(result.mode,'prepare-only');assert.equal(result.pack,pack);assert.equal(result.modelCalls,0);assert.equal(result.sourceEdits,0);
 assert.ok(result.operations.includes('reload retained panel'));assert.ok(result.operations.includes('save and cold reopen'));
});
test('recovery mode refuses conflicting maintenance scenario before any profile write',t=>{
 const {run}=prepare(t,['--maintenance-interrupt']);assert.equal(run.status,1);assert.match(run.stderr,/RECOVERY_MODE_CONFLICT/);
});
