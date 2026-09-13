// Real Rust catalog and managed source transactions. No model or UI launched.
// Pass a built library directory and Core executable from the same candidate.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CoreClient} from '../plugins/craftmine-world/core-client.cjs';
import {createManagedPackageInstaller,createManagedPackageSourceService} from '../plugins/craftmine-world/reuse-service.mjs';
import {createPlayerComponentLibrary} from '../plugins/craftmine-world/player-component-library.cjs';
import {createSourceLibraryService} from '../plugins/craftmine-world/source-library-service.cjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {PET_SOURCE_REQUIREMENTS} from '../desktop/build-builtin-pet-package.mjs';
const [binary,libraryDirectory]=process.argv.slice(2);assert.ok(binary&&libraryDirectory&&path.isAbsolute(binary)&&path.isAbsolute(libraryDirectory));
const root=path.resolve(import.meta.dirname,'..'),hash=b=>createHash('sha256').update(b).digest('hex');
await fs.mkdir(path.join(root,'test-results'),{recursive:true});const out=await fs.mkdtemp(path.join(root,'test-results/player-component-native-'));
const core=new CoreClient(binary,path.join(out,'data')),contexts=Object.fromEntries(['a','b'].map(id=>[id,{projectId:'component-'+id,sessionId:'component-'+id,turnId:'one'}]));
const report={format:'craftmine.player-component-native/1',out,modelCalls:0,engineLaunches:0,uiLaunches:0,ok:false};
let selected='a';
try{
 await core.start();const call=(method,args)=>core.call(method,args,120000);
 const fixtureFiles=[{path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n'},{path:'world.tscn',text:'[gd_scene format=3]\n[node name="World" type="Node3D"]\n[node name="Player" type="CharacterBody3D" parent="."]\n'}];
 for(const [target,source]of PET_SOURCE_REQUIREMENTS)fixtureFiles.push({path:target,text:await fs.readFile(path.join(root,source),'utf8')});
 for(const worldId of ['a','b']){
   await call('world.create',{id:worldId,title:'Player component '+worldId,world:{build:{id:'base-'+worldId,scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
   await call('workspace.open',{context:contexts[worldId],selectedWorld:worldId});await call('godotProject.create',{context:contexts[worldId],worldId,toolCallId:'create',baseBuild:'base-'+worldId,baseId:'creation-sandbox',files:fixtureFiles});await call('content.migrate.apply',{worldId});
 }
 const bind=async(worldId,operationId)=>{const worldRecord=await call('world.read',{id:worldId}),status=await call('content.status',{worldId}),index=await call('godotProject.index',{context:contexts[worldId],worldId,offset:0,limit:1});return {context:contexts[worldId],worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:index.branchId,expectedHeadOid:status.branches.find(b=>b.name==='refs/heads/'+index.branchId).oid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};};
 const install=createManagedPackageInstaller({call,bind,stagingRoot:path.join(out,'installs'),enqueue:async()=>{throw Error('No executor registered in source preflight');}});
 const catalog=JSON.parse(await fs.readFile(path.join(libraryDirectory,'catalog.json'),'utf8')),entry=catalog.entries.find(e=>e.assetId==='cw.module.approved-pomeranian');assert.ok(entry);
 const original=await fs.readFile(path.join(libraryDirectory,entry.file));assert.equal(hash(original),entry.sha256);
 await call('asset.import',{operationId:'seed-approved-pom',sourceRoot:libraryDirectory,sourcePath:path.join(libraryDirectory,entry.file),assetId:entry.assetId,version:entry.version,kind:entry.kind,mediaKind:'package',path:entry.file,mediaType:'application/x-godot-package',displayName:entry.label,source:entry.source,tags:entry.tags});
 const installed=await install({worldId:'a',operationId:'install-approved-pom',archiveBase64:original.toString('base64'),position:{x:2,y:0,z:-4}});assert.equal(installed.status,'source-saved-check-blocked');
 const metadata=await call('godotProject.read',{context:contexts.a,worldId:'a',revision:installed.source.revision,manifestHash:installed.source.manifestHash,path:'craftmine.instances.json',offset:0,limit:16000});
 const oldMap=JSON.parse(metadata.text);assert.equal(oldMap.instances[0].sourceDeclaration.status,'source-declared');
 oldMap.instances[0].sourceDeclaration={format:'craftmine.instance-source-declaration/1',status:'unknown',reason:'ORIGINAL_RESOURCE_MANIFEST_MISSING'};
 await call('godotProject.applyFiles',{context:contexts.a,worldId:'a',toolCallId:'legacy-fixture',revision:installed.source.revision,manifestHash:installed.source.manifestHash,operation:(await bind('a','legacy-fixture')).operation,files:[{path:'craftmine.instances.json',expectedHash:metadata.sha256,bytesBase64:Buffer.from(JSON.stringify(oldMap)).toString('base64')}]});
 const source=createManagedPackageSourceService({call,bind,recoverCatalogDeclaration:true}),listing=await source.listSource({worldId:'a'});assert.equal(listing.items.length,1);
 const create=()=>createPlayerComponentLibrary({call,source,selected:async()=>selected,directory:path.join(out,'publications')});
 const publication={worldId:'a',operationId:'publish-pom-one',revision:listing.revision,manifestHash:listing.manifestHash,nodePath:listing.items[0].nodePath,assetId:'player.component.my-pomeranian',version:1,displayName:'My saved white pomeranian',tags:['pet'],aliases:['博美','同款小麦'],notes:'Player source with follow and wait behavior'};
 const first=await create().publishSource(publication);assert.equal(first.status,'completed');assert.equal(first.requiredSourceFiles,3);assert.deepEqual(await create().publishSource(publication),first);
 const record=await call('asset.read',{assetId:first.assetRef.assetId,version:1});assert.equal(record.version_.source.licenseStatus,'unverified');
 const body=await call('asset.bodyPath',{assetId:first.assetRef.assetId,version:1,path:record.version_.files[0].path}),published=unpackStaticPackage(await fs.readFile(body.blobPath));
 const resource=published.resources[0],models=[...resource.files].filter(([file])=>file.endsWith('.glb'));assert.equal(models.length,1);assert.equal(hash(models[0][1]),'1ab9f354598df75504b061fb06e1e5e386bd59c878afcec3bad8388832dadd0b');
 assert.equal(resource.manifest.content.entry.sourceLineage.resourceRef.assetId,'cw.module.approved-pomeranian');assert.ok([...resource.files.keys()].some(file=>file.endsWith('LICENSE.txt')));
 await assert.rejects(create().publishSource({...publication,operationId:'publish-conflicting-version',displayName:'Changed same version'}),/ASSET_VERSION_CONFLICT/);
 const second=await create().publishSource({...publication,operationId:'publish-pom-two',version:2,displayName:'My saved white pomeranian version 2'});assert.notEqual(first.assetRef.contentHash,second.assetRef.contentHash);
 selected='b';const library=createSourceLibraryService({call,installSource:install,directory:path.join(out,'proposals')});
 const search=await library.tool({mode:'search',query:'同款小麦'},contexts.b,'b','search');assert.ok(search.result.items.some(item=>item.assetId===first.assetRef.assetId));
 const targetBefore=await call('world.read',{id:'b'});
 const placements=[];
 for(const [index,x]of [-3,3].entries()){
   const proposal=await library.tool({mode:'propose',ref:first.assetRef,position:{x,y:0,z:-4}},contexts.b,'b','reuse-'+index);
   const result=await library.installProposal({worldId:'b',proposalId:proposal.proposal.proposalId});assert.equal(result.status,'source-saved-check-blocked');placements.push(result);
 }
 assert.notDeepEqual(placements[0].instanceIds,placements[1].instanceIds);assert.deepEqual(await call('world.read',{id:'b'}),targetBefore);
 report.ok=true;Object.assign(report,{legacyDeclarationRecoveredFromExactCatalog:true,coreSha256:hash(await fs.readFile(binary)),published:first,version2:second.assetRef,placements,modelSha256:hash(models[0][1]),sourceRequirements:resource.manifest.content.entry.sourceRequirements,limit:'Real catalog and source check submission; no executor, adoption, runtime, visual or save/reopen acceptance is claimed.'});
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await core.stop();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,report:path.join(out,'report.json'),error:report.error?.split('\n')[0]}));}
