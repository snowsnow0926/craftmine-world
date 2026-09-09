import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {loadPackageAsar} from '../../desktop/package-asar.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const desktop=process.env.CRAFTMINE_TEST_DESKTOP_DIRECTORY??path.join(root,'vendor/pi-desktop/apps/desktop');
test('actual pnpm builder dependency creates and reads the exact nested client bytes',async()=>{
  const asar=loadPackageAsar(desktop),directory=await fs.mkdtemp(path.join(os.tmpdir(),'craftmine-asar-'));
  const source=path.join(directory,'input');await fs.mkdir(path.join(source,'out/main'),{recursive:true});
  const bytes=Buffer.from('exact client bytes\n中文\n');await fs.writeFile(path.join(source,'out/main/index.js'),bytes);
  const archive=path.join(directory,'app.asar');await asar.createPackage(source,archive);
  assert.deepEqual(asar.extractFile(archive,path.normalize('out/main/index.js')),bytes);
  assert.throws(()=>asar.extractFile(archive,path.normalize('out/absent.js')));
});
