// Real Godot integration with fixed authored fixtures. Not a model or render test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createGodotProbeEnvironment,godotLock as lock} from '../desktop/godot/toolchain.mjs';
const root=path.resolve('.');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/godot-headless-'));
let environment;
const report={kind:'fixed-authored-native-headless-godot',version:lock.version,engineSha256:lock.editor.executableSha256,checks:[],runs:[],errors:[],notVerified:['model-authored creation','rendered crosshair appearance','central native embedding','web export','untrusted-code OS isolation']};
const check=(name,value)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
try{
  environment=await createGodotProbeEnvironment(out);
  const {run}=environment;report.runs=environment.runs;
  const version=environment.actualVersion;
  check('Pinned real engine starts without a window',version.startsWith(lock.version.replace('-stable','.stable')));
  report.actualVersion=version;
  for(const base of ['first-person','top-down']){
    const project=path.join(out,base);
    fs.cpSync(path.join(root,'desktop/godot/probes',base),project,{recursive:true});
    await run(base+'-import',['--path',project,'--editor','--import']);
    const states=[];
    for(const restore of [false,true]){
      const stdout=await run(base+(restore?'-restored':'-initial'),['--path',project,'--','--gd0-probe',...(restore?['--restore']:[])]);
      const lines=stdout.split(/\r?\n/).filter(line=>line.startsWith('CRAFTMINE_GD0='));
      assert.equal(lines.length,1,'Exactly one real probe result');
      const result=JSON.parse(lines[0].slice('CRAFTMINE_GD0='.length));
      check(base+(restore?' restored':' initial')+' uses the headless display driver',result.headless);
      if(base==='first-person'){
        check('Real camera attachment, equipment UI and ray collision',result.cameraAttachment&&result.weaponUiSynchronized&&result.rayHit&&result.state.ammo===5&&result.state.targetHealth===38);
        check('Crosshair control covers the actual viewport',result.crosshairSize[0]>0&&JSON.stringify(result.crosshairSize)===JSON.stringify(result.viewportSize));
      }else{
        check('Physics overlap gates real shop purchases',result.outsidePurchaseRejected&&result.physicalShopOverlap&&result.purchase&&result.state.coins===15&&result.state.apples===1);
      }
      states.push(result.state);
      report.runs.at(-1).observed=result;
    }
    check(base+' preserves progress across full process restart',JSON.stringify(states[0])===JSON.stringify(states[1]));
  }
}catch(error){report.errors.push(String(error.stack));process.exitCode=1;console.error(error.message);}
finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('Evidence: '+out);}
