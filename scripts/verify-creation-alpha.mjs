// Repeatable acceptance entry. Every subprocess owns its headless profile.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const quick=process.argv.includes('--quick');
if(process.argv.slice(2).some(arg=>arg!=='--quick'))throw Error('Usage: node scripts/verify-creation-alpha.mjs [--quick]');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/creation-alpha-'));
const report={format:'craftmine.creation-alpha-checks/1',scope:quick?'unit-only':'integration',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),startedAt:new Date().toISOString(),out,steps:[],passed:false,limitations:['No real model first-request success-rate or physical microphone claim.','Installed-player interaction remains distinct from isolated automated acceptance.']};
const persist=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
const unit=['tests/creation-operations.test.mjs','tests/creation-source-service.test.mjs','tests/creation-progress-migration.test.mjs','tests/creation-font.test.mjs','tests/creation-runtime.test.mjs','tests/creation-entities.test.mjs','tests/creation-guidance/guidance.test.mjs','tests/creation-guidance/packaging.test.mjs','desktop/godot/bases/creation-sandbox/tests/contract.test.mjs','tests/godot-round3/S6/plugin-load.test.mjs','tests/godot-round3/S6/live-and-execution-wiring.test.mjs'];
const desktopTests=fs.readdirSync(path.join(root,'vendor/pi-desktop/apps/desktop/test')).filter(name=>/^(creation-|craftmine-context-read|godot-world-creation).*\.test\.mjs$/.test(name)).map(name=>'vendor/pi-desktop/apps/desktop/test/'+name);
const steps=[['unit',['--test',...unit]],['host',['--test',...desktopTests]]];
if(!quick)steps.push(['rule-engine',['--test','tests/creation-guidance/rule-headless.test.mjs']],['ui',['tests/creation-ui-headless.mjs']],['story',['tests/creation-story-headless.mjs']],['web',['tests/creation-web-headless.mjs']],['managed-executor',['tests/creation-managed-executor.mjs']],['distribution',['tests/godot-final/staged-materializers.mjs']]);
persist();
for(const [name,args]of steps){
 const log=path.join(out,name+'.log'),item={name,command:[process.execPath,...args],startedAt:new Date().toISOString(),status:'running',log};report.steps.push(item);persist();
 console.log('Running '+name+'; log '+log);
 const fd=fs.openSync(log,'w');const start=Date.now();
 try {
  const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,CRAFTMINE_HEADLESS_TEST:'1'}});
  item.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  item.status=item.exitCode===0?'passed':'failed';
 }catch(error){item.status='failed';item.error=String(error);}
 finally{fs.closeSync(fd);item.elapsedMs=Date.now()-start;item.sha256=createHash('sha256').update(fs.readFileSync(log)).digest('hex');persist();}
 console.log(name+': '+item.status);
 if(item.status!=='passed'){process.exitCode=1;break;}
}
report.passed=report.steps.length===steps.length&&report.steps.every(step=>step.status==='passed');report.finishedAt=new Date().toISOString();persist();console.log('Acceptance report: '+path.join(out,'report.json'));
