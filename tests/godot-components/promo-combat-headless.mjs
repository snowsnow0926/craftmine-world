import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildPromoCombatPackages} from '../../desktop/build-promo-combat-packages.mjs';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/promo-combat-'));
const project=path.join(out,'project');
fs.cpSync(path.join(root,'desktop/godot/bases/creation-sandbox'),project,{recursive:true,filter:p=>path.basename(p)!=='.godot'});
for(const built of buildPromoCombatPackages({repository:root})){
  const archive=unpackStaticPackage(built.bytes);
  for(const resource of archive.resources)for(const [name,bytes] of resource.files){
    const target=path.join(project,'addons',resource.manifest.content.assetId,name);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
  }
}
fs.copyFileSync(path.join(root,'desktop/godot/shared/component_state.gd'),path.join(project,'component_state.gd'));
fs.copyFileSync(path.join(root,'tests/godot-components/promo-combat.gd'),path.join(project,'test.gd'));
const env=await createGodotProbeEnvironment(out);
await env.run('import',['--path',project,'--editor','--import']);
const run=await env.run('combat',['--path',project,'--script','res://test.gd']);
const result=JSON.parse(run.split(/\r?\n/).find(x=>x.startsWith('PROMO_COMBAT_RESULT=')).slice('PROMO_COMBAT_RESULT='.length));
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({result,runs:env.runs},null,2));
assert.deepEqual(result.errors,[]);
console.log(JSON.stringify({passed:true,out,checks:result.checks.length}));
