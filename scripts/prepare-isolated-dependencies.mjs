// Reuse immutable third-party packages while binding workspace packages locally.
import fs from 'node:fs';
import path from 'node:path';
// pnpm and pnpm.cmd are shell scripts on Windows, so these two calls run through
// the shell as a single command string rather than shellquoted argument lists.
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dependencyRoot=process.env.CRAFTMINE_DEPENDENCY_ROOT;
if(!dependencyRoot||!path.isAbsolute(dependencyRoot))throw Error('CRAFTMINE_DEPENDENCY_ROOT must identify an absolute existing checkout');
const upstream=path.join(dependencyRoot,'vendor/pi-desktop');
const local=path.join(root,'vendor/pi-desktop');
const workspace=new Map();
for(const group of ['packages','apps'])for(const entry of fs.readdirSync(path.join(local,group),{withFileTypes:true})){
  const directory=path.join(local,group,entry.name),manifest=path.join(directory,'package.json');
  if(entry.isDirectory()&&fs.existsSync(manifest))workspace.set(JSON.parse(fs.readFileSync(manifest,'utf8')).name,directory);
}
let links=0;
function link(source,destination){
  if(fs.existsSync(destination))return;
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.symlinkSync(fs.realpathSync(source),destination,process.platform==='win32'?'junction':'dir');links++;
}
function mirror(source,destination){
  if(!fs.existsSync(source))return;
  fs.mkdirSync(destination,{recursive:true});
  for(const entry of fs.readdirSync(source,{withFileTypes:true})){
    if(entry.name.startsWith('.'))continue;
    if(entry.name.startsWith('@')){
      for(const name of fs.readdirSync(path.join(source,entry.name))){
        const packageName=entry.name+'/'+name;
        link(workspace.get(packageName)||path.join(source,entry.name,name),path.join(destination,entry.name,name));
      }
    }else link(workspace.get(entry.name)||path.join(source,entry.name),path.join(destination,entry.name));
  }
}
mirror(path.join(upstream,'node_modules'),path.join(local,'node_modules'));
for(const directory of workspace.values())mirror(path.join(upstream,path.relative(local,directory),'node_modules'),path.join(directory,'node_modules'));
// The single machine-readable summary is printed after the fallback decision,
// so a caller that parses stdout always sees the mode that was actually used.

// A dependency root can exist and still be unusable: purged pnpm stores leave
// empty package directories behind, so mirroring succeeds while nothing real is
// linked. Probe actual packages, and recover from the local pnpm store instead
// of letting the failure surface much later as an unresolved import.
// pnpm does not flat-hoist third-party packages into the checkout root, so the
// probe asks whether a real consumer can resolve them.
const probes=['typescript/package.json','esbuild/package.json','react/package.json'];
const consumers=[...workspace.values()].map(directory=>path.join(directory,'node_modules'));
const usable=()=>probes.every(name=>consumers.some(directory=>fs.existsSync(path.join(directory,name))));
function offlineInstall(){
  try{
    execSync('pnpm install --offline --frozen-lockfile --ignore-scripts --config.confirmModulesPurge=false',
      {cwd:local,stdio:'inherit',env:{...process.env,CI:'1'}});
  }catch(failure){
    throw Error('The dependency root has no usable packages and the offline install failed: '+String(failure.message)
      +'\nProvide a populated pnpm store (pnpm store path), or point CRAFTMINE_DEPENDENCY_ROOT at a checkout with real node_modules.');
  }
}
let mode='mirror',offline=null;
if(!usable()){
  if(!fs.existsSync(path.join(local,'pnpm-lock.yaml')))throw Error('The isolated checkout has no pnpm workspace to install from');
  offline={store:execSync('pnpm store path',{cwd:local,encoding:'utf8'}).trim(),scriptsSkipped:true};
  offlineInstall();
  if(!usable())throw Error('Third-party packages are still missing after the offline install');
  mode='offline-install';
}
console.log(JSON.stringify({root,dependencyRoot,links,workspace:[...workspace],mode,offline},null,2));
