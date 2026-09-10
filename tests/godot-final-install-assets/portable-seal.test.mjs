// Small owned payloads, real Git/filesystem, and optional existing pinned 7-Zip.
// This never packages or modifies an existing release application.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {beginRelease,sealRelease,verifySeal} from '../../desktop/release-run.mjs';
import {portablePath,portableInventory,verifyPortableInputs,verifyPortableListing,verifyPortablePayload,sealPortable} from '../../desktop/seal-portable.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const tool=process.env.CRAFTMINE_TEST_ARCHIVE_TOOL?{
  path:path.resolve(process.env.CRAFTMINE_TEST_ARCHIVE_TOOL),sha256:process.env.CRAFTMINE_TEST_ARCHIVE_SHA256,
  librarySha256:process.env.CRAFTMINE_TEST_ARCHIVE_LIBRARY_SHA256}:null;
async function fixture(options={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'craftmine-portable-seal-'));
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  await fs.writeFile(path.join(root,'.gitignore'),'desktop/build/\n');
  await fs.mkdir(path.join(root,'vendor/pi-desktop/apps/desktop'),{recursive:true});
  await fs.writeFile(path.join(root,'vendor/pi-desktop/apps/desktop/package.json'),JSON.stringify({version:'1.0.0'}));
  git(['init','-q']);git(['add','.']);git(['-c','user.name=Owned fixture','-c','user.email=fixture@example.invalid','commit','-qm','owned fixture']);
  const commit=git(['rev-parse','HEAD']),source=Buffer.from('owned source archive fixture');
  await fs.mkdir(path.join(root,'desktop/build'),{recursive:true});
  const manifest={format:'craftmine.build/1',commit,sourceArchiveHash:hash(source)};
  await fs.writeFile(path.join(root,'desktop/build/build-manifest.json'),JSON.stringify(manifest));
  const run=await beginRelease(root,manifest,{archiveTool:options.tool??tool});
  const packageRoot=path.join(run.output,'win-unpacked');
  for(const [name,bytes]of Object.entries({'Craftmine World.exe':'owned executable fixture','resources/app.asar':'owned app fixture',
    'resources/source/build-manifest.json':JSON.stringify(manifest),'resources/source/CraftmineWorld-source.zip':source,'locales/简体 中文.pak':'literal locale fixture'})){
    const file=path.join(packageRoot,...name.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
  }
  await sealRelease(run,'1.0.0');
  const files=await portableInventory(packageRoot),evidence={format:'craftmine.package-evidence/2',commit,runFile:path.relative(root,run.runFile).replaceAll('\\','/'),
    sourceArchiveHash:manifest.sourceArchiveHash,buildManifestSha256:run.buildManifestSha256,files,totalBytes:files.reduce((n,f)=>n+f.bytes,0),
    installers:[],extraction:null,signature:'unsigned-local-preview'};
  const evidenceFile=path.join(path.dirname(run.runFile),'package-evidence.json');await fs.writeFile(evidenceFile,JSON.stringify(evidence));
  return {root,run,packageRoot,evidence,evidenceFile,git};
}

