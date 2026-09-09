import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileHash,resourceInventory,verifyRuntimeResources} from './prepare-runtime-resources.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=fileHash;
const relative=file=>path.relative(root,file).replaceAll('\\','/');
const exe=(command,args)=>execFileSync(command,args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const build=path.join(root,'desktop/build');
const mode=process.argv[2];
if(mode==='manifest'){
  const notices=path.join(build,'third-party'),inventory=[];await fs.mkdir(notices,{recursive:true});
  const store=path.join(root,'vendor/pi-desktop/node_modules/.pnpm');
  for(const entry of(await fs.readdir(store)).sort()){
    const modules=path.join(store,entry,'node_modules');let names;try{names=await fs.readdir(modules);}catch{continue;}
    const packages=[];for(const name of names){const p=path.join(modules,name);if(name.startsWith('@')){for(const child of await fs.readdir(p))packages.push(path.join(p,child));}else packages.push(p);}
    for(const p of packages){if((await fs.lstat(p)).isSymbolicLink())continue;let metadata;try{metadata=JSON.parse(await fs.readFile(path.join(p,'package.json'),'utf8'));}catch{continue;}
      const key=`${metadata.name}@${metadata.version}`;if(inventory.some(item=>item.package===key))continue;
      const licenseFiles=[];for(const name of(await fs.readdir(p)).sort())if(/^(?:licen[sc]e|notice|copying)(?:\.|$)/i.test(name)){
        const file=path.join(p,name),info=await fs.stat(file);if(!info.isFile()||info.size>1024*1024)continue;
        const destination=`${key.replace(/[^a-zA-Z0-9@._-]/g,'_')}-${name}`;await fs.copyFile(file,path.join(notices,destination));licenseFiles.push(destination);
      }
      inventory.push({package:key,license:typeof metadata.license==='string'?metadata.license:'see package source',licenseFiles});
    }
  }
  await fs.writeFile(path.join(notices,'npm-inventory.json'),JSON.stringify({format:'craftmine.third-party/1',scope:'Build and runtime dependency inventory; see pinned pnpm lockfile for dependency graph',packages:inventory},null,2)+'\n');
  const commit=exe('git',['rev-parse','HEAD']);
  if(exe('git',['status','--porcelain','--untracked-files=normal']))throw Error('PACKAGE_SOURCE_NOT_CLEAN');
  const runtime=await verifyRuntimeResources(path.join(build,'runtime-resources'),commit);
  const pluginFiles=await resourceInventory(path.join(root,'vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world'));
  const clientFiles=await resourceInventory(path.join(root,'vendor/pi-desktop/apps/desktop/out'));
  const inputs=['vendor/pi-desktop/target/release/pi-desktop-host-core.exe','vendor/pi-desktop/target/release/craftmine-core.exe','vendor/pi-desktop/packages/agent-runtime/dist-bundle/sidecar.js','vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world/manifest.json','desktop/build/CraftmineWorld-source.zip'];
  const artifacts=await Promise.all(inputs.map(async p=>({path:p,sha256:await digest(path.join(root,p)),bytes:(await fs.stat(path.join(root,p))).size})));
  const manifest={format:'craftmine.build/1',commit,sourceDate:exe('git',['show','-s','--format=%cI','HEAD']),appId:'world.craftmine.desktop',product:'craftmine world / 最中幻想',profileDirectory:'CraftmineWorld',updateSource:null,sourceArchiveHash:artifacts.at(-1).sha256,artifacts,
    runtime:{sourceCommit:runtime.sourceCommit,filesDigest:runtime.filesDigest,manifestSha256:await digest(path.join(build,'runtime-resources/runtime-resources.json'))},pluginFiles,clientFiles,
    toolchain:{node:process.version,cargo:exe('cargo',['--version'])},reproducibility:'Pinned source and lockfiles; hashes prove this build. Byte-identical native/NSIS outputs are not claimed.'};
  await fs.mkdir(build,{recursive:true});await fs.writeFile(path.join(build,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({commit,sourceArchiveHash:manifest.sourceArchiveHash}));
}else if(mode==='verify'){
  const packageRoot=path.join(root,'vendor/pi-desktop/apps/desktop/release/win-unpacked');
  const manifest=JSON.parse(await fs.readFile(path.join(packageRoot,'resources/source/build-manifest.json'),'utf8'));
  if(manifest.commit!==exe('git',['rev-parse','HEAD'])||exe('git',['status','--porcelain','--untracked-files=normal']))throw Error('PACKAGE_SOURCE_NOT_CURRENT_CLEAN_HEAD');
  const required=['Craftmine World.exe','resources/app.asar','resources/bin/pi-desktop-host-core.exe','resources/bin/craftmine-core.exe','resources/agent-runtime/sidecar.js','resources/plugins/craftmine.world/main.cjs','resources/source/CraftmineWorld-source.zip','resources/source/USER_GUIDE.zh-CN.md','resources/licenses/PI-Desktop-LICENSE.txt','resources/licenses/CRAFTMINE-NOTICES.md'];
  for(const p of required)if(!(await fs.stat(path.join(packageRoot,p))).isFile())throw Error('MISSING_PACKAGE_FILE');
  const mappings=[['resources/bin/pi-desktop-host-core.exe',0],['resources/bin/craftmine-core.exe',1],['resources/agent-runtime/sidecar.js',2],['resources/plugins/craftmine.world/manifest.json',3],['resources/source/CraftmineWorld-source.zip',4]];
  for(const [p,index]of mappings)if(await digest(path.join(packageRoot,p))!==manifest.artifacts[index].sha256)throw Error('PACKAGE_SOURCE_HASH_MISMATCH');
  const runtime=await verifyRuntimeResources(path.join(packageRoot,'resources'),manifest.commit,{packaged:true});
  if(runtime.filesDigest!==manifest.runtime?.filesDigest||await digest(path.join(packageRoot,'resources/runtime-resources.json'))!==manifest.runtime.manifestSha256)throw Error('PACKAGE_RUNTIME_IDENTITY_MISMATCH');
  if(JSON.stringify(await resourceInventory(path.join(packageRoot,'resources/plugins/craftmine.world')))!==JSON.stringify(manifest.pluginFiles))throw Error('PACKAGE_PLUGIN_IDENTITY_MISMATCH');
  const require=createRequire(path.join(root,'vendor/pi-desktop/apps/desktop/package.json'));
  const asar=require('@electron/asar'),archive=path.join(packageRoot,'resources/app.asar');
  for(const file of manifest.clientFiles){
    const body=asar.extractFile(archive,'out/'+file.path);
    if(body.length!==file.bytes||createHash('sha256').update(body).digest('hex')!==file.sha256)throw Error('PACKAGE_CLIENT_IDENTITY_MISMATCH:'+file.path);
  }
  const files=[];async function walk(dir){for(const name of(await fs.readdir(dir)).sort()){const p=path.join(dir,name),info=await fs.lstat(p);if(info.isSymbolicLink())throw Error('PACKAGE_LINK_DENIED');if(info.isDirectory())await walk(p);else files.push({path:path.relative(packageRoot,p).replaceAll('\\','/'),bytes:info.size,sha256:await digest(p)});}}
  await walk(packageRoot);
  const release=path.dirname(packageRoot),installers=[];
  for(const name of(await fs.readdir(release)).sort())if(/^Craftmine-World-Setup-.*\.exe$/.test(name)){const p=path.join(release,name);installers.push({path:relative(p),bytes:(await fs.stat(p)).size,sha256:await digest(p)});}
  const evidence={format:'craftmine.package-evidence/1',commit:manifest.commit,sourceArchiveHash:manifest.sourceArchiveHash,files,installers,totalBytes:files.reduce((n,f)=>n+f.bytes,0),installerExecuted:false,cleanWindowsVerified:false,signature:'unsigned-local-preview'};
  await fs.writeFile(path.join(build,'package-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({commit:manifest.commit,files:files.length,totalBytes:evidence.totalBytes,installers}));
}else if(mode==='pin'||mode==='stage'||mode==='diff'){
  const {PACKAGE_REQUIRED_FILES}=await import('./delivery/lib/preflight-core.mjs');
  const argument=name=>{const index=process.argv.indexOf('--'+name);return index===-1?null:process.argv[index+1];};
  const flag=name=>process.argv.includes('--'+name);
  const present=async target=>{try{await fs.lstat(target);return true;}catch{return false;}};
  const walk=async(directory,prefix='')=>{const found=[];for(const name of(await fs.readdir(directory)).sort()){const target=path.join(directory,name),info=await fs.lstat(target),child=(prefix?prefix+'/':'')+name;
    if(info.isSymbolicLink())throw Error('PACKAGE_LINK_DENIED: '+child);
    if(info.isDirectory())found.push(...await walk(target,child));
    else if(info.isFile())found.push(child);
    else throw Error('PACKAGE_FILE_TYPE: '+child);}
    return found;};
  const describe=async directory=>{const files=[];for(const child of await walk(directory)){const target=path.join(directory,child),info=await fs.lstat(target);
    files.push({path:child.replaceAll('\\','/'),bytes:info.size,sha256:await digest(target)});}
    return files;};
  const copyTree=async(source,destination)=>{await fs.mkdir(destination,{recursive:true});for(const name of(await fs.readdir(source)).sort()){const from=path.join(source,name),to=path.join(destination,name),info=await fs.lstat(from);
    if(info.isSymbolicLink())throw Error('PACKAGE_LINK_DENIED: '+name);
    if(info.isDirectory())await copyTree(from,to);
    else if(info.isFile())await fs.copyFile(from,to);
    else throw Error('PACKAGE_FILE_TYPE: '+name);}};
  const copyInto=async(source,destination)=>{await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(source,destination);};
  const requiredStatus=async directory=>{const list=[];for(const child of PACKAGE_REQUIRED_FILES)list.push({path:child,present:await present(path.join(directory,child))});return list;};
  const total=files=>files.reduce((sum,file)=>sum+file.bytes,0);
  if(mode==='pin'){
    const packageDirectory=argument('package');
    if(!packageDirectory)throw Error('pin needs --package <win-unpacked>');
    if(!await present(packageDirectory))throw Error('PACKAGE_ABSENT: '+packageDirectory);
    const files=await describe(packageDirectory),installers=[];
    for(const name of(await fs.readdir(packageDirectory)).sort())if(/^Craftmine-World-Setup-.*\.exe$/.test(name)){
      const target=path.join(packageDirectory,name);installers.push({path:name,bytes:(await fs.stat(target)).size,sha256:await digest(target)});}
    const required=await requiredStatus(packageDirectory),missing=required.filter(item=>!item.present).map(item=>item.path);
    const manifest={format:'craftmine.package-manifest/1',generatedAt:new Date().toISOString(),commit:exe('git',['rev-parse','HEAD']),
      package:{directory:path.resolve(packageDirectory),fileCount:files.length,totalBytes:total(files),files},installers,required,missingRequired:missing,
      limits:['Read-only byte pin. It proves which bytes were inspected; it does not prove the package is complete, licensed or installable.',
        'A required file that is absent is recorded as present:false and never counted as a pass.',
        'SHA256SUMS.txt and resources/source/package-manifest.json are not part of a pinned package unless the package itself contains them.']};
    const out=argument('out');
    if(out){await fs.mkdir(path.dirname(path.resolve(out)),{recursive:true});await fs.writeFile(path.resolve(out),JSON.stringify(manifest,null,2)+'\n');}
    console.log(JSON.stringify({commit:manifest.commit,files:files.length,totalBytes:manifest.package.totalBytes,installers:installers.length,missingRequired:missing,out:out?path.resolve(out):null}));
    if(missing.length&&!flag('allow-missing'))process.exitCode=1;
  }else if(mode==='stage'){
    const from=argument('from'),outDirectory=argument('out');
    if(!from||!outDirectory)throw Error('stage needs --from <win-unpacked> and --out <dir>');
    if(!await present(from))throw Error('STAGE_SOURCE_ABSENT: '+from);
    if(await present(outDirectory)){
      const entries=await fs.readdir(outDirectory);
      if(entries.length&&!flag('force'))throw Error('STAGE_OUTPUT_NOT_EMPTY: '+outDirectory+' (pass --force to replace it)');
      if(entries.length)await fs.rm(outDirectory,{recursive:true,force:true});
    }
    await copyTree(from,outDirectory);
    const inputs={sourceArchive:null,buildManifest:null,notices:null};
    const archive=argument('source-archive');
    if(archive){if(!await present(archive))throw Error('SOURCE_ARCHIVE_ABSENT: '+archive);
      await copyInto(archive,path.join(outDirectory,'resources/source/CraftmineWorld-source.zip'));inputs.sourceArchive=path.resolve(archive);}
    const buildManifest=argument('build-manifest');
    if(buildManifest){if(!await present(buildManifest))throw Error('BUILD_MANIFEST_ABSENT: '+buildManifest);
      await copyInto(buildManifest,path.join(outDirectory,'resources/source/build-manifest.json'));inputs.buildManifest=path.resolve(buildManifest);}
    const notices=argument('notices');
    if(notices){if(!await present(notices))throw Error('NOTICES_ABSENT: '+notices);
      await copyTree(notices,path.join(outDirectory,'resources/licenses'));inputs.notices=path.resolve(notices);}
    const files=await describe(outDirectory);
    const required=await requiredStatus(outDirectory),missing=required.filter(item=>!item.present).map(item=>item.path);
    const manifest={format:'craftmine.package-manifest/1',generatedAt:new Date().toISOString(),commit:exe('git',['rev-parse','HEAD']),
      stage:{from:path.resolve(from),out:path.resolve(outDirectory),inputs},
      package:{directory:path.resolve(outDirectory),fileCount:files.length,totalBytes:total(files),files},required,missingRequired:missing,
      verification:{verified:false,note:'Staging records bytes only. A staged directory is not a delivery package until desktop/delivery/preflight.mjs package --package <dir> passes and desktop/delivery/release-manifest.mjs verify --manifest <file> --package <dir> matches.'},
      limits:['The staging tool copies and hashes; it does not decide licences and does not execute the installer.',
        'SHA256SUMS.txt and resources/source/package-manifest.json are written after the file list, so they are not listed inside it.']};
    await fs.mkdir(path.join(outDirectory,'resources/source'),{recursive:true});
    await fs.writeFile(path.join(outDirectory,'resources/source/package-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    await fs.writeFile(path.join(outDirectory,'SHA256SUMS.txt'),files.map(file=>file.sha256+'  '+file.path).sort().join('\n')+'\n');
    console.log(JSON.stringify({commit:manifest.commit,out:manifest.stage.out,files:files.length,totalBytes:manifest.package.totalBytes,missingRequired:missing}));
    if(missing.length)process.exitCode=1;
  }else{
    const first=argument('a'),second=argument('b');
    if(!first||!second)throw Error('diff needs --a <manifest> and --b <manifest>');
    const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
    const index=manifest=>new Map((manifest.package?.files??[]).map(file=>[file.path,file]));
    const left=index(await read(first)),right=index(await read(second)),added=[],removed=[],changed=[];
    for(const [file,entry] of right){
      if(!left.has(file))added.push(file);
      else if(left.get(file).sha256!==entry.sha256)changed.push({path:file,bytesFrom:left.get(file).bytes,bytesTo:entry.bytes,sha256From:left.get(file).sha256,sha256To:entry.sha256});}
    for(const file of left.keys())if(!right.has(file))removed.push(file);
    console.log(JSON.stringify({a:path.resolve(first),b:path.resolve(second),added,removed,changed},null,2));
  }
}else throw Error('Use manifest, verify, pin, stage or diff');
