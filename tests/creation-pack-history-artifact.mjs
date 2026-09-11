// Read-only verification of an existing source directory and actual exported PCK.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{verifyCreationPack}=require('../plugins/craftmine-world/godot-creation-pack.cjs');
const [source,packPath]=process.argv.slice(2);if(!source||!packPath||!path.isAbsolute(source)||!path.isAbsolute(packPath))throw Error('Explicit absolute source and PCK paths are required');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const pins=[];
function walk(directory,prefix=''){
 for(const item of fs.readdirSync(directory,{withFileTypes:true})){
  if(item.isSymbolicLink())throw Error('Artifact fixture must not follow symlinks');
  const file=path.join(directory,item.name),name=prefix+item.name;
  if(item.isDirectory())walk(file,name+'/');
  else if(item.isFile()){const data=fs.readFileSync(file);pins.push({path:name,bytes:data.length,sha256:digest(data)});}
 }
}
walk(source);
const data=fs.readFileSync(packPath),before=digest(data),proof=verifyCreationPack(data,pins);
assert.equal(proof.observerContract.historical,true);
assert.equal(digest(fs.readFileSync(packPath)),before);
for(const pin of proof.files)assert.equal(digest(fs.readFileSync(path.join(source,pin.path))),pin.sha256);
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/creation-pack-history-'));
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({source,packPath,sourceFiles:pins,proof,readOnly:true,scope:'Actual artifact byte verification only; restoration and startup remain separate acceptance.'},null,2));
console.log(JSON.stringify({out,proof},null,2));
