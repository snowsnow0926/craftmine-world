// Pin only actual validated renderer output; never resize or synthesize previews.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {sha} from './lib/city-fragments.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=process.argv[2];
if(!directory||!path.isAbsolute(directory))throw Error('Pass an absolute city-fragments-visual report directory');
const report=JSON.parse(fs.readFileSync(path.join(directory,'report.json')));if(report.format!=='craftmine.city-fragment-visual/1'||report.passed!==true||report.errors.length||report.captures.length!==3)throw Error('CITY_PREVIEW_REPORT_NOT_PASSED');
if(sha(fs.readFileSync(path.join(directory,'project/visual.gd')))!==sha(fs.readFileSync(path.join(root,'tests/city-fragments-visual.gd'))))throw Error('CITY_PREVIEW_FIXTURE_CHANGED');
const target=path.join(root,'desktop/godot/components/city-fragments/previews');fs.mkdirSync(target,{recursive:true});
const entries=report.captures.map(capture=>{
 if(!['ward-building','gate-section','ward-street'].includes(capture.slug)||capture.file!==capture.slug+'.png')throw Error('CITY_PREVIEW_IDENTITY_INVALID');
 const bytes=fs.readFileSync(path.join(directory,capture.file)),component=path.join(root,'desktop/godot/components/city-fragments',capture.slug),rendered=path.join(directory,'project/addons','cw.city.'+capture.slug);
 if(sha(bytes)!==capture.sha256||bytes.length>512*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('CITY_PREVIEW_IMAGE_CHANGED');
 const hashes={};for(const [key,file]of Object.entries({geometrySha256:'geometry.glb',wrapperSha256:'fragment.gd',shaderSha256:'city_surface.gdshader'})){hashes[key]=sha(fs.readFileSync(path.join(component,file)));if(hashes[key]!==sha(fs.readFileSync(path.join(rendered,file))))throw Error('CITY_PREVIEW_SOURCE_CHANGED');}
 fs.copyFileSync(path.join(directory,capture.file),path.join(target,capture.file));return {...capture,scope:'isolated-component-render',engine:report.engine,receivingGroundY:0,...hashes};
});
if(new Set(entries.map(e=>e.slug)).size!==3)throw Error('CITY_PREVIEW_DUPLICATE');
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({format:'craftmine.city-fragment-previews/1',modelCalls:0,renderer:'Pinned Godot Web / isolated headless Chromium',inputSimulation:false,pointerLockAttempts:0,entries},null,2)+'\n');
console.log(JSON.stringify({recorded:entries.map(e=>({slug:e.slug,sha256:e.sha256}))}));
