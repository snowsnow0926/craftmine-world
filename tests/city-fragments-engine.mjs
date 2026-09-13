// Trusted fragment geometry probe in an isolated pinned headless Godot process.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
import {buildCityFragmentPackages} from '../desktop/build-city-fragment-packages.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/city-fragments-engine-')),project=path.join(out,'project');fs.mkdirSync(project);
const fragments=buildCityFragmentPackages({repository:root}),manifests=[];
for(const item of fragments){const resource=unpackStaticPackage(item.bytes).resources[0];for(const [file,bytes]of resource.files){const target=path.join(project,'addons',item.entry.assetId,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}manifests.push(JSON.parse(fs.readFileSync(path.join(root,'desktop/godot/components/city-fragments',item.entry.assetId.slice('cw.city.'.length),'component.json'),'utf8')));}
fs.writeFileSync(path.join(project,'fragments.json'),JSON.stringify(manifests));fs.copyFileSync(path.join(root,'tests/city-fragments-engine.gd'),path.join(project,'probe.gd'));
fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="City fragment collision probe"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
const engine=await createGodotProbeEnvironment(out),report={out,engine:engine.actualVersion,modelCalls:0,uiLaunches:0,passed:false,runs:engine.runs};
try{
 await engine.run('import',['--path',project,'--editor','--import','--quit'],{timeout:120000});
 const output=await engine.run('traverse',['--path',project,'--script','res://probe.gd','--fixed-fps','60'],{timeout:120000});
 report.geometry=JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('CITY_FRAGMENTS=')).slice('CITY_FRAGMENTS='.length));assert.equal(report.geometry.ok,true);report.passed=true;
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,geometry:report.geometry}));}
