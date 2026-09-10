// Repeatable next-batch verification. Live model requests are a separate opt-in run.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const quick=process.argv.includes('--quick');
if(process.argv.slice(2).some(arg=>arg!=='--quick'))throw Error('Usage: node scripts/verify-creation-next.mjs [--quick]');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/creation-next-checks-'));
const report={format:'craftmine.creation-next-checks/1',scope:quick?'unit':'integration',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),startedAt:new Date().toISOString(),out,steps:[],passed:false,limitations:['No real model requests in this command; model comparison has its own report and budget.','No physical microphone, player or clean Windows lifecycle claim.']};
const persist=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
const unit=['creation-operations','creation-source-service','creation-progress-migration','creation-runtime','creation-entities','creation-sequence-rule','creation-model-evaluation','godot-build-read-wait','creation-pack-integrity'].map(name=>'tests/'+name+'.test.mjs');
unit.push('tests/creation-guidance/guidance.test.mjs','tests/creation-guidance/packaging.test.mjs','desktop/godot/bases/creation-sandbox/tests/contract.test.mjs');
const host=fs.readdirSync(path.join(root,'vendor/pi-desktop/apps/desktop/test')).filter(name=>/^(?:creation-|voice-input|voice-microphone-permission|composer-voice-draft|craftmine-immersion|immersion-pause-controller).*\.test\.mjs$/.test(name)).sort().map(name=>'vendor/pi-desktop/apps/desktop/test/'+name);
const steps=[['logic',['--test',...unit]],['host',['--test',...host]]];
if(!quick)for(const [name,file]of [
 ['editing-ui','creation-edit-ui-headless'],['voice-status-ui','creation-voice-status-headless'],
 ['editing-progress','creation-edit-progress-headless'],['general-behavior','creation-entity-behavior-headless'],
 ['requirements','creation-requirements-web'],['harvest','creation-harvest-web'],
 ['forged-observation','creation-observation-forgery-probe'],['exported-pack','creation-pack-export-headless'],['managed-executor','creation-managed-executor'],
 ['direct-native','creation-edit-native'],
])steps.push([name,['tests/'+file+'.mjs']]);
persist();
for(const [name,args]of steps){
 const log=path.join(out,name+'.log'),item={name,command:[process.execPath,...args],status:'running',startedAt:new Date().toISOString(),log};report.steps.push(item);persist();console.log('Running '+name+'; log '+log);
 const fd=fs.openSync(log,'w'),start=Date.now();
 try{
  const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_REVIEW_ROOT:root,CRAFTMINE_EXPECT_FORGERY_REJECTED:'1'}});
  item.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});item.status=item.exitCode===0?'passed':'failed';
 }catch(error){item.status='failed';item.error=String(error);}
 finally{fs.closeSync(fd);item.elapsedMs=Date.now()-start;item.sha256=createHash('sha256').update(fs.readFileSync(log)).digest('hex');persist();}
 console.log(name+': '+item.status);if(item.status!=='passed'){process.exitCode=1;break;}
}
report.passed=report.steps.length===steps.length&&report.steps.every(step=>step.status==='passed');report.finishedAt=new Date().toISOString();persist();console.log('Acceptance report: '+path.join(out,'report.json'));
