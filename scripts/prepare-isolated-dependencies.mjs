// Reuse immutable third-party packages while binding workspace packages locally.
import fs from 'node:fs';
import path from 'node:path';
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
console.log(JSON.stringify({root,dependencyRoot,links,workspace:[...workspace]},null,2));
