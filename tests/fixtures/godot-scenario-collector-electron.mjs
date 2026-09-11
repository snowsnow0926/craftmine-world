import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {GodotBuildVerifier} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';
const out=process.env.CRAFTMINE_SCENARIO_CHECK_OUT;
const report={format:'craftmine.godot-scenario-offscreen/1',passed:false,cases:[],scope:'actual production verifier with authored descriptors; core issuance/finish not exercised'};
const write=()=>fs.writeFileSync(path.join(out,'offscreen-report.json'),JSON.stringify(report,null,2));
const fail=error=>{report.error=String(error.stack||error);write();app.exit(1);};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const {cases,plan}=JSON.parse(fs.readFileSync(path.join(out,'offscreen-cases.json'),'utf8'));
 for(const item of cases){
  let selected=false;
  const verifier=new GodotBuildVerifier({deadlineMs:180000,scenarioDiagnostics:item.mode==='disabled'?undefined:binding=>{
   selected=true;
   assert.equal(binding.jobId,item.descriptor.jobId);assert.equal(binding.inputHash,item.descriptor.inputHash);
   if(item.mode==='cancel')setTimeout(()=>verifier.cancel(binding.jobId),120);
   return plan;
  }});
  const evidence=await verifier.check(item.descriptor);report.cases.push({name:item.name,selected,evidence});write();
  assert.equal(evidence.recovery.ok,true,JSON.stringify(evidence));
  if(item.mode!=='official-failure')assert.equal(evidence.isolation.ok,true,JSON.stringify(evidence));
  else {assert.equal(evidence.isolation.offscreen,true);assert.equal(evidence.isolation.visible,false);assert.equal(evidence.isolation.focusable,false);assert.equal(evidence.isolation.sessionCleared,true);}
  if(item.mode==='disabled'){assert.equal(evidence.passed,true);assert.equal(evidence.scenarioDiagnostic,undefined);}
  else if(item.mode==='official-failure'){assert.equal(evidence.passed,false);assert.equal(selected,false);assert.equal(evidence.scenarioDiagnostic,undefined);}
  else if(item.mode==='cancel'){assert.equal(evidence.passed,false);assert.equal(evidence.error,'GODOT_CHECK_CANCELLED');assert.equal(evidence.scenarioDiagnostic?.reason,'SCENARIO_CANCELLED');}
  else {assert.equal(evidence.passed,true,JSON.stringify(evidence));assert.equal(evidence.scenarioDiagnostic.status,item.mode==='positive'?'passed':'failed');assert.equal(evidence.scenarioDiagnostic.affectsCandidateReadiness,false);assert.ok(evidence.assertions.every(a=>!a.id.includes('scenario')));}
 }
 report.passed=true;write();app.exit(0);
}).catch(fail);
