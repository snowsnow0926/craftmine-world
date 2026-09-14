import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
fs.mkdirSync('test-results',{recursive:true});
const out=fs.mkdtempSync(path.resolve('test-results/companion-world-bounds-')),project=path.join(out,'project');fs.mkdirSync(project);
for(const [name,source] of [
  ['pom-v2.gd','desktop/godot/components/approved-pomeranian/companion.gd'],['pom-v3.gd','desktop/godot/components/approved-pomeranian/companion-v3.gd'],
  ['pet-v2.gd','desktop/godot/components/pet-companion/scripts/pet_companion.gd'],['pet-v3.gd','desktop/godot/components/pet-companion/scripts/pet_companion-v3.gd'],
  ['test.gd','tests/godot-components/companion-world-bounds.gd'],
])fs.copyFileSync(source,path.join(project,name));
fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Companion world bounds fixture"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
const env=await createGodotProbeEnvironment(out),report={out,ok:false,modelCalls:0,gpuCalls:0,productProfilesOpened:0,receipts:[]};
try{
  for(const mode of ['write','read']){
    const output=await env.run(mode,['--path',project,'--script','res://test.gd','--',mode]);
    const line=output.split(/\r?\n/).find(line=>line.startsWith('COMPANION_BOUNDS_TEST='));assert(line);
    const receipt=JSON.parse(line.slice('COMPANION_BOUNDS_TEST='.length));assert(receipt.ok&&receipt.headless);report.receipts.push(receipt);
  }
  report.ok=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{report.runs=env.runs;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,out,error:report.error,checks:report.receipts.map(r=>r.checks.length)}));}
