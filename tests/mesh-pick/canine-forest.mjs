// Real imported authored assets + fixed picker, isolated headless scene only.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),root=path.resolve(import.meta.dirname,'../..');
const canine=path.resolve(process.env.CRAFTMINE_CANINE_COMPONENT_ROOT??path.join(root,'desktop/godot/components/canine-visuals'));
const manifestBytes=fs.readFileSync(path.join(canine,'manifest.json')),manifest=JSON.parse(manifestBytes);
const forest=path.join(root,'desktop/godot/components/forest-gateway'),forestManifest=JSON.parse(fs.readFileSync(path.join(forest,'component.json')));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/canine-forest-pick-')),project=path.join(out,'project');fs.mkdirSync(project);
const proofs=[];
for(const item of manifest.items){assert.ok(['dog','pomeranian-white'].includes(item.appearanceKey));const bytes=fs.readFileSync(path.join(canine,item.file));assert.equal(hash(bytes),item.sha256);assert.equal(bytes.length,item.bytes);fs.writeFileSync(path.join(project,item.file),bytes);const sidecar=fs.readFileSync(path.join(canine,item.file+'.import'));fs.writeFileSync(path.join(project,item.file+'.import'),sidecar);proofs.push({file:item.file,sha256:hash(bytes),importSha256:hash(sidecar),triangles:item.triangles});}
for(const item of forestManifest.files){const bytes=fs.readFileSync(path.join(forest,item.path));assert.equal(hash(bytes),item.sha256);const target=path.join(project,'addons',forestManifest.id,item.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
for(const [source,target]of [['desktop/godot/shared/scene_mesh_picker.gd','scene_mesh_picker.gd'],['tests/mesh-pick/canine-forest.gd','probe.gd']])fs.copyFileSync(path.join(root,source),path.join(project,target));
fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Imported canine and forest observation"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
const probe=await createGodotProbeEnvironment(out);await probe.run('import',['--editor','--path',project,'--import']);const log=await probe.run('pick',['--path',project,'--script','res://probe.gd','--quit-after','120'],{timeout:10000});
const line=log.split(/\r?\n/).find(line=>line.startsWith('CANINE_FOREST='));assert.ok(line);const result=JSON.parse(line.slice(14));assert.equal(result.passed,true);
assert.equal(hash(fs.readFileSync(path.join(canine,'manifest.json'))),hash(manifestBytes));for(const proof of proofs){assert.equal(hash(fs.readFileSync(path.join(canine,proof.file))),proof.sha256);assert.equal(hash(fs.readFileSync(path.join(canine,proof.file+'.import'))),proof.importSha256);}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({out,engine:probe.actualVersion,canineManifestSha256:hash(manifestBytes),proofs,result,runs:probe.runs},null,2));console.log(JSON.stringify({out,engine:probe.actualVersion,result}));
