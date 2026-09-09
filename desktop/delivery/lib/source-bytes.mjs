import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const oidOf=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export function canonicalBlobBytes(bytes,oid,label='source'){
  if(!/^[a-f0-9]{40}$/.test(oid))throw Error('SOURCE_OBJECT_FORMAT_UNSUPPORTED:'+label);
  if(oidOf(bytes)===oid)return bytes;
  if(bytes.includes(0))throw Error('SOURCE_BYTES_CHANGED:'+label);
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('SOURCE_BYTES_CHANGED:'+label);}
  const canonical=Buffer.from(text.replace(/\r\n/g,'\n'));
  if(oidOf(canonical)!==oid)throw Error('SOURCE_BYTES_CHANGED:'+label);
  return canonical;
}
export function git(root,args){return execFileSync('git',args,{cwd:root,windowsHide:true,maxBuffer:32*1024*1024});}
export function ordinarySource(root,relative){
  if(!relative||relative.includes('\\')||relative.includes(':')||relative.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('SOURCE_PATH_INVALID');
  let current=path.resolve(root);if(fs.lstatSync(current).isSymbolicLink())throw Error('SOURCE_LINK_DENIED');
  for(const part of relative.split('/')){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('SOURCE_LINK_DENIED:'+relative);}
  if(!fs.statSync(current).isFile())throw Error('SOURCE_NOT_FILE:'+relative);
  return current;
}
export function readGitSnapshot(root,commit,prefixes){
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('EXACT_SOURCE_COMMIT_REQUIRED');
  const records=git(root,['ls-tree','-r','-z',commit,'--',...prefixes]).toString('utf8').split('\0').filter(Boolean),files=new Map();
  for(const record of records){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(record);
    if(!match)throw Error('SOURCE_LINK_OR_SUBMODULE_DENIED:'+record);
    const [,mode,oid,relative]=match,full=ordinarySource(root,relative),raw=fs.readFileSync(full),bytes=canonicalBlobBytes(raw,oid,relative);
    files.set(relative,{relative,mode,oid,bytes,rawBytes:raw,sha256:createHash('sha256').update(bytes).digest('hex'),checkoutDiffers:!bytes.equals(raw)});
  }
  return files;
}
