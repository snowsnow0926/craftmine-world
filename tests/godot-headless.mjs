// Real Godot integration with fixed authored fixtures. Not a model or render test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const runFile=promisify(execFile);
const root=path.resolve('.');
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const lock=readJson(path.join(root,'desktop/godot/toolchain.lock.json'));
assert.equal(process.platform,'win32','This pinned GD0 toolchain is for Windows x64');
const cache=path.join(root,'desktop/build/godot',lock.version);
const unpacked=readJson(path.join(cache,'unpacked-files.json'));
assert.equal(unpacked.archiveSha256,lock.editor.sha256);
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(digest(path.join(cache,lock.editor.file)),lock.editor.sha256,'Editor archive integrity');
const source=path.join(cache,'editor',lock.editor.executable);
const expected=unpacked.files.find(file=>file.path===lock.editor.executable);
assert.ok(expected,'Verified executable entry');
assert.equal(digest(source),expected.sha256,'Editor executable integrity');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/godot-headless-'));
const engine=path.join(out,'engine');fs.mkdirSync(engine);
const executable=path.join(engine,lock.editor.executable);
fs.copyFileSync(source,executable);fs.writeFileSync(path.join(engine,'_sc_'),'');
const env={};
for(const key of ['SystemRoot','WINDIR','COMSPEC'])if(process.env[key])env[key]=process.env[key];
env.PATH=path.join(process.env.SystemRoot,'System32');
for(const key of ['APPDATA','LOCALAPPDATA','USERPROFILE','TEMP','TMP']){
  env[key]=path.join(out,'profile',key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});
}
for(const folder of ['Desktop','Documents','Downloads','Music','Pictures','Videos'])fs.mkdirSync(path.join(env.USERPROFILE,folder));
const report={kind:'fixed-authored-native-headless-godot',version:lock.version,engineSha256:expected.sha256,checks:[],runs:[],errors:[],notVerified:['model-authored creation','rendered crosshair appearance','central native embedding','web export','untrusted-code OS isolation']};
const check=(name,value)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
async function run(label,args){
  const started=performance.now();
  try{
    const result=await runFile(executable,['--headless',...args],{cwd:out,env,windowsHide:true,timeout:45000,maxBuffer:1024*1024});
    fs.writeFileSync(path.join(out,label+'.log'),result.stdout+result.stderr);
    assert.ok(!/(?:SCRIPT ERROR|Parse Error|ERROR:)/.test(result.stdout+result.stderr),label+' engine errors');
    report.runs.push({label,elapsedMs:Math.round(performance.now()-started),exitCode:0});
    return result.stdout;
  }catch(error){fs.appendFileSync(path.join(out,label+'.log'),String(error.stdout??'')+String(error.stderr??'')+'\n'+String(error));throw error;}
}
try{
  const version=(await run('version',['--version'])).trim();
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
