import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';import {createGodotProbeEnvironment,sha256} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'../..'),outputRoot=process.env.CRAFTMINE_ENGINE_BRIDGE_OUTPUT_ROOT??path.join(root,'test-results');
assert.ok(path.isAbsolute(outputRoot),'Absolute isolated output root required');fs.mkdirSync(outputRoot,{recursive:true});const out=fs.mkdtempSync(path.join(outputRoot,'engine-bridge-native-'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');const report={format:'craftmine.engine-bridge-native-test/1',passed:false,out,scope:'Actual opt-in creation world/autoload/base adapter/load/bridge and engine collector; test-authored host identities, not host/source authority or player acceptance'};
try{
 const engine=await createGodotProbeEnvironment(out);report.engineSha256=await sha256(engine.executable);report.engineVersion=engine.actualVersion;
 const project=path.join(out,'project');report.sourceManifest=materializeBase({baseId:'creation-sandbox',worldId:'bridge-engine-world',out:project,enginePerformanceProfile:'engine-monitor/1'});
 const fixture=fs.readFileSync(path.join(root,'tests/godot-agent/fixtures/engine-performance-bridge.gd'));report.fixtureSha256=hash(fixture);fs.writeFileSync(path.join(project,'engine_bridge_probe.gd'),fixture);
 const config=fs.readFileSync(path.join(project,'project.godot'),'utf8');fs.writeFileSync(path.join(project,'project.godot'),config.replace('[autoload]','[autoload]\nEngineProbe="*res://engine_bridge_probe.gd"'));
 await engine.run('bridge-import',['--headless','--path',project,'--editor','--import']);
 const env={};for(const key of ['SystemRoot','WINDIR','COMSPEC'])if(process.env[key])env[key]=process.env[key];env.PATH=path.join(process.env.SystemRoot,'System32');for(const key of ['APPDATA','LOCALAPPDATA','USERPROFILE','TEMP','TMP'])env[key]=path.join(out,'profile',key.toLowerCase());
 const args=['--headless','--language','en','--path',project];report.args=args;
 const child=spawn(engine.executable,args,{cwd:out,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const timer=setTimeout(()=>child.kill(),30000);
 report.exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));}).finally(()=>clearTimeout(timer));
 fs.writeFileSync(path.join(out,'stdout.log'),stdout);fs.writeFileSync(path.join(out,'stderr.log'),stderr);report.stdoutSha256=hash(stdout);report.stderrSha256=hash(stderr);
 assert.equal(report.exit.code,0,stderr);assert.ok(!/SCRIPT ERROR|Parse Error|ERROR:/.test(stdout+stderr),stderr);
 const line=stdout.split(/\r?\n/).find(line=>line.startsWith('ENGINE_BRIDGE_RESULT='));assert.ok(line,'Bridge result missing');report.result=JSON.parse(line.slice('ENGINE_BRIDGE_RESULT='.length));
 assert.equal(report.result.snapshotUnchanged,true);assert.ok(report.result.checks.length>=13);report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
