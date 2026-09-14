// Build the real plugin in fresh isolated output, then execute its packaged
// guidance route. Host replies are fixtures; no provider, engine or browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);

test('production plugin build includes exact guidance resources and serves a pinned body',async()=>{
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-guidance-package-'));
  try {
    execFileSync(process.execPath,[path.join(root,'desktop/build-world-plugin.mjs'),'--output',output],
      {cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:2*1024*1024});
    for(const file of ['godot-guidance.cjs','godot-view-capture.cjs','godot-build-read-wait.cjs','godot-runtime-diagnostic-log.cjs','creation-application-state.cjs','guidance/catalog.json','guidance/equipment-parameters.md','guidance/creation-sandbox.md','guidance/references/double-press-rule.gd']){
      assert.deepEqual(fs.readFileSync(path.join(output,file)),fs.readFileSync(path.join(root,'plugins/craftmine-world',file)),file);
    }
    assert.equal(fs.existsSync(path.join(output,'guidance/build-catalog.mjs')),false,'developer generator is not a runtime capability');
    assert.equal(typeof require(path.join(output,'godot-executor.cjs')).createGodotExecutor,'function','the packaged executor must load all of its actual runtime dependencies');
    assert.equal(typeof require(path.join(output,'main.cjs')).onLoad,'function','the complete staged plugin must resolve its publication services');
    assert.equal(typeof require(path.join(output,'player-world-library.cjs')).createPlayerWorldLibrary,'function');
    assert.equal(typeof require(path.join(output,'player-component-library.cjs')).createPlayerComponentLibrary,'function');
    const corpus=require(path.join(output,'guidance/catalog.json'));
    const packedSchema=require(path.join(output,'creation-operation-schema.cjs'));
    const packedTool=require(path.join(output,'manifest.json')).contributes.agentTools.find(tool=>tool.name==='creation_operation');
    assert.equal(packedTool.description,packedSchema.CREATION_OPERATION_DESCRIPTION);
    assert.deepEqual(packedTool.schema.properties.request,packedSchema.CREATION_OPERATION_SCHEMA);
    assert.match(packedTool.description,/not an installed asset ID, GLB/);
    assert.match(packedTool.schema.properties.request.oneOf[0].properties.kind.description,/not an AssetRef/);
    const {createWorldTools}=require(path.join(output,'world-tools.cjs'));
    let selectedSkill=corpus.skills[0];
    const calls=[];
    const core={start:async()=>({godotProjects:true}),call:async(method,args)=>{
      calls.push(method);
      if(method==='workspace.open')return {worldId:'packaged-world'};
      if(method==='godotProject.index'){
        const files=selectedSkill.references.filter(ref=>ref.requiredInterface).map(ref=>({path:ref.projectPath,sha256:ref.sha256}));
        const offset=args.offset??0,limit=args.limit??32;
        return {worldId:'packaged-world',revision:1,manifestHash:'a'.repeat(64),
          baseId:selectedSkill.applicability.baseId,baseBuild:selectedSkill.applicability.baseBuild,engineVersion:'4.7.2-stable',
          files:files.slice(offset,offset+limit),totalFiles:files.length,nextOffset:offset+limit<files.length?offset+limit:null};
      }
      if(method==='godotProject.read')return {...args,sha256:selectedSkill.references.find(ref=>ref.projectPath===args.path).sha256};
      throw Error(`Unexpected packaged host call ${method}`);
    }};
    const tools=createWorldTools(core,async()=>({activeWorldId:'packaged-world'}));
    const tool=tools.find(entry=>entry.name==='godot_guidance');assert.ok(tool);
    const context={projectId:'project',sessionId:'session',turnId:'turn',toolCallId:'call',executionId:'execution'};
    const catalog=await tool.execute({mode:'catalog'},context);
    const skill=catalog.skills[0];
    const body=await tool.execute({mode:'read',id:skill.id,version:skill.version,sha256:skill.sha256,
      revision:catalog.source.revision,manifestHash:catalog.source.manifestHash,limit:8000},context);
    assert.equal(body.text,corpus.skills[0].text);assert.equal(body.nextOffset,null);
    const ref=skill.references[0];
    const reference=await tool.execute({mode:'read',id:skill.id,version:skill.version,path:ref.path,sha256:ref.sha256,
      revision:catalog.source.revision,manifestHash:catalog.source.manifestHash,limit:8000},context);
    assert.equal(reference.text,corpus.skills[0].references[0].text);
    selectedSkill=corpus.skills.find(skill=>skill.id==='creation-sandbox.authoring');
    const creationCatalog=await tool.execute({mode:'catalog'},context);
    assert.equal(creationCatalog.skills[0].id,selectedSkill.id);
    const creationBody=await tool.execute({mode:'read',id:selectedSkill.id,version:selectedSkill.version,sha256:selectedSkill.sha256,
      revision:creationCatalog.source.revision,manifestHash:creationCatalog.source.manifestHash,limit:8000},context);
    let creationText=creationBody.text,nextOffset=creationBody.nextOffset;
    while(nextOffset!==null){
      const next=await tool.execute({mode:'read',id:selectedSkill.id,version:selectedSkill.version,sha256:selectedSkill.sha256,
        revision:creationCatalog.source.revision,manifestHash:creationCatalog.source.manifestHash,offset:nextOffset,limit:8000},context);
      assert.ok(next.nextOffset===null||next.nextOffset>nextOffset);
      creationText+=next.text;nextOffset=next.nextOffset;
    }
    assert.equal(creationText,selectedSkill.text);
    const example=selectedSkill.references.find(ref=>ref.path==='examples/double-press-rule.gd');
    const exampleBody=await tool.execute({mode:'read',id:selectedSkill.id,version:selectedSkill.version,sha256:example.sha256,path:example.path,
      revision:creationCatalog.source.revision,manifestHash:creationCatalog.source.manifestHash,limit:8000},context);
    assert.equal(exampleBody.text,fs.readFileSync(path.join(output,'guidance/references/double-press-rule.gd'),'utf8').replace(/\r\n/g,'\n'));
    assert.ok(calls.every(method=>['workspace.open','godotProject.index','godotProject.read'].includes(method)));
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j95sAAAAASUVORK5CYII=','base64'),sha256=createHash('sha256').update(png).digest('hex');
    let captures=0;
    const noCancel={cancelOtherTurns:async()=>assert.fail('A visual read must not cancel other verification or review tasks')};
    const viewTools=createWorldTools(core,async()=>({activeWorldId:'packaged-world'}),()=>false,noCancel,noCancel,{captureView:async input=>{captures++;assert.equal(input.worldId,'packaged-world');assert.deepEqual(input.context,{projectId:'project',sessionId:'session',turnId:'turn'});return {format:'craftmine.godot-view-capture/1',status:'captured',delivery:'image-block-ready',worldId:input.worldId,buildId:input.buildId,instanceId:input.instanceId??'preview-instance',candidateId:input.candidateId??null,scope:input.candidateId?'candidate':'formal',capturedAt:'2026-09-12T00:00:00Z',width:1,height:1,sourceWidth:1,sourceHeight:1,viewWidth:1,viewHeight:1,resized:false,pngBase64:png.toString('base64'),sha256};}});
    const capture=viewTools.find(tool=>tool.name==='godot_view_capture');assert.ok(capture);
    const visual=await capture.execute({buildId:'build',instanceId:'instance'},context);assert.equal(visual.images[0].data,png.toString('base64'));assert.equal(JSON.parse(visual.text).sha256,sha256);assert.equal(visual.text.includes(png.toString('base64')),false);
    const candidate=await capture.execute({buildId:'candidate-build',candidateId:'gcan-'+'a'.repeat(64)},context);assert.equal(JSON.parse(candidate.text).instanceId,'preview-instance');
    await assert.rejects(capture.execute({buildId:'build',instanceId:'instance',worldId:'other'},context));assert.equal(captures,2);
    const childEnv={...process.env,CRAFTMINE_GUIDANCE_PLUGIN_ROOT:output};delete childEnv.NODE_TEST_CONTEXT;
    const engineCases=execFileSync(process.execPath,['--test',path.join(root,'tests/creation-guidance/engine-cohorts.test.mjs')],{cwd:root,encoding:'utf8',windowsHide:true,env:childEnv});
    assert.match(engineCases,/(?:#|ℹ) pass 6/);assert.match(engineCases,/(?:#|ℹ) fail 0/);
  } finally {fs.rmSync(output,{recursive:true,force:true});}
});
