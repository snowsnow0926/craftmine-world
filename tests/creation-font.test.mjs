import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const base=new URL('../desktop/godot/bases/creation-sandbox/assets/fonts/',import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('full CJK font retains source provenance and every text part fits the existing source transport',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('font.json',base)));let encoded='';
 assert.equal(m.license,'OFL-1.1');assert.equal(m.glyphCoverage,30890);
 assert.equal(hash(fs.readFileSync(new URL('../'+m.source,import.meta.url))),m.sourceSha256);
 assert.match(fs.readFileSync(new URL(m.licenseFile,base),'utf8'),/SIL OPEN FONT LICENSE/);
 for(const [index,part]of m.parts.entries()){
  const bytes=fs.readFileSync(new URL(part.path,base));assert.equal(bytes.length,part.bytes);assert.ok(bytes.length<4*1024*1024);assert.equal(hash(bytes),part.sha256);
  const value=JSON.parse(bytes);assert.equal(value.index,index);assert.equal(value.format,'craftmine.font-part/1');encoded+=value.data;
 }
 const bytes=Buffer.from(encoded,'base64');assert.equal(bytes.toString('ascii',0,4),'wOF2');assert.equal(bytes.length,m.bytes);assert.equal(hash(bytes),m.sha256);
 assert.ok(m.parts.reduce((sum,p)=>sum+Math.ceil(p.bytes/3)*4,0)<8*1024*1024,'base64 source RPC batch remains within the core patch input limit');
});
