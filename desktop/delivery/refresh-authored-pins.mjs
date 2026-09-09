// Explicit source freeze -> deterministic pins. This never grants a licence.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {git,ordinarySource,readGitSnapshot} from './lib/source-bytes.mjs';

const MANIFESTS='desktop/delivery/base-assets';
const MINING='desktop/godot/bases/mining-sandbox';
const MINING_REVIEWED_TREE='aad4e98123ed171568807e0184b94777318162da';
const SHARED='desktop/godot/shared';
const SHARED_REVIEWED_TREE='e37e26ede930e31c74f8177e30523bf327096a74';
const MATERIALIZERS=new Set(['first-person','side-view','top-down','mining-sandbox'].map(base=>'desktop/godot/bases/'+base+'/tools/new-world.mjs'));
const NEW_AUTHORED=new Set([
  'desktop/godot/bases/first-person/assets/ASSET_MANIFEST.json',
  'desktop/godot/bases/first-person/data/balance/blank_start.tres',
  'desktop/godot/bases/first-person/tools/new-world.mjs',
  'desktop/godot/bases/side-view/assets/ASSET_MANIFEST.json',
  'desktop/godot/bases/side-view/scripts/player/managed_input_source.gd',
  'desktop/godot/bases/side-view/scripts/player/managed_input_source.gd.uid',
  'desktop/godot/shared/standalone_bootstrap.gd',
  'desktop/godot/shared/windows-export.cfg',
]);
export function authored(entry){return entry.author==='Craftmine World project'&&['authored','generated'].includes(entry.origin)&&['project-authored','MIT'].includes(entry.license);}
function newEntry(relative,manifest){
  const dev=/^(tools|tests|docs|delivery|contracts)\//.test(relative)||/\.md$/.test(relative)||relative.startsWith('.');
  return {path:relative,role:/\.gd$/.test(relative)?'source':/\.mjs$/.test(relative)?'tool':/\.tscn$/.test(relative)?'scene':'data',origin:relative.endsWith('.uid')?'generated':'authored',author:'Craftmine World project',version:manifest.baseVersion,license:'project-authored',licenseFile:null,redistribution:'permitted',distribution:dev?['development-only']:['app-bundle','user-export'],outstanding:'Project-authored provenance reviewed; formal per-module licence application remains pending. This pin is not a licence grant.'};
}
export function refreshManifest(manifest,files,{approvedNew=NEW_AUTHORED}={}){
  const result=structuredClone(manifest),seen=new Set();
  function refresh(entry,full){
    const file=files.get(full);if(!file)throw Error('PIN_SOURCE_MISSING:'+full);
    if(authored(entry)){entry.bytes=file.bytes.length;entry.sha256=file.sha256;}
    else if(entry.bytes!==file.bytes.length||entry.sha256!==file.sha256)throw Error('UNREVIEWED_PIN_CHANGED:'+full);
  }
  for(const entry of result.entries||[]){const full=result.sourceDirectory+'/'+entry.path;seen.add(full);refresh(entry,full);}
  for(const entry of result.externalEntries||[])refresh(entry,entry.path);
  for(const notice of result.requiredNotices||[]){
    const owner=(result.entries||[]).find(entry=>result.sourceDirectory+'/'+entry.path===notice.path)||(result.externalEntries||[]).find(entry=>entry.path===notice.path);
    const file=files.get(notice.path);if(!file)throw Error('PIN_NOTICE_MISSING:'+notice.path);
    if(owner&&authored(owner)){notice.bytes=file.bytes.length;notice.sha256=file.sha256;}
    else if((notice.bytes!==undefined&&notice.bytes!==file.bytes.length)||notice.sha256!==file.sha256)throw Error('UNREVIEWED_NOTICE_CHANGED:'+notice.path);
  }
  for(const [full,file]of files){
    if(!full.startsWith(result.sourceDirectory+'/')||seen.has(full))continue;
    if(!approvedNew.has(full))throw Error('NEW_SOURCE_REQUIRES_REVIEW:'+full);
    const entry=newEntry(full.slice(result.sourceDirectory.length+1),result);entry.bytes=file.bytes.length;entry.sha256=file.sha256;result.entries.push(entry);
  }
  result.entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  for(const [entries,prefix]of [[result.entries,result.sourceDirectory+'/'],[result.externalEntries,'']])for(const entry of entries||[]){
    const full=prefix+entry.path;
    if(MATERIALIZERS.has(full)){entry.distribution=['app-bundle'];entry.notes='Trusted world materialization entry point; required in the client, not a runtime game script. Licence status is unchanged.';}
    if(['desktop/godot/web/bridge.js','desktop/godot/web/shell.html'].includes(full))entry.distribution=['app-bundle','user-export'];
    if(full==='desktop/godot/shared/standalone_bootstrap.gd')entry.distribution=['app-bundle','user-export'];
    if(full==='desktop/godot/shared/windows-export.cfg')entry.distribution=['app-bundle'];
  }
  return result;
}

