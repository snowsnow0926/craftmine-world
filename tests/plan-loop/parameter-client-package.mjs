// Read-only package identity checks for the native parameter acceptance runner.
// The ASAR dependency is test tooling only; no external runtime fallback exists.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileHash,resourceInventory,safeResourcePath,verifyRuntimeResources} from '../../desktop/prepare-runtime-resources.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const commit=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export function parameterClientArguments(args){
 const allowed=new Set(['--source-root','--runtime-source','--deps-app','--packaged-root','--expected-commit','--expected-build-manifest-sha256']);const result={};
 for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!allowed.has(key)||Object.hasOwn(result,key)||!value||value.startsWith('--'))throw Error('INVALID_PARAMETER_CLIENT_ARGUMENT');result[key]=value;}
 for(const key of ['--source-root','--deps-app'])if(!result[key])throw Error('MISSING_PARAMETER_CLIENT_ARGUMENT:'+key);
 const packaged=Object.hasOwn(result,'--packaged-root');
 if(packaged){if(result['--runtime-source'])throw Error('PACKAGED_RUNTIME_OVERRIDE_DENIED');if(!commit(result['--expected-commit'])||!hash(result['--expected-build-manifest-sha256']))throw Error('PACKAGE_EXPECTED_IDENTITY_REQUIRED');}
 else if(!result['--runtime-source']||result['--expected-commit']||result['--expected-build-manifest-sha256'])throw Error('INVALID_DEVELOPMENT_CLIENT_ARGUMENT');
 for(const key of ['--source-root','--runtime-source','--deps-app','--packaged-root'])if(result[key]&&!path.isAbsolute(result[key]))throw Error('ABSOLUTE_PARAMETER_CLIENT_PATH_REQUIRED:'+key);
 return {root:path.resolve(result['--source-root']),deps:path.resolve(result['--deps-app']),runtime:packaged?null:path.resolve(result['--runtime-source']),packaged:packaged?path.resolve(result['--packaged-root']):null,expectedCommit:result['--expected-commit'],expectedManifestHash:result['--expected-build-manifest-sha256']};
}
function ordinary(file,directory=false){
 const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile())||(!directory&&stat.nlink!==1))throw Error('PACKAGE_NON_REGULAR_PATH:'+file);
 for(let parent=path.dirname(file);;parent=path.dirname(parent)){const item=fs.lstatSync(parent);if(item.isSymbolicLink()||!item.isDirectory())throw Error('PACKAGE_PARENT_LINK_DENIED');if(path.dirname(parent)===parent)break;}
 return stat;
}
function json(file,limit=16*1024*1024){const stat=ordinary(file);if(stat.size>limit)throw Error('PACKAGE_METADATA_TOO_LARGE');return JSON.parse(fs.readFileSync(file,'utf8'));}
function entries(value){
 if(!Array.isArray(value)||!value.length||value.length>10000)throw Error('PACKAGE_INVENTORY_INVALID');const seen=new Set();
 for(const entry of value){safeResourcePath(entry.path);if(seen.has(entry.path.toLowerCase())||!hash(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)throw Error('PACKAGE_INVENTORY_INVALID');seen.add(entry.path.toLowerCase());}return value;
}
export async function inspectParameterPackage({packaged,expectedCommit,expectedManifestHash,asar}){
 if(!path.isAbsolute(packaged)||!commit(expectedCommit)||!hash(expectedManifestHash))throw Error('PACKAGE_EXPECTED_IDENTITY_REQUIRED');ordinary(packaged,true);
 const resources=path.join(packaged,'resources'),manifestFile=path.join(resources,'source/build-manifest.json');
 const manifest=json(manifestFile);if(await fileHash(manifestFile)!==expectedManifestHash)throw Error('PACKAGE_BUILD_MANIFEST_HASH_MISMATCH');
 if(manifest.format!=='craftmine.build/1'||manifest.commit!==expectedCommit)throw Error('PACKAGE_SOURCE_COMMIT_MISMATCH');
 const archive=path.join(resources,'app.asar');ordinary(archive);
 const clientFiles=entries(manifest.clientFiles),pluginFiles=entries(manifest.pluginFiles),artifacts=entries(manifest.artifacts);
 const readApp=relative=>{safeResourcePath(relative);return asar.extractFile(archive,path.normalize(relative));};
 const metadata=JSON.parse(readApp('package.json').toString('utf8'));if(!['out/main/index.js','./out/main/index.js'].includes(metadata.main))throw Error('PACKAGE_MAIN_ENTRY_MISMATCH');
 for(const file of clientFiles){const bytes=readApp('out/'+file.path);if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('PACKAGE_CLIENT_HASH_MISMATCH:'+file.path);}
 const main=readApp('out/main/index.js'),preload=readApp('out/preload/craftmine-headless.cjs');
 for(const relative of ['main/index.js','preload/craftmine-headless.cjs'])if(!clientFiles.some(f=>f.path===relative))throw Error('PACKAGE_CLIENT_GUARD_UNBOUND');
 for(const marker of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance','targetFeedback.describe'])if(!main.includes(Buffer.from(marker)))throw Error('PACKAGE_ISOLATION_OR_FEATURE_MISSING:'+marker);
 if(!preload.includes(Buffer.from('requestPointerLock')))throw Error('PACKAGE_INPUT_GUARD_MISSING');
 if(JSON.stringify(await resourceInventory(path.join(resources,'plugins/craftmine.world')))!==JSON.stringify(pluginFiles))throw Error('PACKAGE_PLUGIN_HASH_MISMATCH');
 const mappings=[['vendor/pi-desktop/target/release/craftmine-core.exe','bin/craftmine-core.exe'],['vendor/pi-desktop/target/release/pi-desktop-host-core.exe','bin/pi-desktop-host-core.exe'],['vendor/pi-desktop/packages/agent-runtime/dist-bundle/sidecar.js','agent-runtime/sidecar.js'],['vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world/manifest.json','plugins/craftmine.world/manifest.json'],['desktop/build/CraftmineWorld-source.zip','source/CraftmineWorld-source.zip']];
 for(const [input,relative]of mappings){const record=artifacts.find(f=>f.path===input),file=path.join(resources,relative),stat=ordinary(file);if(!record||record.bytes!==stat.size||await fileHash(file)!==record.sha256)throw Error('PACKAGE_BINARY_OR_SOURCE_HASH_MISMATCH:'+relative);}
 if(manifest.sourceArchiveHash!==artifacts.find(f=>f.path==='desktop/build/CraftmineWorld-source.zip').sha256)throw Error('PACKAGE_SOURCE_ARCHIVE_BINDING_MISMATCH');
 const runtime=await verifyRuntimeResources(resources,expectedCommit,{packaged:true});
 if(runtime.filesDigest!==manifest.runtime?.filesDigest||await fileHash(path.join(resources,'runtime-resources.json'))!==manifest.runtime?.manifestSha256)throw Error('PACKAGE_RUNTIME_MANIFEST_MISMATCH');
 const executable=path.join(packaged,'Craftmine World.exe');ordinary(executable);
 return {main,preload,executable,arguments:[],cwd:packaged,core:path.join(resources,'bin/craftmine-core.exe'),host:path.join(resources,'bin/pi-desktop-host-core.exe'),bases:path.join(resources,'godot'),identity:{mode:'packaged',packaged,commit:expectedCommit,buildManifestSha256:expectedManifestHash,sourceArchiveHash:manifest.sourceArchiveHash,appVersion:metadata.version,executableSha256:await fileHash(executable),asarSha256:await fileHash(archive),mainSha256:sha(main),pluginSha256:await fileHash(path.join(resources,'plugins/craftmine.world/views/view.js')),coreSha256:await fileHash(path.join(resources,'bin/craftmine-core.exe')),hostSha256:await fileHash(path.join(resources,'bin/pi-desktop-host-core.exe')),runtimeSourceCommit:runtime.sourceCommit,runtimeFilesDigest:runtime.filesDigest}};
}
export function isolatedParameterEnvironment(inherited,{out,profile,token,core,host,bases}){
 const env={...inherited};for(const key of Object.keys(env))if(/^(CRAFTMINE_|PI_DESKTOP_|ELECTRON_|NODE_OPTIONS$)/.test(key))delete env[key];
 return {...env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token,CRAFTMINE_CORE_BIN:core,PI_DESKTOP_HOST_BIN:host,CRAFTMINE_GODOT_BASES:bases};
}
