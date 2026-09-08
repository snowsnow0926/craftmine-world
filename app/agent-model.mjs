import fs from 'node:fs';
import path from 'node:path';
import { spawn,spawnSync } from 'node:child_process';

export function findCodex() {
  if (process.env.CRAFTMINE_CODEX_PATH) return process.env.CRAFTMINE_CODEX_PATH;
  const found = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['codex'], { encoding: 'utf8', windowsHide: true });
  const executable = found.stdout?.split(/\r?\n/).find(p => p.endsWith('.exe') || (process.platform !== 'win32' && p));
  if (executable) return executable;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const root = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    if (fs.existsSync(root)) {
      const choices = fs.readdirSync(root).map(p => path.join(root, p, 'codex.exe')).filter(p => fs.existsSync(p));
      choices.sort((a,b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (choices.length) return choices[0];
    }
  }
  return null;
}
export function providerStatus() {
  const executable = findCodex();
  if (!executable) return { available: false, message: '未找到 Codex CLI。安装并运行 codex login 后重启本地服务。' };
  const result = spawnSync(executable, ['login','status'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  return { available: result.status === 0, message: result.status === 0 ? 'Codex 已登录 · 真实 LLM' : 'Codex 尚未登录，请在本机终端运行 codex login。' };
}
export function killProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000, stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

export async function generateModel({executable,dir,prompt,active,onChild,onUsage,onLog}){
  const args=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--color','never',
    '-c','approval_policy="never"','-c','web_search="disabled"','-c','features.shell_tool=false','-c','features.unified_exec=false',
    '-c','features.multi_agent=false','-c','features.apps=false','-c','features.plugins=false',
    '--output-schema',path.join(dir,'response.schema.json'),'--output-last-message',path.join(dir,'response.json'),'-C',dir,'-'];
  if(process.env.CRAFTMINE_MODEL)args.splice(1,0,'--model',process.env.CRAFTMINE_MODEL);
  const child=spawn(executable,args,{cwd:dir,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});onChild(child);
  let tail='',buffer='',outputSize=0,eventError;
  const notify=(callback,value)=>{try{callback(value);}catch(error){eventError=error;killProcessTree(child);}};
  child.stdout.on('data',chunk=>{
    outputSize+=chunk.length;if(outputSize>2_000_000){killProcessTree(child);return;}
    buffer+=chunk.toString('utf8');let newline;
    while((newline=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let event;
      try{event=JSON.parse(line);}catch{continue;}
      if(event.type==='thread.started')notify(onLog,'LLM 会话已建立，正在理解需求与当前场景。');
      if(event.type==='turn.completed')notify(onUsage,event.usage);
      if(event.type==='error'||event.type==='turn.failed')tail=String(event.message||event.error?.message||'LLM 执行失败');
    }
  });
  child.stderr.on('data',chunk=>{tail=(tail+chunk.toString('utf8')).slice(-4000);});
  child.stdin.on('error',()=>{});child.stdin.end(prompt);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  if(active.abort.signal.aborted)throw Error('生成已停止');
  if(eventError)throw eventError;
  if(outputSize>2_000_000)throw Error('模型输出超过大小限制');
  if(code!==0)throw Error(('Codex 执行失败。'+tail).slice(-1200));
  if(fs.statSync(path.join(dir,'response.json')).size>1_000_000)throw Error('场景文件超过大小限制');
  return fs.readFileSync(path.join(dir,'response.json'),'utf8');
}
