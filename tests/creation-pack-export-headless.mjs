// Real Godot exports prove that source pins alone miss editor-time changes.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
const require=createRequire(import.meta.url),{PROTECTED_CREATION_FILES,readPck4,verifyCreationPack}=require('../plugins/craftmine-world/godot-creation-pack.cjs');
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/creation-pack-export-')),report={format:'craftmine.creation-pack-export/1',out,checks:[],cases:[],passed:false};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(name,value)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);};
try{
 const env=await createGodotProbeEnvironment(out,{web:true,threads:true});report.runs=env.runs;
 const host=fs.readFileSync('vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs','utf8'),preset=JSON.parse(host.match(/const EXPORT_PRESET: &str = ("(?:\\.|[^"\\])*");/)[1]);
 for(const variant of ['normal','tool-script','tool-selector']){
  const project=path.join(out,variant),web=path.join(out,variant+'-web');fs.mkdirSync(web);materializeBase({baseId:'creation-sandbox',worldId:'pack-world',out:project});
  fs.copyFileSync('desktop/godot/web/shell.html',path.join(project,'craftmine_host_shell.html'));fs.writeFileSync(path.join(project,'export_presets.cfg'),preset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(env.webTemplate.replaceAll('\\','/'))));
  if(variant!=='normal'){
   const addon=path.join(project,'addons/pack_mutation');fs.mkdirSync(addon,{recursive:true});fs.writeFileSync(path.join(addon,'plugin.cfg'),'[plugin]\nname="Isolated export mutation fixture"\ndescription="Test only"\nauthor="fixture"\nversion="1.0"\nscript="plugin.gd"\n');
   const body=variant==='tool-script'?'var file = FileAccess.open("res://craftmine_shared/base_adapter.gd", FileAccess.READ_WRITE)\n\tfile.seek_end()\n\tfile.store_string("\\n# isolated editor-time mutation\\n")\n\tfile.close()':'ProjectSettings.set_setting("craftmine/runtime/adapter", "res://scripts/forged_adapter.gd")\n\tProjectSettings.save()';
   fs.writeFileSync(path.join(addon,'plugin.gd'),'@tool\nextends EditorPlugin\nfunc _enter_tree() -> void:\n\t'+body+'\n\tprint("PACK_MUTATION_EXECUTED")\n');
   fs.writeFileSync(path.join(project,'scripts/forged_adapter.gd'),'extends RefCounted\n');fs.appendFileSync(path.join(project,'project.godot'),'\n[editor_plugins]\nenabled=PackedStringArray("res://addons/pack_mutation/plugin.cfg")\n');
  }
  const originals=new Map(PROTECTED_CREATION_FILES.map(name=>[name,fs.readFileSync(path.join(project,name))]));const originalProject=fs.readFileSync(path.join(project,'project.godot'));
  const expected=[...originals].map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:hash(bytes)}));
  await env.run(variant+'-import',['--path',project,'--editor','--import']);
  // The production broker rematerializes claimed bytes for export after import.
  for(const [name,bytes]of originals)fs.writeFileSync(path.join(project,name),bytes);fs.writeFileSync(path.join(project,'project.godot'),originalProject);
  check(variant+' protected source bytes match immediately before export',expected.every(file=>hash(fs.readFileSync(path.join(project,file.path)))===file.sha256));
  const log=await env.run(variant+'-export',['--path',project,'--export-release','Web',path.join(web,'index.html')],{timeout:120000});
  const pack=fs.readFileSync(path.join(web,'index.pck')),entry={variant,packSha256:hash(pack),sourcePins:expected};report.cases.push(entry);
  if(variant==='normal'){entry.proof=verifyCreationPack(pack,expected);check('normal real exported PCK retains protected scripts and selectors',entry.proof.files.length===PROTECTED_CREATION_FILES.length);}
  else{
   check(variant+' actual editor plugin ran during export',log.includes('PACK_MUTATION_EXECUTED'));
   entry.actualProtected=[...readPck4(pack).files.values()].filter(file=>PROTECTED_CREATION_FILES.includes(file.path)).map(({path,bytes,sha256})=>({path,bytes,sha256}));
   try{verifyCreationPack(pack,expected);throw Error('FORGED_PACK_ACCEPTED');}catch(error){entry.rejection=String(error.message);assert.match(entry.rejection,variant==='tool-script'?/CREATION_PACK_PROTECTED_MISMATCH/:/CREATION_PACK_SELECTOR_MISMATCH/);}
   check(variant+' real packed mutation refused before runtime checking',true);
  }
 }
 report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,checks:report.checks,error:report.error}));}
