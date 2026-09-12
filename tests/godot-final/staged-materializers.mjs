// Actual source staging + all five product materializers. No engine or model.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {git,readGitSnapshot} from '../../desktop/delivery/lib/source-bytes.mjs';
import {loadRuntimeDistribution,stageRuntimeSourceSnapshot} from '../../desktop/delivery/lib/runtime-distribution.mjs';
const root=path.resolve(import.meta.dirname,'../..'),commit=git(root,['rev-parse','HEAD']).toString().trim();
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const directory=fs.mkdtempSync(path.join(root,'test-results/staged-materializers-')),destination=path.join(directory,'godot');
const result=stageRuntimeSourceSnapshot(readGitSnapshot(root,commit,['desktop/godot/bases','desktop/godot/shared','desktop/godot/web']),destination,loadRuntimeDistribution(root));
const report={format:'craftmine.staged-materializers/1',commit,directory,distribution:result,cases:[],passed:false};
try{
  const {materializeBase}=await import(pathToFileURL(path.join(destination,'shared/materialize.mjs')).href);
  for(const baseId of ['first-person','top-down','side-view','mining-sandbox','creation-sandbox']){
    assert.ok(fs.existsSync(path.join(destination,'bases',baseId,'tools/new-world.mjs')),'required tool retained');
    const out=path.join(directory,'world-'+baseId),world=materializeBase({baseId,worldId:'staged-'+baseId,template:'blank',out});
    assert.equal(world.baseId,baseId);assert.ok(world.files.length>5);
    assert.ok(fs.existsSync(path.join(out,'project.godot')));assert.ok(fs.existsSync(path.join(out,'craftmine_shared/runtime_bridge.gd')));
    assert.equal(fs.existsSync(path.join(out,'tools/new-world.mjs')),false,'authoring tool is not copied into the player project');
    if(baseId==='creation-sandbox'){
      assert.equal(JSON.parse(fs.readFileSync(path.join(out,'world/creation.json'),'utf8')).format,'craftmine.creation-scene/1');
      assert.ok(fs.existsSync(path.join(out,'scripts/scene_contract.gd')));
      for(const resource of ['base_adapter_legacy.gd','controller_evidence.gd','scene_mesh_picker_v2.gd'])assert.ok(fs.existsSync(path.join(out,'craftmine_shared',resource)),'controller cohort retained in actual staged materializer: '+resource);
      assert.equal(fs.existsSync(path.join(out,'tests')),false);
    }
    report.cases.push({baseId,files:world.files.length,initialState:fs.existsSync(path.join(out,'craftmine_initial_state.json')),passed:true});
  }
  assert.equal(fs.existsSync(path.join(destination,'shared/tests')),false);assert.equal(fs.existsSync(path.join(destination,'shared/tools')),false);
  assert.equal(fs.existsSync(path.join(destination,'web/host.mjs')),false,'obsolete GD0 host is not a product runtime dependency');
  report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,cases:report.cases,evidence:path.join(directory,'report.json'),error:report.error}));}
