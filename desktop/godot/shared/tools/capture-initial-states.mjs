// Refresh authored starting states using the fixed engine in a private headless profile.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {materializeBase} from '../materialize.mjs';
import {createGodotProbeEnvironment} from '../../toolchain.mjs';
const root=path.resolve(import.meta.dirname,'../../../..');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const directory=fs.mkdtempSync(path.join(root,'test-results/initial-states-'));
const output=path.resolve(import.meta.dirname,'../initial-states');fs.mkdirSync(output,{recursive:true});
const engine=await createGodotProbeEnvironment(directory);
const captureScript=worldId=>`extends SceneTree
func _initialize() -> void:
    _capture.call_deferred()
func _capture() -> void:
    change_scene_to_file(ProjectSettings.get_setting("application/run/main_scene"))
    var bridge = root.get_node("CraftmineRuntime")
    for frame in range(600):
        await process_frame
        if bridge.initialized:
            var result = await bridge.handle_request({"worldId":"${worldId}","buildId":"initial-state-capture","instanceId":"initial-state-capture","op":"load","args":{}})
            if result.has("error"):
                push_error(str(result.error))
                quit(1)
                return
            print("CRAFTMINE_INITIAL_STATE:" + JSON.stringify(result.result.snapshot.state))
            quit(0)
            return
    push_error("Authored base did not initialize")
    quit(1)
`;
const report={format:'craftmine.authored-initial-states/1',engine:engine.actualVersion,runs:engine.runs,states:[]};
const requested=process.env.CRAFTMINE_CAPTURE_BASES?.split(',');
for(const [baseId,templates] of Object.entries({'creation-sandbox':['blank'],'first-person':['blank','training-range'],'top-down':['blank','town'],'side-view':['blank','ruins'],'mining-sandbox':['blank','mine-camp']})){
  if(requested&&!requested.includes(baseId))continue;
  for(const template of templates){
    const worldId=`authored-${baseId}-${template}`;
    const project=path.join(directory,baseId+'-'+template);
    const manifest=materializeBase({baseId,worldId,template,out:project});
    fs.writeFileSync(path.join(project,'capture_initial.gd'),captureScript(worldId));
    await engine.run(baseId+'-'+template+'-import',['--editor','--path',project,'--import'],{timeout:120000});
    const text=await engine.run(baseId+'-'+template+'-capture',['--path',project,'--script','res://capture_initial.gd']);
    const line=text.split(/\r?\n/).find(line=>line.startsWith('CRAFTMINE_INITIAL_STATE:'));
    if(!line)throw Error('Initial state was not captured: '+baseId+'/'+template);
    const snapshot=JSON.parse(line.slice('CRAFTMINE_INITIAL_STATE:'.length));
    if(snapshot.worldId!==worldId||snapshot.body.worldId!==worldId)throw Error('Initial state identity mismatch');
    const record={format:'craftmine.authored-initial-state/1',baseId,template,worldId,engine:engine.actualVersion,
      sourceDigest:createHash('sha256').update(JSON.stringify(manifest.files.filter(file=>file.path!=='craftmine_initial_state.json'))).digest('hex'),snapshot};
    fs.writeFileSync(path.join(output,baseId+'-'+template+'.json'),JSON.stringify(record,null,2)+'\n');
    report.states.push({baseId,template,sourceDigest:record.sourceDigest});
    console.log('Captured '+baseId+'/'+template);
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  }
}
console.log('Evidence: '+directory);
