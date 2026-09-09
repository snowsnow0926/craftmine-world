// These refusal tests never launch Electron: invalid ASAR/manifest must fail first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(new URL('../../../vendor/pi-desktop/apps/desktop/package.json',import.meta.url));
const builderRequire=createRequire(require.resolve('electron-builder'));
const libRequire=createRequire(builderRequire.resolve('app-builder-lib'));
const asar=libRequire('@electron/asar');
async function fixture(source){
  await fs.mkdir('test-results',{recursive:true});
  const root=await fs.mkdtemp(path.resolve('test-results/f-package-guard-'));
  const app=path.join(root,'app'),pkg=path.join(root,'package');
  for(const directory of ['out/main','out/preload'])await fs.mkdir(path.join(app,directory),{recursive:true});
  await fs.writeFile(path.join(app,'out/main/index.js'),source);
  await fs.writeFile(path.join(app,'out/preload/craftmine-headless.cjs'),'/* fixed fixture, never executed */');
  await fs.mkdir(path.join(pkg,'resources'),{recursive:true});
  await asar.createPackage(app,path.join(pkg,'resources/app.asar'));
  return {pkg,run:()=>spawnSync(process.execPath,['tests/dispatch/f/native-agent.mjs'],{cwd:process.cwd(),windowsHide:true,encoding:'utf8',env:{...process.env,CRAFTMINE_PACKAGED_ROOT:pkg,CRAFTMINE_LIVE_CONFIG:''}})};
}
test('packaged runner checks actual ASAR and refuses missing isolation before credentials or launch',async()=>{
  const f=await fixture('/* no native isolation */'),result=f.run();
  assert.notEqual(result.status,0);assert.match(result.stderr,/Refuse unsafe or unprepared native build/);assert.doesNotMatch(result.stdout,/Evidence directory/);
});
test('packaged runner refuses actual binary/manifest disagreement before credentials or launch',async()=>{
  const f=await fixture('configureHeadlessAcceptance(); focusable: !headlessAcceptance; offscreen: !!headlessAcceptance; installNativeAgentAcceptance();');
  for(const directory of ['resources/plugins/craftmine.world','resources/source','resources/bin'])await fs.mkdir(path.join(f.pkg,directory),{recursive:true});
  await fs.writeFile(path.join(f.pkg,'resources/plugins/craftmine.world/domain.cjs'),'/* safe fixture */');
  await fs.writeFile(path.join(f.pkg,'resources/bin/pi-desktop-host-core.exe'),'never executed');
  await fs.writeFile(path.join(f.pkg,'resources/source/build-manifest.json'),JSON.stringify({format:'craftmine.build/1',artifacts:[{sha256:'0'.repeat(64)}]}));
  const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Refuse package\/source manifest mismatch/);assert.doesNotMatch(result.stdout,/Evidence directory/);
});
