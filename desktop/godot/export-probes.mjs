import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment,godotLock,sha256} from './toolchain.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const quote=value=>JSON.stringify(value.replaceAll('\\','/'));

/** Exports only repository-owned probes, never an arbitrary model/user project. */
export async function prepareWebProbes(out,{threads=true}={}){
  const environment=await createGodotProbeEnvironment(out,{web:true,threads});
  const builds=[];
  async function build(base,{revision='initial',damage=12}={}){
    if(!['first-person','top-down'].includes(base)||!['initial','changed'].includes(revision))throw Error('Unknown authored fixture');
    if(![12,7].includes(damage))throw Error('Unknown authored damage variant');
    const project=path.join(out,'projects',base+'-'+revision),output=path.join(out,'exports',base+'-'+revision);
    fs.mkdirSync(output,{recursive:true});
    fs.cpSync(path.join(directory,'probes',base),project,{recursive:true});
    fs.copyFileSync(path.join(directory,'probes/shared/web_bridge.gd'),path.join(project,'web_bridge.gd'));
    fs.copyFileSync(path.join(directory,'web/shell.html'),path.join(project,'shell.html'));
    if(base==='first-person'&&damage!==12){
      const file=path.join(project,'world.gd'),source=fs.readFileSync(file,'utf8');
      if(!source.includes('var damage := 12'))throw Error('Authored damage marker missing');
      fs.writeFileSync(file,source.replace('var damage := 12','var damage := '+damage));
    }
    fs.writeFileSync(path.join(project,'export_presets.cfg'),`[preset.0]
name="Web"
platform="Web"
runnable=true
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path=${quote(path.join(output,'index.html'))}
[preset.0.options]
custom_template/release=${quote(environment.webTemplate)}
variant/thread_support=${threads}
variant/extensions_support=false
html/custom_html_shell="res://shell.html"
html/focus_canvas_on_start=false
html/canvas_resize_policy=2
progressive_web_app/enabled=false
`);
    await environment.run(base+'-'+revision+'-import',['--path',project,'--editor','--import']);
    await environment.run(base+'-'+revision+'-export',['--path',project,'--export-release','Web',path.join(output,'index.html')],{timeout:120000});
    fs.copyFileSync(path.join(directory,'web/bridge.js'),path.join(output,'bridge.js'));
    fs.cpSync(path.join(directory,'licenses'),path.join(output,'licenses'),{recursive:true});
    const files=[];
    for(const name of fs.readdirSync(output,{recursive:true}).sort())if(fs.statSync(path.join(output,name)).isFile())files.push({path:name.replaceAll('\\','/'),bytes:fs.statSync(path.join(output,name)).size,sha256:await sha256(path.join(output,name))});
    const buildId=createHash('sha256').update(JSON.stringify(files)).digest('hex');
    const result={base,revision,buildId,threads,output,files,bytes:files.reduce((sum,file)=>sum+file.bytes,0),godotVersion:environment.actualVersion};
    fs.writeFileSync(path.join(output,'build.json'),JSON.stringify(result,null,2));
    builds.push(result);return result;
  }
  return {...environment,builds,build,version:godotLock.version};
}
