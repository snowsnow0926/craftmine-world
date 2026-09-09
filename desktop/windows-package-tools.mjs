import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
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
  const inputs=['vendor/pi-desktop/target/release/pi-desktop-host-core.exe','vendor/pi-desktop/target/release/craftmine-core.exe','vendor/pi-desktop/packages/agent-runtime/dist-bundle/sidecar.js','vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world/manifest.json','desktop/build/CraftmineWorld-source.zip'];
  const artifacts=await Promise.all(inputs.map(async p=>({path:p,sha256:await digest(path.join(root,p)),bytes:(await fs.stat(path.join(root,p))).size})));
  const manifest={format:'craftmine.build/1',commit,sourceDate:exe('git',['show','-s','--format=%cI','HEAD']),appId:'world.craftmine.desktop',product:'craftmine world / 最中幻想',profileDirectory:'CraftmineWorld',updateSource:null,sourceArchiveHash:artifacts.at(-1).sha256,artifacts,
    toolchain:{node:process.version,cargo:exe('cargo',['--version'])},reproducibility:'Pinned source and lockfiles; hashes prove this build. Byte-identical native/NSIS outputs are not claimed.'};
  await fs.mkdir(build,{recursive:true});await fs.writeFile(path.join(build,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({commit,sourceArchiveHash:manifest.sourceArchiveHash}));
}else if(mode==='verify'){
  const packageRoot=path.join(root,'vendor/pi-desktop/apps/desktop/release/win-unpacked');
  const manifest=JSON.parse(await fs.readFile(path.join(packageRoot,'resources/source/build-manifest.json'),'utf8'));
  const required=['Craftmine World.exe','resources/app.asar','resources/bin/pi-desktop-host-core.exe','resources/bin/craftmine-core.exe','resources/agent-runtime/sidecar.js','resources/plugins/craftmine.world/main.cjs','resources/source/CraftmineWorld-source.zip','resources/source/USER_GUIDE.zh-CN.md','resources/licenses/PI-Desktop-LICENSE.txt','resources/licenses/CRAFTMINE-NOTICES.md'];
  for(const p of required)if(!(await fs.stat(path.join(packageRoot,p))).isFile())throw Error('MISSING_PACKAGE_FILE');
  const mappings=[['resources/bin/pi-desktop-host-core.exe',0],['resources/bin/craftmine-core.exe',1],['resources/agent-runtime/sidecar.js',2],['resources/plugins/craftmine.world/manifest.json',3],['resources/source/CraftmineWorld-source.zip',4]];
  for(const [p,index]of mappings)if(await digest(path.join(packageRoot,p))!==manifest.artifacts[index].sha256)throw Error('PACKAGE_SOURCE_HASH_MISMATCH');
  const files=[];async function walk(dir){for(const name of(await fs.readdir(dir)).sort()){const p=path.join(dir,name),info=await fs.lstat(p);if(info.isSymbolicLink())throw Error('PACKAGE_LINK_DENIED');if(info.isDirectory())await walk(p);else files.push({path:path.relative(packageRoot,p).replaceAll('\\','/'),bytes:info.size,sha256:await digest(p)});}}
  await walk(packageRoot);
  const release=path.dirname(packageRoot),installers=[];
  for(const name of(await fs.readdir(release)).sort())if(/^Craftmine-World-Setup-.*\.exe$/.test(name)){const p=path.join(release,name);installers.push({path:relative(p),bytes:(await fs.stat(p)).size,sha256:await digest(p)});}
  const evidence={format:'craftmine.package-evidence/1',commit:manifest.commit,sourceArchiveHash:manifest.sourceArchiveHash,files,installers,totalBytes:files.reduce((n,f)=>n+f.bytes,0),installerExecuted:false,cleanWindowsVerified:false,signature:'unsigned-local-preview'};
  await fs.writeFile(path.join(build,'package-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({commit:manifest.commit,files:files.length,totalBytes:evidence.totalBytes,installers}));
}else throw Error('Use manifest or verify');
