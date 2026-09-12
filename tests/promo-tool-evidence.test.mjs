import test from 'node:test';import assert from 'node:assert/strict';
import {sourceLibraryCallEvidence} from './helpers/promo-tool-evidence.mjs';
test('real namespaced UiMessage retains original name, arguments and result while classifying library modes',()=>{
 const messages=['search','read','propose'].map((mode,i)=>({id:'new-'+i,role:'tool',toolName:'plugin_craftmine_world_godot_source_library',toolCallId:'call_'+i,toolArgs:{mode},toolResult:{content:[{type:'text',text:'actual result'}]},toolStatus:'success'}));
 const evidence=sourceLibraryCallEvidence(messages);assert.equal(evidence.length,3);assert.deepEqual(evidence.map(v=>v.args.mode),['search','read','propose']);assert.ok(evidence.every(v=>v.toolName==='plugin_craftmine_world_godot_source_library'&&v.canonicalToolName==='godot_source_library'));assert.deepEqual(evidence[0].result,messages[0].toolResult);
});
test('legacy short names work but old messages, other tools and other plugin prefixes do not count',()=>{
 const messages=[{id:'old',toolName:'godot_source_library'},{id:'new',toolName:'godot_source_library'},{id:'foreign',toolName:'plugin_other_godot_source_library'},{id:'patch',toolName:'plugin_craftmine_world_godot_project_patch'},{id:'text',content:'godot_source_library'}];
 assert.deepEqual(sourceLibraryCallEvidence(messages,new Set(['old'])).map(v=>v.id),['new']);
});
