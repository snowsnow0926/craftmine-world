import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const runFile=promisify(execFile);
const directory=path.dirname(fileURLToPath(import.meta.url));
export const godotLock=JSON.parse(fs.readFileSync(path.join(directory,'toolchain.lock.json'),'utf8'));
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export async function sha256(file){
  const hash=createHash('sha256');
  for await(const chunk of fs.createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}

export function godotCacheDirectory(){
  const selected=process.env.CRAFTMINE_GODOT_CACHE_DIR;
  if(selected&&!path.isAbsolute(selected))throw Error('Godot cache directory must be absolute');
  return selected??path.resolve(directory,'../build/godot',godotLock.version);
}

/** Trusted authored fixtures only until the OS execution boundary is implemented. */
export async function createGodotProbeEnvironment(out,{web=false,threads=false}={}){
  if(process.platform!=='win32')throw Error('Pinned Godot probe requires Windows x64');
  const cache=godotCacheDirectory();
  if(await sha256(path.join(cache,godotLock.editor.file))!==godotLock.editor.sha256)throw Error('Godot editor archive mismatch');
  const original=path.join(cache,'editor',godotLock.editor.executable);
  if(await sha256(original)!==godotLock.editor.executableSha256)throw Error('Godot executable mismatch');
  const engine=path.join(out,'engine');fs.mkdirSync(engine,{recursive:true});
  const executable=path.join(engine,godotLock.editor.executable);
  fs.copyFileSync(original,executable);fs.writeFileSync(path.join(engine,'_sc_'),'');
  const env={};
  for(const key of ['SystemRoot','WINDIR','COMSPEC'])if(process.env[key])env[key]=process.env[key];
  env.PATH=path.join(process.env.SystemRoot,'System32');
  for(const key of ['APPDATA','LOCALAPPDATA','USERPROFILE','TEMP','TMP']){
    env[key]=path.join(out,'profile',key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});
  }
  for(const folder of ['Desktop','Documents','Downloads','Music','Pictures','Videos'])fs.mkdirSync(path.join(env.USERPROFILE,folder),{recursive:true});
  let webTemplate;
  if(web){
    if(await sha256(path.join(cache,godotLock.exportTemplates.file))!==godotLock.exportTemplates.sha256)throw Error('Godot export archive mismatch');
    const manifest=readJson(path.join(cache,'template-files.json'));
    if(manifest.archiveSha256!==godotLock.exportTemplates.sha256)throw Error('Godot template manifest mismatch');
    const entry=threads?godotLock.exportTemplates.webThreadedRelease:godotLock.exportTemplates.webRelease;
    if(!manifest.files.some(file=>file.path===entry.file&&file.sha256===entry.sha256))throw Error('Godot Web template missing');
    webTemplate=path.join(engine,entry.file);
    const templateSource=path.join(cache,'templates',entry.file);
    if(fs.statSync(templateSource).size!==entry.bytes||await sha256(templateSource)!==entry.sha256)throw Error('Godot Web template mismatch');
    fs.copyFileSync(templateSource,webTemplate);
  }
  const runs=[];
  async function run(label,args,{timeout=60000}={}){
    if(!/^[a-z0-9-]+$/i.test(label))throw Error('Invalid probe log label');
    const log=path.join(out,label+'.log'),started=performance.now();
    try{
      const result=await runFile(executable,['--headless','--language','en',...args],{cwd:out,env,windowsHide:true,timeout,maxBuffer:2*1024*1024});
      fs.writeFileSync(log,result.stdout+result.stderr);
      if(/(?:SCRIPT ERROR|Parse Error|ERROR:)/.test(result.stdout+result.stderr))throw Error(label+': Godot reported an error');
      runs.push({label,elapsedMs:Math.round(performance.now()-started),exitCode:0});
      return result.stdout;
    }catch(error){
      fs.appendFileSync(log,String(error.stdout??'')+String(error.stderr??'')+'\n'+String(error));
      runs.push({label,elapsedMs:Math.round(performance.now()-started),error:String(error)});
      throw error;
    }
  }
  const actualVersion=(await run('engine-version',['--version'])).trim();
  if(!actualVersion.startsWith(godotLock.version.replace('-stable','.stable')))throw Error('Godot runtime version mismatch');
  return {executable,webTemplate,run,runs,actualVersion};
}
