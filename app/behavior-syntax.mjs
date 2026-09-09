import {spawnSync} from 'node:child_process';

export function checkModuleSyntax(code) {
  // A desktop bundle replaces this module with its static parser. Never
  // accidentally launch another Electron application as a syntax checker.
  if(process.versions.electron)throw Error('Electron requires the bundled behavior syntax parser');
  const check=spawnSync(process.execPath,['--check','--input-type=module'],{input:code,encoding:'utf8',windowsHide:true,timeout:3000,maxBuffer:16000});
  if(check.error)throw Error('玩法语法检查未完成：'+check.error.message);
  if(check.status!==0)throw Error('玩法源码语法错误：'+String(check.stderr).slice(0,1600));
}
