import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {packStaticPackage,unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {contentHash,validatePath} from '../plugins/craftmine-world/package-format.mjs';
import {buildBuiltinPetPackage} from './build-builtin-pet-package.mjs';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(yes,code)=>{if(!yes)throw Error(code);};

export function buildBuiltinSourceLibrary({output,componentRoot=path.join(repository,'desktop/godot/components/curated-starter')}){
  check(typeof output==='string'&&path.isAbsolute(output),'BUILTIN_OUTPUT_REQUIRED');
  const root=fs.realpathSync(componentRoot),inventory=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  check(inventory.format==='craftmine.curated-source-manifest/1'&&Array.isArray(inventory.items)&&inventory.items.length<=64,'CURATED_MANIFEST_INVALID');
  const entries=[],packages=[],seen=new Set();
  for(const item of inventory.items){
    check(/^cw\.[a-z0-9._-]+$/.test(item.id)&&!seen.has(item.id),'CURATED_ID_INVALID');seen.add(item.id);
    check(item.kind==='object'&&item.version==='1.0.0','CURATED_VERSION_UNSUPPORTED');
    const source=inventory.sources[item.source];check(source?.license==='CC0-1.0'&&/^https:\/\/kenney\.nl\/assets\//.test(source.url),'CURATED_SOURCE_INVALID');
    const files={};
    for(const entry of item.files){
      validatePath(entry.path);check(!Object.hasOwn(files,entry.path),'CURATED_FILE_DUPLICATE');
      const filename=path.resolve(root,entry.path),relative=path.relative(root,fs.realpathSync(filename));
      check(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&fs.lstatSync(filename).isFile(),'CURATED_FILE_OUTSIDE_ROOT');
      const bytes=fs.readFileSync(filename);check(bytes.length===entry.bytes&&sha(bytes)===entry.sha256,'CURATED_FILE_HASH_MISMATCH');files[entry.path]=bytes;
    }
    check(files[item.entryScene]&&files[source.licenseFile]&&sha(files[source.licenseFile])===source.licenseSha256,'CURATED_ENTRY_OR_LICENSE_MISSING');
    const content={assetId:item.id,version:1,kind:'object',files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:sha(bytes)})),dependencies:[],
      entry:{entities:['root'],sceneInstall:{mode:'instance',sceneFile:item.entryScene,identityField:'entity_id',identityType:'String'},description:item.usage,label:item.label,
        placement:{anchor:item.placement.anchor,dimensionsMm:item.placement.dimensionsMm},geometry:item.geometry,collision:{mode:item.collision.mode,triangles:item.collision.triangles},
        visualOnlyScene:item.visualScene,...(item.importConfiguration?{importConfiguration:item.importConfiguration}:{})},
      interfaces:{},compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},state:{kind:'static-no-gameplay-state'},
      licenses:{author:'Kenney',license:'CC0-1.0',sourceUrl:source.url,sourceVersion:source.version,sourceArchiveSha256:source.archiveSha256,wrapperLicense:'MIT'}};
    const manifest={format:'craftmine.resource/1',content,contentHash:contentHash(content)};
    const bytes=packStaticPackage({root:{id:item.id,version:1},resources:[{manifest,files}]});
    const verified=unpackStaticPackage(bytes);check(verified.resources.length===1&&verified.resources[0].contentHash===manifest.contentHash,'BUILTIN_PACKAGE_ROUNDTRIP_FAILED');
    const file=item.id+'.zip';packages.push({file,bytes});
    entries.push({assetId:item.id,version:1,kind:'object',file,bytes:bytes.length,sha256:sha(bytes),rootContentHash:manifest.contentHash,label:item.label,
      tags:['builtin','prefab',item.source,...item.tags],source:{origin:source.url,author:'Kenney',license:'CC0-1.0',licenseStatus:'verified'}});
  }
  const environmentRoot=path.join(repository,'desktop/godot/components/natural-daylight');
  const environmentManifest=JSON.parse(fs.readFileSync(path.join(environmentRoot,'component.json'),'utf8'));
  const environmentFiles={};
  for(const entry of environmentManifest.files){
    validatePath(entry.path);const bytes=fs.readFileSync(path.join(environmentRoot,entry.path));
    check(bytes.length===entry.bytes&&sha(bytes)===entry.sha256,'ENVIRONMENT_FILE_HASH_MISMATCH');environmentFiles[entry.path]=bytes;
  }
  const environmentId='cw.environment.natural-daylight';
  const environmentContent={assetId:environmentId,version:1,kind:'module',files:environmentManifest.files,dependencies:[],
    entry:{entities:['preset'],sceneInstall:{mode:'script-node',script:'creation_sandbox_preset.gd',nodeType:'Node3D',identityField:'entity_id',identityType:'String'},
      sourceRequirements:[{path:'scripts/creation_world.gd',sha256:sha(fs.readFileSync(path.join(repository,'desktop/godot/bases/creation-sandbox/scripts/creation_world.gd')))}],
      description:'主动采用后将标准造物世界的天空、地面和边界调为自然日光与草土色。保留几何、碰撞、昼夜和存档；自定义底座源码需另行接入。'},
    interfaces:{},compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},state:{kind:'appearance-only-no-player-state'},licenses:{author:'Craftmine World contributors',license:'MIT'}};
  const environmentHash=contentHash(environmentContent);
  const environmentBytes=packStaticPackage({root:{id:environmentId,version:1},resources:[{manifest:{format:'craftmine.resource/1',content:environmentContent,contentHash:environmentHash},files:environmentFiles}]});
  unpackStaticPackage(environmentBytes);
  packages.push({file:environmentId+'.zip',bytes:environmentBytes});
  entries.push({assetId:environmentId,version:1,kind:'module',file:environmentId+'.zip',bytes:environmentBytes.length,sha256:sha(environmentBytes),rootContentHash:environmentHash,label:'自然日光与草土地面',
    tags:['builtin','prefab','environment','环境','天空','日光','草地'],source:{origin:'Craftmine World natural-daylight 1.0.0',author:'Craftmine World contributors',license:'MIT',licenseStatus:'verified'}});
  const sceneRoot=path.join(repository,'desktop/godot/components/forest-gateway');
  const sceneManifest=JSON.parse(fs.readFileSync(path.join(sceneRoot,'component.json'),'utf8'));
  check(sceneManifest.id==='cw.scene.forest-gateway'&&sceneManifest.kind==='scene'&&sceneManifest.version==='1.0.0','BUILTIN_SCENE_DECLARATION_INVALID');
  const sceneFiles={};
  for(const entry of sceneManifest.files){
    validatePath(entry.path);const filename=path.join(sceneRoot,entry.path),relative=path.relative(fs.realpathSync(sceneRoot),fs.realpathSync(filename));
    check(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'BUILTIN_SCENE_FILE_OUTSIDE_ROOT');
    const bytes=fs.readFileSync(filename);check(bytes.length===entry.bytes&&sha(bytes)===entry.sha256,'BUILTIN_SCENE_FILE_HASH_MISMATCH');sceneFiles[entry.path]=bytes;
  }
  check(sceneFiles[sceneManifest.entryScene]&&sceneFiles[sceneManifest.composition.licenseFile],'BUILTIN_SCENE_ENTRY_OR_LICENSE_MISSING');
  for(const origin of Object.values(sceneManifest.sources))check(sceneFiles[origin.licenseFile]&&sha(sceneFiles[origin.licenseFile])===origin.licenseSha256,'BUILTIN_SCENE_LICENSE_MISMATCH');
  const sceneContent={assetId:sceneManifest.id,version:1,kind:'scene',files:sceneManifest.files,dependencies:[],
    entry:{entities:['scene'],sceneInstall:{mode:'instance',sceneFile:sceneManifest.entryScene,identityField:sceneManifest.identityField,identityType:sceneManifest.identityType},
      description:sceneManifest.usage,style:'stylized-low-poly',placement:{anchor:sceneManifest.placement.anchor,dimensionsMm:sceneManifest.placement.dimensionsMm},
      geometry:Object.fromEntries(['meshInstances','triangles','trees','treeSilhouettes','animations','skins'].map(key=>[key,sceneManifest.geometry[key]])),
      sceneContract:{forward:sceneManifest.sceneContract.forward,
        pathStartMm:sceneManifest.sceneContract.pathStart.map(value=>Math.round(value*1000)),pathEndMm:sceneManifest.sceneContract.pathEnd.map(value=>Math.round(value*1000)),
        recommendedCameraMm:sceneManifest.sceneContract.recommendedCamera.map(value=>Math.round(value*1000)),recommendedLookAtMm:sceneManifest.sceneContract.recommendedLookAt.map(value=>Math.round(value*1000)),
        approachClearWidthMm:Math.round(sceneManifest.sceneContract.approachClearWidth*1000),gateClearWidthMm:Math.round(sceneManifest.sceneContract.gateClearWidth*1000)},
      recommendedLighting:sceneManifest.recommendedLighting},
    interfaces:{},compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},state:{kind:'static-scene-no-player-state'},
    licenses:{composition:sceneManifest.composition,sources:sceneManifest.sources}};
  const sceneHash=contentHash(sceneContent),sceneBytes=packStaticPackage({root:{id:sceneManifest.id,version:1},resources:[{manifest:{format:'craftmine.resource/1',content:sceneContent,contentHash:sceneHash},files:sceneFiles}]});
  unpackStaticPackage(sceneBytes);packages.push({file:sceneManifest.id+'.zip',bytes:sceneBytes});
  entries.push({assetId:sceneManifest.id,version:1,kind:'scene',file:sceneManifest.id+'.zip',bytes:sceneBytes.length,sha256:sha(sceneBytes),rootContentHash:sceneHash,label:sceneManifest.label,
    tags:['builtin','prefab','scene','森林','风格化',...sceneManifest.tags],source:{origin:'Craftmine World forest-gateway 1.0.0',author:'Craftmine World contributors / Kenney',license:'MIT AND CC0-1.0',licenseStatus:'verified'}});
  const pet=buildBuiltinPetPackage({repository});
  packages.push({file:pet.file,bytes:pet.bytes});entries.push(pet.entry);
  // Stage only after every resource and archive has passed validation.
  fs.mkdirSync(output,{recursive:true});
  for(const item of packages)fs.writeFileSync(path.join(output,item.file),item.bytes);
  const catalog={format:'craftmine.builtin-source-library/1',version:1,entries};
  fs.writeFileSync(path.join(output,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
  return catalog;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=process.argv[2];const componentRoot=process.argv[3];
  const catalog=buildBuiltinSourceLibrary({output:path.resolve(output??'desktop/build/builtin-source-library'),...(componentRoot?{componentRoot:path.resolve(componentRoot)}:{})});
  console.log(JSON.stringify({entries:catalog.entries.length,totalBytes:catalog.entries.reduce((sum,item)=>sum+item.bytes,0),output}));
}
