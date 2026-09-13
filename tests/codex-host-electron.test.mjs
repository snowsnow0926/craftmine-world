import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {hostElectron} from '../scripts/lib/codex-host-electron.mjs';
test('trusted Electron override stays absolute/file-only and falls back to the installed dependency',()=>{
 const before=process.env.CRAFTMINE_ELECTRON_BIN,root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-electron-'));
 try{
  delete process.env.CRAFTMINE_ELECTRON_BIN;assert.equal(hostElectron(name=>name+'-installed'),'electron-installed');
  const binary=path.join(root,'electron.exe');fs.writeFileSync(binary,'test path only; never executed');process.env.CRAFTMINE_ELECTRON_BIN=binary;assert.equal(hostElectron(()=>{throw Error('Must use selected runtime');}),binary);
  for(const invalid of ['relative.exe',root]){process.env.CRAFTMINE_ELECTRON_BIN=invalid;assert.throws(()=>hostElectron(()=>''),/CODEX_HOST_ELECTRON_INVALID/);}
 }finally{if(before===undefined)delete process.env.CRAFTMINE_ELECTRON_BIN;else process.env.CRAFTMINE_ELECTRON_BIN=before;fs.rmSync(root,{recursive:true,force:true});}
});