export function refreshAuthoredPins({sourceRoot,sourceCommit,outputRoot,canonicalize=false}){
  sourceRoot=fs.realpathSync(sourceRoot);outputRoot=fs.realpathSync(outputRoot);
  // Prove the entire destination parent is ordinary before creating new files.
  ordinarySource(outputRoot,MANIFESTS+'/bases-first-person.json');
  if(git(sourceRoot,['rev-parse','HEAD']).toString().trim()!==sourceCommit)throw Error('FROZEN_HEAD_MISMATCH');
  if(git(sourceRoot,['status','--porcelain']).toString().trim())throw Error('CLEAN_SOURCE_FREEZE_REQUIRED');
  if(canonicalize&&sourceRoot!==outputRoot)throw Error('CANONICALIZE_REQUIRES_SAME_ROOT');
  const files=readGitSnapshot(sourceRoot,sourceCommit,['desktop/godot']);
  const manifests=fs.readdirSync(path.join(sourceRoot,MANIFESTS)).filter(x=>x.endsWith('.json')).sort();
  const output=new Map();
  for(const name of manifests){
    const manifest=JSON.parse(fs.readFileSync(ordinarySource(sourceRoot,MANIFESTS+'/'+name),'utf8'));
    output.set(name,refreshManifest(manifest,files));
  }
  if(![...output.values()].some(x=>x.sourceDirectory===MINING)){
    if(git(sourceRoot,['rev-parse',sourceCommit+':'+MINING]).toString().trim()!==MINING_REVIEWED_TREE)throw Error('MINING_SOURCE_REVIEW_STALE');
    const base=JSON.parse(files.get(MINING+'/manifest.json').bytes),lock=JSON.parse(files.get('desktop/godot/toolchain.lock.json').bytes);
    const manifest={format:'craftmine.base-assets/1',baseId:'mining-sandbox',displayName:'Finite 2D mining sandbox base',baseVersion:base.baseVersion,engine:{version:lock.version,renderer:base.renderer,language:base.language},sourceDirectory:MINING,rightsStatus:'pending-formal-application',rightsNote:'Existing ASSET_SOURCES.md and docs/REUSE.md document project-authored code and reuse of the project side-view base. No formal licence application or third-party approval is made by this inventory.',entries:[],externalEntries:[],requiredNotices:[]};
    for(const relative of ['desktop/godot/licenses/GODOT_LICENSE.txt','desktop/godot/licenses/GODOT_COPYRIGHT.txt']){const file=files.get(relative);manifest.requiredNotices.push({path:relative,bytes:file.bytes.length,sha256:file.sha256,appliesTo:['app-bundle','user-export']});}
    output.set('bases-mining-sandbox.json',refreshManifest(manifest,files,{approvedNew:new Set([...files.keys()].filter(x=>x.startsWith(MINING+'/')))}));
  }
  if(![...output.values()].some(x=>x.sourceDirectory===SHARED)){
    if(git(sourceRoot,['rev-parse',sourceCommit+':'+SHARED]).toString().trim()!==SHARED_REVIEWED_TREE)throw Error('SHARED_SOURCE_REVIEW_STALE');
    const manifest={format:'craftmine.base-assets/1',baseId:'shared-runtime',displayName:'Authored managed Godot host and runtime protocol',baseVersion:'1',engine:{version:'4.7.2-stable',language:'GDScript and JavaScript'},sourceDirectory:SHARED,rightsStatus:'pending-formal-application',rightsNote:'Project-authored managed protocol, materializers, component installation and captured authored initial states. Content inventory only; formal per-module licence application remains pending.',entries:[],externalEntries:[],requiredNotices:[]};
    const shared=refreshManifest(manifest,files,{approvedNew:new Set([...files.keys()].filter(x=>x.startsWith(SHARED+'/')))});
    for(const entry of shared.entries){
      if(/^(tests|tools)\//.test(entry.path)||entry.path.endsWith('.md'))entry.distribution=['development-only'];
      else entry.distribution=entry.path.endsWith('.gd')?['app-bundle','user-export']:['app-bundle'];
    }
    for(const name of ['base-catalog.json','component-catalog.json','README.md']){
      const relative='desktop/godot/bases/'+name,file=files.get(relative),doc=name.endsWith('.md');
      shared.externalEntries.push({...newEntry(relative,shared),role:doc?'doc':'catalog',origin:doc?'authored':'generated',distribution:doc?['development-only']:['app-bundle'],bytes:file.bytes.length,sha256:file.sha256});
    }
    output.set('shared-runtime.json',shared);
  }
  const canonicalFiles=[...files.values()].filter(x=>x.checkoutDiffers&&([...output.values()].some(m=>(m.entries||[]).some(e=>authored(e)&&m.sourceDirectory+'/'+e.path===x.relative)||(m.externalEntries||[]).some(e=>authored(e)&&e.path===x.relative))));
  // Every input was checked against the immutable Git object before any write.
  if(git(sourceRoot,['rev-parse','HEAD']).toString().trim()!==sourceCommit||git(sourceRoot,['status','--porcelain']).toString().trim())throw Error('SOURCE_CHANGED_DURING_PIN_REVIEW');
  if(canonicalize)for(const file of canonicalFiles){const target=ordinarySource(sourceRoot,file.relative);if(!fs.readFileSync(target).equals(file.rawBytes))throw Error('SOURCE_CHANGED_BEFORE_CANONICALIZE:'+file.relative);fs.writeFileSync(target,file.bytes);}
  const changed=[];
  for(const [name,manifest]of output){
    // Do not change rights/reviewedCommit: content refresh is not rights approval.
    const target=path.join(outputRoot,MANIFESTS,name),body=JSON.stringify(manifest,null,2)+'\n';
    if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('OUTPUT_LINK_DENIED');
    if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==body){fs.writeFileSync(target,body);changed.push(MANIFESTS+'/'+name);}
  }
  return {format:'craftmine.authored-pin-refresh/1',sourceCommit,changed,canonicalized:canonicalize?canonicalFiles.map(x=>x.relative):[],checkoutDrift:canonicalFiles.map(x=>({path:x.relative,checkoutBytes:x.rawBytes.length,gitBytes:x.bytes.length})),rightsChanged:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
  const sourceRoot=value('--source-root'),sourceCommit=value('--source-commit'),outputRoot=value('--output-root');
  if(!sourceRoot||!sourceCommit||!outputRoot)throw Error('Provide --source-root, --source-commit and --output-root; optional --canonicalize');
  console.log(JSON.stringify(refreshAuthoredPins({sourceRoot,sourceCommit,outputRoot,canonicalize:args.includes('--canonicalize')}),null,2));
}
