import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const source=process.argv[2];if(!source||!path.isAbsolute(source))throw Error('An explicit absolute copied-artifact source directory is required');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pinned=['project.godot','scripts/pet_dog.gd','scripts/creation_world.gd','scenes/creation.tscn','world/creation.json'];
const before=Object.fromEntries(pinned.map(file=>[file,hash(path.join(source,file))]));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/mesh-pet-forensic-')),project=path.join(out,'project');
fs.cpSync(source,project,{recursive:true,filter:file=>!file.split(path.sep).includes('.godot')});
fs.copyFileSync(path.join(root,'desktop/godot/shared/scene_mesh_picker.gd'),path.join(project,'forensic_mesh_picker.gd'));
let probe=fs.readFileSync(path.join(root,'tests/mesh-pick/pet-forensic.gd'),'utf8').replace('__INSTANCE__',randomUUID());
fs.writeFileSync(path.join(project,'forensic_probe.gd'),probe);
const engine=await createGodotProbeEnvironment(out);
await engine.run('import',['--path',project,'--editor','--import']);
const stdout=await engine.run('forensic',['--path',project,'--script','res://forensic_probe.gd','--fixed-fps','60','--quit-after','900']);
const line=stdout.split(/\r?\n/).find(line=>line.startsWith('PET_MESH_FORENSIC='));assert.ok(line);
const result=JSON.parse(line.slice('PET_MESH_FORENSIC='.length));
for(const file of pinned){assert.equal(hash(path.join(source,file)),before[file]);assert.equal(hash(path.join(project,file)),before[file]);}
const report={format:'craftmine.mesh-pet-forensic/1',source,sourceHashes:before,sourceUnchanged:true,engine:engine.actualVersion,runs:engine.runs,result,
 scope:'Forensic execution of a copied PET02 artifact with an external observer; not the original model attempt, adoption or pixel/visual acceptance.'};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...result},null,2));
assert.deepEqual(result.failures,[]);assert.ok(result.bodyHits>0);
