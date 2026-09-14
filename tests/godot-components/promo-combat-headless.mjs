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
fs.copyFileSync(path.join(root,'tests/godot-components/promo-combat-reopen.gd'),path.join(project,'reopen.gd'));
fs.copyFileSync(path.join(root,'tests/godot-components/promo-combat-conflict-bootstrap.gd'),path.join(project,'conflict-bootstrap.gd'));
fs.copyFileSync(path.join(root,'tests/godot-components/promo-hud-layout.gd'),path.join(project,'hud-layout.gd'));
fs.copyFileSync(path.join(root,'desktop/godot/shared/promo-templates/promo-mainline/source/scripts/monsters/encounter.gd'),path.join(project,'legacy-encounter.gd'));
fs.copyFileSync(path.join(root,'desktop/godot/components/combat-vitals/scripts/combat_vitals.gd'),path.join(project,'legacy-vitals.gd'));
const webExport=process.argv.includes('--web-export');
const env=await createGodotProbeEnvironment(out,webExport?{web:true,threads:true}:{});
await env.run('import',['--path',project,'--editor','--import']);
const run=await env.run('combat',['--path',project,'--script','res://test.gd']);
const result=JSON.parse(run.split(/\r?\n/).find(x=>x.startsWith('PROMO_COMBAT_RESULT=')).slice('PROMO_COMBAT_RESULT='.length));
assert.deepEqual(result.errors,[]);
const reopen=await env.run('cold-reopen',['--path',project,'--script','res://reopen.gd']);
const cold=JSON.parse(reopen.split(/\r?\n/).find(x=>x.startsWith('PROMO_COMBAT_REOPEN=')).slice('PROMO_COMBAT_REOPEN='.length));
const layoutRun=await env.run('hud-layout',['--path',project,'--script','res://hud-layout.gd']);
const layout=JSON.parse(layoutRun.split(/\r?\n/).find(x=>x.startsWith('PROMO_HUD_LAYOUT=')).slice('PROMO_HUD_LAYOUT='.length));
assert.deepEqual(layout.errors,[]);
let expectedConflict;
try{await env.run('expected-conflict',['--path',project,'--script','res://conflict-bootstrap.gd']);assert.fail('Conflicting source must report a Godot check error');}
catch(error){
  const log=fs.readFileSync(path.join(out,'expected-conflict.log'),'utf8');
  assert.match(log,/ERROR: PROMO_EXISTING_COMBAT_ADAPTATION_REQUIRED/);
  assert(!/SCRIPT ERROR|Parse Error/.test(log));
  expectedConflict=JSON.parse(log.split(/\r?\n/).find(x=>x.startsWith('PROMO_EXPECTED_CONFLICT=')).slice('PROMO_EXPECTED_CONFLICT='.length));
  assert.equal(expectedConflict.code,'PROMO_EXISTING_COMBAT_ADAPTATION_REQUIRED');assert.equal(expectedConflict.oldHealth,100);assert.equal(expectedConflict.oldStillPresent,true);assert.equal(expectedConflict.newInputAllowed,false);
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({result,cold,layout,expectedConflict,runs:env.runs},null,2));
assert.equal(cold.error,'');assert.equal(cold.sameComponents,true);assert.equal(cold.samePlayer,true);
if(webExport){
  const host=fs.readFileSync(path.join(root,'vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs'),'utf8');
  const preset=JSON.parse(host.match(/const EXPORT_PRESET: &str = ("(?:\\.|[^"\\])*");/)[1]);
  fs.copyFileSync(path.join(root,'desktop/godot/web/shell.html'),path.join(project,'craftmine_host_shell.html'));
  fs.writeFileSync(path.join(project,'export_presets.cfg'),preset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(env.webTemplate.replaceAll('\\','/'))));
  const web=path.join(out,'web');fs.mkdirSync(web);
  await env.run('web-export',['--path',project,'--export-release','Web',path.join(web,'index.html')],{timeout:120000});
  // Load the actual exported Web PCK in the CPU-only pinned runtime. This checks
  // compiled/remapped scripts and component restoration, not browser rendering.
  const pack=await env.run('web-pack-restore',['--path',project,'--main-pack',path.join(web,'index.pck'),'--script','res://reopen.gd']);
  const packCold=JSON.parse(pack.split(/\r?\n/).find(x=>x.startsWith('PROMO_COMBAT_REOPEN=')).slice('PROMO_COMBAT_REOPEN='.length));
  assert.equal(packCold.error,'');assert.equal(packCold.sameComponents,true);
  // The current product preset keeps source text. Also check binary tokens so
  // future compiled exports cannot accidentally depend on editor source access.
  const compiled=path.join(out,'web-compiled');fs.mkdirSync(compiled);
  const presetFile=path.join(project,'export_presets.cfg');
  fs.writeFileSync(presetFile,fs.readFileSync(presetFile,'utf8').replace('script_export_mode=0','script_export_mode=1'));
  const compiledLog=await env.run('web-export-compiled',['--path',project,'--export-release','Web',path.join(compiled,'index.html')],{timeout:120000});
  assert.match(compiledLog,/\.gdc/,'export actually contains compiled GDScript');
  const binaryPack=await env.run('web-compiled-restore',['--path',project,'--main-pack',path.join(compiled,'index.pck'),'--script','res://reopen.gd']);
  const binaryCold=JSON.parse(binaryPack.split(/\r?\n/).find(x=>x.startsWith('PROMO_COMBAT_REOPEN=')).slice('PROMO_COMBAT_REOPEN='.length));
  assert.equal(binaryCold.error,'');assert.equal(binaryCold.sameComponents,true);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({result,cold,layout,expectedConflict,web:{exported:true,productPresetScriptExportMode:0,productPackRestore:packCold,binaryTokenMode:1,compiledPackRestore:binaryCold,browserRenderingTested:false},runs:env.runs},null,2));
}
console.log(JSON.stringify({passed:true,out,checks:result.checks.length+layout.checks.length+3,layoutChecks:layout.checks.length}));
