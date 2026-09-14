import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const {createSourceLibraryService}=require('../plugins/craftmine-world/source-library-service.cjs');
const manifest=require('../plugins/craftmine-world/manifest.json');
const definition=manifest.contributes.agentTools.find(tool=>tool.name==='godot_source_library');
const {validateToolArguments}=await import(pathToFileURL(path.join(root,'vendor/pi-desktop/packages/agent-runtime/node_modules/@earendil-works/pi-ai/dist/utils/validation.js')).href);
const tool={name:definition.name,description:definition.description,parameters:definition.schema};
const ref={assetId:'fixture.module',version:1,contentHash:'a'.repeat(64)};
const validate=arguments_=>validateToolArguments(tool,{id:'validation-fixture',name:tool.name,arguments:arguments_});

test('actual advertised schema does not offer hidden entity selectors for package declaration errors',()=>{
 const group={mode:'install-group',items:[{ref},{ref}]};
 assert.deepEqual(validate(group),group);
 assert.throws(()=>validate({mode:'install-group',items:[{ref,entity:'first'},{ref,entity:'second'}]}),/additional properties/);
 assert.throws(()=>validate({mode:'install',ref,request:{entity:'first'}}),/Validation failed/);
 assert.match(definition.description,/does not split or select entities inside an archive/);
 assert.match(definition.description,/does not establish installability or runtime compatibility/);
});

test('mode-specific source service rejects using a search query as an install selector before any host call',async()=>{
 let calls=0,installs=0;
 const service=createSourceLibraryService({directory:path.join(root,'test-results/unused-error-guidance'),call:async()=>{calls++;throw Error('UNEXPECTED_HOST_CALL');},installSource:async()=>{installs++;throw Error('UNEXPECTED_INSTALL');},installAuthorSource:async()=>{installs++;throw Error('UNEXPECTED_INSTALL');}});
 await assert.rejects(service.tool({mode:'install',ref,query:'first'},{projectId:'p',sessionId:'s',turnId:'t'},'world','call-query-selector'),/SOURCE_LIBRARY_INVALID_PARAMS/);
 assert.equal(calls,0);assert.equal(installs,0);
});
