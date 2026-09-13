import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
import {APPROVED_POMERANIAN_SHA256} from '../../desktop/build-approved-pomeranian-package.mjs';

fs.mkdirSync('test-results',{recursive:true});
const out=fs.mkdtempSync(path.resolve('test-results/approved-pomeranian-')),project=path.join(out,'project');
fs.mkdirSync(project);
for(const name of ['model.glb','companion.gd'])fs.copyFileSync(path.resolve('desktop/godot/components/approved-pomeranian',name),path.join(project,name));
assert.equal(createHash('sha256').update(fs.readFileSync(path.join(project,'model.glb'))).digest('hex'),APPROVED_POMERANIAN_SHA256);
fs.writeFileSync(path.join(project,'model.glb.import'),'[remap]\nimporter="scene"\ntype="PackedScene"\n\n[params]\nmeshes/generate_lods=false\n');
fs.copyFileSync('tests/godot-components/approved-pomeranian.gd',path.join(project,'test.gd'));
fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Accepted Pom independent fixture"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
const env=await createGodotProbeEnvironment(out),report={format:'craftmine.approved-pomeranian-test/1',out,engine:env.actualVersion,modelCalls:0,productProfilesOpened:0,playerAcceptance:false,ok:false};
try{
  await env.run('import',['--editor','--path',project,'--import']);
  const output=await env.run('behavior',['--path',project,'--fixed-fps','60','--script','res://test.gd']);
  const line=output.split(/\r?\n/).find(value=>value.startsWith('APPROVED_POMERANIAN_TEST='));assert.ok(line);
  report.receipt=JSON.parse(line.slice('APPROVED_POMERANIAN_TEST='.length));
  assert.equal(report.receipt.ok,true);assert.equal(report.receipt.headless,true);assert.ok(report.receipt.checks.length>=18);report.ok=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{report.runs=env.runs;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,report:path.join(out,'report.json'),checks:report.receipt?.checks.length,error:report.error?.split('\n')[0]}));}
