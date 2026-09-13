import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareInputImages} from '../scripts/lib/codex-input-images.mjs';
const root=path.resolve('test-results');await fs.mkdir(root,{recursive:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function fixture(t){const dir=await fs.mkdtemp(path.join(root,'input-images-'));t.after(async()=>{assert(dir.startsWith(root+path.sep));await fs.rm(dir,{recursive:true,force:true});});return dir;}
test('explicit PNGs become actual image content with immutable byte provenance, not file-reading tools',async t=>{
  const dir=await fixture(t),file=path.join(dir,'reference.png');await fs.writeFile(file,png);
  const images=await prepareInputImages(dir,[file,file]);assert.equal(images.length,2);
  assert.equal(images[0].input.type,'image');assert.equal(images[0].input.url,'data:image/png;base64,'+png.toString('base64'));
  assert.equal(images[0].provenance.sha256,createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(await fs.readFile(images[0].provenance.storedPath),png);
  await fs.writeFile(file,'changed original');assert.deepEqual(await fs.readFile(images[0].provenance.storedPath),png);
});
test('relative paths, credential-like text, mismatched image types and changed archives fail before model submission',async t=>{
  const dir=await fixture(t);
  await assert.rejects(prepareInputImages(dir,['auth.json']),/PATH_REQUIRED/);
  const file=path.join(dir,'secret.png');await fs.writeFile(file,'{"access_token":"fixture-private"}');
  await assert.rejects(prepareInputImages(dir,[file]),/FORMAT_MISMATCH/);
  const jpg=path.join(dir,'wrong.jpg');await fs.writeFile(jpg,png);await assert.rejects(prepareInputImages(dir,[jpg]),/FORMAT_MISMATCH/);
  await fs.writeFile(file,png);const [image]=await prepareInputImages(dir,[file]);await fs.writeFile(image.provenance.storedPath,'tampered');
  await assert.rejects(prepareInputImages(dir,[file]),/ARCHIVE_CHANGED/);
});
