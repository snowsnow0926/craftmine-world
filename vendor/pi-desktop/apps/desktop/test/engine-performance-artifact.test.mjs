import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import{register}from'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {readEnginePerformanceArtifact:read}=await import('../electron/main/engine-performance-artifact.ts');
test('ordinary and extended-length Windows artifact paths retain exact authorized bytes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-engine-path-'));fs.mkdirSync(path.join(root,'web'));const file=path.join(root,'web/index.pck'),bytes=Buffer.from('exact checked pack');fs.writeFileSync(file,bytes);
 for(const directory of [root,path.toNamespacedPath(root)])assert.deepEqual(read({root:directory},{path:'web/index.pck'},[directory]),bytes);
 assert.throws(()=>read({root},{path:'web/index.pck'},[]),/ROOT_UNAUTHORIZED/);
 for(const invalid of ['web/../index.pck','web\\index.pck','C:/private.pck','web/index.pck\0'])assert.throws(()=>read({root},{path:invalid},[root]),/ARTIFACT_PATH/);
 const alias=path.join(root,'linked');fs.symlinkSync(root,alias,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>read({root:alias},{path:'web/index.pck'},[alias]),/ARTIFACT_LINK/);
 assert(root.startsWith(path.join(os.tmpdir(),'craftmine-engine-path-')));
 fs.rmSync(root,{recursive:true,force:true});
});
