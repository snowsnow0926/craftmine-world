import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {register} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readWorldTemplates,materializeWorldTemplate} from '../desktop/godot/shared/world-templates.mjs';
const root=path.resolve(import.meta.dirname,'..');
register(pathToFileURL(path.join(root,'vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs')));
const {initializationFileBatches}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-initialization.ts');
const sha=b=>createHash('sha256').update(b).digest('hex');
const templates=path.join(root,'desktop/godot/shared/promo-templates');

test('four approved source closures create independent identities and authored progress',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-templates-'));
 const before=fs.readFileSync(path.join(templates,'catalog.json'));
 const options=readWorldTemplates();assert.equal(options.length,4);
 for(const option of options){
  const original=JSON.parse(fs.readFileSync(path.join(templates,option.id,'manifest.json')));
  const out=path.join(temp,option.id),worldId='new-'+option.id;
  const materialized=materializeWorldTemplate({template:option.id,worldId,out});
  assert.equal(materialized.worldId,worldId);
  for(const file of materialized.files)assert.equal(sha(fs.readFileSync(path.join(out,file.path))),file.sha256);
  assert.match(fs.readFileSync(path.join(out,'project.godot'),'utf8'),new RegExp('runtime/world_id="'+worldId+'"'));
  const initial=JSON.parse(fs.readFileSync(path.join(out,'craftmine_initial_state.json'))).initialProgress;
  assert.equal(initial.worldId,worldId);
  const expected=JSON.parse(fs.readFileSync(path.join(templates,option.id,'initial.json'))).body;
  assert.deepEqual(initial,{...expected,worldId});
  for(const file of original.files.filter(f=>!['project.godot','world/creation-operations.json','craftmine_initial_state.json'].includes(f.path)))assert.equal(sha(fs.readFileSync(path.join(out,file.path))),file.sha256,'source stays byte-identical: '+file.path);
  if(option.id==='promo-mainline'){assert.equal(initial.components['great-hunt-01'].wins,0);assert.equal(initial.components['great-hunt-01'].attempts,0);}
  if(option.id==='promo-flight'){assert.equal(initial.components['j20-player-aircraft'].aircraft.hasFlown,false);assert.equal(initial.components['j20-player-aircraft'].aircraft.landings,0);}
  if(option.id==='promo-city')assert.deepEqual(initial.inventory,{});
  if(option.id==='promo-rain')assert.equal(initial.components['rain-magic'].casts,0);
  const files=materialized.files.map(file=>({...file,bytesBase64:fs.readFileSync(path.join(out,file.path)).toString('base64')}));
  const batches=initializationFileBatches(files);assert.deepEqual(batches.flat(),files);
  for(const batch of batches)assert.ok(Buffer.byteLength(JSON.stringify(batch))<7*1024*1024);
  assert.throws(()=>materializeWorldTemplate({template:option.id,worldId,out}),/WORLD_TEMPLATE_INVALID/);
 }
 assert.deepEqual(fs.readFileSync(path.join(templates,'catalog.json')),before);
 fs.rmSync(temp,{recursive:true,force:true});
});

test('publication refuses corrupt source before creating output',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-template-corrupt-'));
 fs.cpSync(templates,path.join(temp,'templates'),{recursive:true});
 fs.appendFileSync(path.join(temp,'templates/promo-mainline/source/project.godot'),'corrupt');
 const out=path.join(temp,'new');
 assert.throws(()=>materializeWorldTemplate({root:path.join(temp,'templates'),template:'promo-mainline',worldId:'new-world',out}),/WORLD_TEMPLATE_INVALID/);
 assert.equal(fs.existsSync(out),false);
 fs.rmSync(temp,{recursive:true,force:true});
});
