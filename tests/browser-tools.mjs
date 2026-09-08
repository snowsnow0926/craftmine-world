import { createRequire } from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
export function playwright(){
  try{return require('playwright');}catch{
    const candidate=process.env.PLAYWRIGHT_MODULE_PATH||'C:/Users/WINDOWS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
    return require(candidate);
  }
}
export function browserOptions(){
  const paths=[process.env.CRAFTMINE_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
  return {headless:true, ...(paths.find(p=>p&&fs.existsSync(p))?{executablePath:paths.find(p=>p&&fs.existsSync(p))}:{}),viewport:{width:1440,height:1000}};
}
