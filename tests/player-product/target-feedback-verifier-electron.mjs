// Actual production verifier class; descriptor is a fixed authored fixture.
// This does not substitute for the core/executor candidate trust-chain test.
import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {GodotBuildVerifier} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';
const out=process.env.CRAFTMINE_FEEDBACK_CHECK_OUT;
const report={kind:'actual-godot-web-electron-verifier',checks:[],cases:[],limits:['Authored descriptors; Rust finish/candidate authorization is not exercised.','No model, input or visible window.']};
const write=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const fail=error=>{report.passed=false;report.failure=String(error?.stack??error);write();app.exit(1);};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
// A verifier destroys its own only window before returning teardown evidence.
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const cases=JSON.parse(fs.readFileSync(path.join(out,'descriptors.json'),'utf8'));
 const verifier=new GodotBuildVerifier({deadlineMs:180000});
 for(const item of cases){
  const evidence=await verifier.check(item.descriptor);report.cases.push({name:item.name,evidence});write();
  const entries=evidence.requirementsEvidence?.observations??[];
  if(item.name==='positive'){
   assert.equal(evidence.passed,true,JSON.stringify(evidence));
   assert.deepEqual(entries.map(e=>[e.phase,e.hitFlashMilliseconds]),[['loaded',500],['running',500]]);
   assert.equal(evidence.render.ok,true);assert.equal(evidence.isolation.ok,true);assert.equal(evidence.recovery.ok,true);
  }else{
   assert.equal(evidence.passed,false);assert.equal(evidence.error,'GODOT_CHECK_TARGET_FEEDBACK_MISMATCH:loaded');
   assert.deepEqual(entries.map(e=>[e.phase,e.hitFlashMilliseconds]),[['loaded',700]]);
   assert.equal(evidence.assertions.find(a=>a.id==='runtime.target-feedback')?.passed,false);
   assert.equal(evidence.recovery.ok,true);
  }
  report.checks.push({name:item.name,passed:true});write();
 }
 report.passed=true;write();app.exit(0);
}).catch(fail);
