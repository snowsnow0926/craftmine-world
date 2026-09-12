// Compile the actual current inheritance chains using the pinned Godot editor.
// This is fixed-template engineering verification, not simulated model output.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';
const repo=path.resolve(import.meta.dirname,'..');
const cache=path.join(repo,'desktop/build/godot/4.7.2-stable');
const manifest=JSON.parse(fs.readFileSync(path.join(cache,'unpacked-files.json'),'utf8').replace(/^\uFEFF/,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const file of manifest.files){const actual=fs.readFileSync(path.join(cache,'editor',file.path));assert.equal(actual.length,file.bytes);assert.equal(hash(actual),file.sha256);}
const editor=path.join(cache,'editor/Godot_v4.7.2-stable_win64_console.exe');
const directory=fs.mkdtempSync(path.join(repo,'test-results/fb02-creation-base-compile-'));
const report={directory,editor,editorPin:manifest.files,scope:'real pinned headless Godot import and scene load, all delivered creation controller/engine profiles',profiles:[]};
const save=()=>fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
async function run(project,mode){
 const args=['--headless','--path',project,'--rendering-method','gl_compatibility',...(mode==='import'?['--editor','--import','--quit']:['--quit-after','8'])];
 const child=spawn(editor,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 fs.writeFileSync(path.join(project,mode+'.log'),output);
 assert.equal(code,0,mode+' exit');assert.ok(!/SCRIPT ERROR:|Parse Error:|Compile Error:|Failed to load script/.test(output),mode+' emitted a real GDScript error');
 return {mode,exitCode:code,log:path.join(project,mode+'.log')};
}
function inheritance(project){
 const files=fs.readdirSync(project,{recursive:true}).filter(name=>name.endsWith('.gd')&&!name.startsWith('.godot'));
 const collisions=[];const entries=new Map(files.map(name=>[name.replaceAll('\\','/'),fs.readFileSync(path.join(project,name),'utf8')]));
 const own=text=>new Set([...text.matchAll(/^(?:const|var)\s+([A-Za-z_][A-Za-z_0-9]*)/gm)].map(match=>match[1]));
 for(const [file,text] of entries){let current=text;const names=own(text),visited=new Set([file]);
   for(;;){const parent=current.match(/^extends\s+["']res:\/\/([^"']+)["']/m)?.[1];if(!parent)break;
     assert.ok(entries.has(parent),'missing inherited script '+parent);assert.ok(!visited.has(parent),'inheritance cycle');visited.add(parent);
     current=entries.get(parent);for(const name of own(current))if(names.has(name))collisions.push({file,parent,name});
   }
 }
 assert.deepEqual(collisions,[],'fixed GDScript inheritance has duplicate fields');return {scripts:files.length,collisions};
}
try{
 for(const controllerProfile of ['legacy','creation-fixed-controller/1','creation-player-collision/1'])for(const engine of [false,true]){
   const label=controllerProfile.replaceAll('/','-')+(engine?'-engine':'');const project=path.join(directory,label);
   const source=materializeBase({baseId:'creation-sandbox',worldId:'compile-proof',out:project,controllerProfile,...(engine?{enginePerformanceProfile:'engine-monitor/1'}:{})});
   const result={controllerProfile,engine,project,sourceHash:hash(JSON.stringify(source.files)),inheritance:inheritance(project),checks:[]};report.profiles.push(result);save();
   result.checks.push(await run(project,'import'));result.checks.push(await run(project,'scene'));save();console.log('PASS '+label);
 }
 report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;console.error(report.error);}finally{save();console.log(path.join(directory,'report.json'));}
