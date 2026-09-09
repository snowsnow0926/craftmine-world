import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {godotCacheDirectory,godotLock,sha256} from '../toolchain.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export const WINDOWS_TEMPLATE={file:'windows_release_x86_64.exe',bytes:109268480,sha256:'d34d36f3be1a6c49c56525ae86469b92e4f417ddf0b43cf00dd80c385c4b0562'};
export const windowsPreset=await fs.readFile(path.join(here,'windows-export.cfg'),'utf8');
/** Extract a single verified archive entry into a fresh task-owned engine root. */
export async function prepareWindowsToolchain(out){
 if(process.platform!=='win32'||!path.isAbsolute(out))throw Error('Windows absolute fresh output required');
 const cache=godotCacheDirectory(),archive=path.join(cache,godotLock.exportTemplates.file),editor=path.join(cache,'editor',godotLock.editor.executable);
 if(await sha256(archive)!==godotLock.exportTemplates.sha256||await sha256(editor)!==godotLock.editor.executableSha256)throw Error('Pinned toolchain mismatch');
 await fs.mkdir(out);await fs.mkdir(path.join(out,'editor'));await fs.mkdir(path.join(out,'templates'));
 await fs.copyFile(editor,path.join(out,'editor',godotLock.editor.executable));
 const target=path.join(out,'templates',WINDOWS_TEMPLATE.file);
 await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(here,'extract-windows-template.ps1'),'-Archive',archive,'-Destination',target],{windowsHide:true,timeout:120000});
 if((await fs.stat(target)).size!==WINDOWS_TEMPLATE.bytes||await sha256(target)!==WINDOWS_TEMPLATE.sha256)throw Error('Extracted Windows template mismatch');
 // The fixed import operation still verifies the existing Web template set.
 for(const name of ['version.txt','web_nothreads_debug.zip','web_nothreads_release.zip','web_release.zip'])await fs.copyFile(path.join(cache,'templates',name),path.join(out,'templates',name));
 return {engineRoot:out,template:WINDOWS_TEMPLATE,archiveSha256:godotLock.exportTemplates.sha256};
}
