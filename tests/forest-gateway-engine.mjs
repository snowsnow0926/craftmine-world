// Trusted authored scene fixture. No UI, model, live profile, or input events.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
const source=path.resolve('desktop/godot/components/forest-gateway');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'component.json')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync('test-results',{recursive:true});
const out=fs.mkdtempSync(path.resolve('test-results/forest-gateway-engine-'));
const project=path.join(out,'project');fs.mkdirSync(project);
for(const file of manifest.files){
 const bytes=fs.readFileSync(path.join(source,file.path));
 assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);
 const target=path.join(project,'addons',manifest.id,file.path);
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
 if(file.path.endsWith('.tscn')) for(const ref of bytes.toString().matchAll(/path="res:\/\/([^"\n]+)"/g)){
  assert.ok(ref[1].startsWith('addons/'+manifest.id+'/'),'Cross-addon resource reference');
  assert.ok(manifest.files.some(file=>'addons/'+manifest.id+'/'+file.path===ref[1]),'Missing dependency');
 }
}
for(const file of manifest.sourceAssets){
 const bytes=fs.readFileSync(path.join(source,file.path));
 assert.equal(hash(bytes),file.sha256);
 assert.equal(hash(bytes),hash(fs.readFileSync(path.resolve('desktop/godot/components/curated-starter',file.path))));
}
fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Forest gateway static geometry probe"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
fs.writeFileSync(path.join(project,'component.json'),JSON.stringify(manifest));
fs.copyFileSync('tests/forest-gateway-engine.gd',path.join(project,'probe.gd'));
fs.copyFileSync('desktop/godot/shared/scene_mesh_picker.gd',path.join(project,'scene_mesh_picker.gd'));
const probe=await createGodotProbeEnvironment(out);
const report={out,engine:probe.actualVersion,componentSha256:hash(fs.readFileSync(path.join(source,'component.json'))),passed:false,runs:probe.runs};
try{
 await probe.run('import',['--editor','--path',project,'--import'],{timeout:120000});
 const uidPath='scripts/forest_gateway.gd.uid';
 {
  const uid=fs.readFileSync(path.join(project,'addons',manifest.id,uidPath),'utf8');
  assert.match(uid,/^uid:\/\/[a-z0-9]+\s*$/);
  const all=fs.readdirSync(path.resolve('desktop/godot/components/curated-starter/scripts'));
  for(const name of all.filter(name=>name.endsWith('.uid')))assert.notEqual(uid.trim(),fs.readFileSync(path.resolve('desktop/godot/components/curated-starter/scripts',name),'utf8').trim());
  assert.equal(uid.trim(),fs.readFileSync(path.join(source,uidPath),'utf8').trim());
 }
 const output=await probe.run('geometry',['--path',project,'--script','res://probe.gd','--quit-after','120'],{timeout:10000});
 report.geometry=JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('FOREST_GATEWAY=')).slice('FOREST_GATEWAY='.length));
 assert.equal(report.geometry.meshInstances,manifest.geometry.meshInstances);
 assert.equal(report.geometry.triangles,manifest.geometry.triangles);
 assert.equal(report.geometry.collisionTriangles,manifest.collision.triangles);
 assert.equal(report.geometry.surfacesWithLods,0);
 report.passed=true;
}finally{
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({out,passed:report.passed,geometry:report.geometry}));
}