test('actual clean source, sealed output, and complete evidence bind one run',async()=>{
  const f=await fixture(),before=await verifyPortableInputs(f.root,f.run.runFile);
  assert.equal(before.identity.commit,f.evidence.commit);assert.deepEqual(before.files,f.evidence.files);
  await fs.writeFile(path.join(f.root,'source-change.txt'),'dirty');
  await assert.rejects(verifyPortableInputs(f.root,f.run.runFile),/SOURCE_NOT_CLEAN/);
});
test('different clean head cannot derive an old sealed application',async()=>{
  const f=await fixture();await fs.writeFile(path.join(f.root,'next.txt'),'new source');f.git(['add','.']);f.git(['-c','user.name=Owned fixture','-c','user.email=fixture@example.invalid','commit','-qm','next']);
  await assert.rejects(verifyPortableInputs(f.root,f.run.runFile),/SOURCE_NOT_CURRENT/);
});
test('missing, foreign, truncated or altered package evidence fails before compression',async()=>{
  for(const mutation of ['commit','run','manifest','missing-file','changed-hash','size','installer','signature']){
    const f=await fixture(),e=structuredClone(f.evidence);
    if(mutation==='commit')e.commit='a'.repeat(40);
    if(mutation==='run')e.runFile='desktop/build/releases/foreign/run.json';
    if(mutation==='manifest')e.buildManifestSha256='a'.repeat(64);
    if(mutation==='missing-file')e.files.pop();
    if(mutation==='changed-hash')e.files[0].sha256='a'.repeat(64);
    if(mutation==='size')e.totalBytes++;
    if(mutation==='installer')e.installers=[{path:'foreign.exe'}];
    if(mutation==='signature')e.signature='signed';
    await fs.writeFile(f.evidenceFile,JSON.stringify(e));
    await assert.rejects(verifyPortableInputs(f.root,f.run.runFile),/PORTABLE_/,mutation);
  }
  const f=await fixture();await fs.rename(f.evidenceFile,f.evidenceFile+'.retained');
  await assert.rejects(verifyPortableInputs(f.root,f.run.runFile),/ENOENT/);
});
test('source manifest or sealed bytes changing invalidates the derivative',async()=>{
  const f=await fixture();await fs.writeFile(path.join(f.packageRoot,'resources/app.asar'),'altered');
  await assert.rejects(verifyPortableInputs(f.root,f.run.runFile),/OUTPUT_CHANGED_AFTER_SEAL/);
  const g=await fixture();await fs.writeFile(path.join(g.root,'desktop/build/build-manifest.json'),'altered');
  await assert.rejects(verifyPortableInputs(g.root,g.run.runFile),/BUILD_MANIFEST_CHANGED/);
});
test('unsafe ZIP paths, Windows aliases, extra files and special entries are rejected',()=>{
  const files=[{path:'resources/normal.txt',bytes:2,sha256:hash('ok')}];
  const listing=(name,extra='')=>`7-Zip\n----------\nPath = ${name}\nSize = 2\nAttributes = A\n${extra}`;
  assert.equal(verifyPortableListing(listing('resources/normal.txt'),files).length,1);
  for(const name of ['../out','C:/out','x:ads','x\\out','/out','a./out','COM¹.txt','nul.json','x/../a','a\nnext'])assert.throws(()=>portablePath(name),/PATH_DENIED/);
  assert.throws(()=>verifyPortableListing(listing('other.txt'),files),/FILE_MISMATCH/);
  assert.throws(()=>verifyPortableListing(listing('resources/normal.txt','Symbolic Link = ../out\n'),files),/LINK_DENIED/);
  assert.throws(()=>verifyPortableListing(listing('resources/normal.txt','Mode = prw-r--r--\n'),files),/SPECIAL_FILE/);
  assert.throws(()=>verifyPortableListing(listing('resources/normal.txt')+'\nPath = RESOURCES/normal.txt\nSize = 2\n',files),/PATH_DENIED/);
});
test('actual junctions and hard links are rejected without following their contents',async()=>{
  const f=await fixture(),outside=await fs.mkdtemp(path.join(os.tmpdir(),'portable-outside-'));
  await fs.writeFile(path.join(outside,'sentinel'),'owned sentinel');
  await fs.symlink(outside,path.join(f.packageRoot,'linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(portableInventory(f.packageRoot),/LINK_DENIED/);
  assert.equal(await fs.readFile(path.join(outside,'sentinel'),'utf8'),'owned sentinel');
  const g=await fixture();await fs.link(path.join(g.packageRoot,'resources/app.asar'),path.join(g.packageRoot,'hardlink'));
  await assert.rejects(portableInventory(g.packageRoot),/NOT_ORDINARY/);
});
test('owned failure retains a failed report and cannot create a portable seal',async()=>{
  const f=await fixture();await fs.writeFile(f.evidenceFile,JSON.stringify({...f.evidence,commit:'0'.repeat(40)}));
  let directory;await assert.rejects(sealPortable(f.root,f.run.runFile),error=>{directory=error.portableDirectory;return /EVIDENCE_MISMATCH/.test(error.message);});
  const report=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));
  assert.equal(report.passed,false);assert.ok(report.error);assert.ok(!(await fs.readdir(directory)).includes('portable-seal.json'));
  await verifySeal(f.run);
});
test('a foreign run cannot create an output directory in either release',async()=>{
  const a=await fixture(),b=await fixture(),before=await fs.readdir(path.dirname(b.run.runFile));
  await assert.rejects(sealPortable(a.root,b.run.runFile),/OUTSIDE_OWNER/);
  assert.deepEqual(await fs.readdir(path.dirname(b.run.runFile)),before);
});
test('wrong inherited archive pin is a retained failure, never a PATH fallback', {skip:!tool},async()=>{
  const f=await fixture({tool:{...tool,sha256:'0'.repeat(64)}});let directory;
  await assert.rejects(sealPortable(f.root,f.run.runFile),error=>{directory=error.portableDirectory;return /TOOL_PIN_MISMATCH/.test(error.message);});
  const names=await fs.readdir(directory);assert.ok(!names.some(name=>name.endsWith('.zip')||name==='portable-seal.json'));
  assert.equal(JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8')).passed,false);
});
test('pinned 7-Zip creates and extracts only a tiny owned fixture; repeat runs preserve prior output', {skip:!tool},async()=>{
  const f=await fixture(),original=await verifySeal(f.run);
  const first=await sealPortable(f.root,f.run.runFile),second=await sealPortable(f.root,f.run.runFile);
  assert.notEqual(first.directory,second.directory);assert.deepEqual(await verifySeal(f.run),original);
  const evidence=JSON.parse(await fs.readFile(first.evidenceFile,'utf8')),seal=JSON.parse(await fs.readFile(path.join(first.directory,'portable-seal.json'),'utf8'));
  assert.deepEqual(evidence.files,f.evidence.files);assert.equal(seal.archive.sha256,hash(await fs.readFile(path.join(first.directory,first.archive.path))));
  assert.equal(seal.evidenceSha256,hash(await fs.readFile(first.evidenceFile)));
  assert.equal(evidence.signature,'unsigned-local-preview');assert.equal(evidence.portableExecuted,false);
  assert.equal(JSON.parse(await fs.readFile(path.join(first.directory,'report.json'),'utf8')).passed,true);
  await fs.writeFile(path.join(first.directory,'extracted/resources/app.asar'),'changed extracted file');
  await assert.rejects(verifyPortablePayload(path.join(first.directory,'extracted'),evidence.files),/EXTRACTED_BYTES_MISMATCH/);
  await verifyPortablePayload(path.join(second.directory,'extracted'),evidence.files);
  console.log(JSON.stringify({evidenceType:'tiny-owned-payload-real-pinned-7zip',directory:second.directory,
    archive:second.archive,files:evidence.files.length,totalBytes:evidence.totalBytes,tool,
    firstExtractedTamperRejected:true,originalSealUnchanged:JSON.stringify(await verifySeal(f.run))===JSON.stringify(original)}));
});
