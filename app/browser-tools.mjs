import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url);
export function playwright(){
  try{return require('playwright');}catch{
    const candidate=process.env.PLAYWRIGHT_MODULE_PATH||path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','playwright');
    try{return require(candidate);}catch{throw Error('后台代码检查需要 Playwright。请安装本机运行库，或用 PLAYWRIGHT_MODULE_PATH 指向已有安装。');}
  }
}
export function browserOptions(){
  const paths=[process.env.CRAFTMINE_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
  return {headless:true, ...(paths.find(p=>p&&fs.existsSync(p))?{executablePath:paths.find(p=>p&&fs.existsSync(p))}:{}),viewport:{width:1440,height:1000}};
}
