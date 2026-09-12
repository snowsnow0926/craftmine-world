// Small ZIP32 reader for the hash-pinned official Blender archive. Uses Node's
// Windows long-path support; PowerShell 5's ZIP API truncates official paths.
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createInflateRaw} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';

export async function extractBlenderArchive(archive,destination,archiveRoot,validatePath){
  if((await fs.readdir(destination)).length)throw Error('BLENDER_EXTRACTION_REQUIRES_EMPTY_DIRECTORY');
  const file=await fs.open(archive,'r');
  try{
    const size=(await file.stat()).size,tail=Buffer.alloc(Math.min(size,65557));
    await file.read(tail,0,tail.length,size-tail.length);
    let end=-1;
    for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
    if(end<0||tail.readUInt16LE(end+4)!==0||tail.readUInt16LE(end+6)!==0)throw Error('BLENDER_ZIP_FORMAT_DENIED');
    const count=tail.readUInt16LE(end+10),centralSize=tail.readUInt32LE(end+12),centralOffset=tail.readUInt32LE(end+16);
    if(count===65535||centralOffset+centralSize>size-tail.length+end||centralSize>16*1024*1024)throw Error('BLENDER_ZIP_DIRECTORY_INVALID');
    const central=Buffer.alloc(centralSize);await file.read(central,0,centralSize,centralOffset);
    let offset=0;const entries=[],names=new Set();
    for(let i=0;i<count;i++){
      if(offset+46>central.length||central.readUInt32LE(offset)!==0x02014b50)throw Error('BLENDER_ZIP_DIRECTORY_INVALID');
      const flags=central.readUInt16LE(offset+8),method=central.readUInt16LE(offset+10),compressed=central.readUInt32LE(offset+20),bytes=central.readUInt32LE(offset+24),nameSize=central.readUInt16LE(offset+28),extraSize=central.readUInt16LE(offset+30),commentSize=central.readUInt16LE(offset+32),attributes=central.readUInt32LE(offset+38),localOffset=central.readUInt32LE(offset+42);
      const name=central.subarray(offset+46,offset+46+nameSize).toString('utf8'),directory=name.endsWith('/'),relative=validatePath(directory?name.slice(0,-1):name);
      if((flags&1)||![0,8].includes(method)||((attributes>>>16)&0xf000)===0xa000||!relative.startsWith(archiveRoot+'/')&&relative!==archiveRoot)throw Error('BLENDER_ZIP_ENTRY_DENIED');
      if(names.has(relative.toLowerCase()))throw Error('BLENDER_ZIP_DUPLICATE_PATH');names.add(relative.toLowerCase());
      const target=path.resolve(destination,...relative.split('/'));
      if(!target.startsWith(path.resolve(destination)+path.sep))throw Error('BLENDER_ZIP_ESCAPE');
      entries.push({target,directory,compressed,bytes,localOffset,method});offset+=46+nameSize+extraSize+commentSize;
    }
    if(offset!==central.length)throw Error('BLENDER_ZIP_DIRECTORY_INVALID');
    for(const entry of entries){
      if(entry.directory){await fs.mkdir(entry.target,{recursive:true});continue;}
      const header=Buffer.alloc(30);await file.read(header,0,30,entry.localOffset);
      if(header.readUInt32LE(0)!==0x04034b50)throw Error('BLENDER_ZIP_HEADER_INVALID');
      const start=entry.localOffset+30+header.readUInt16LE(26)+header.readUInt16LE(28);
      if(start+entry.compressed>centralOffset)throw Error('BLENDER_ZIP_DATA_INVALID');
      await fs.mkdir(path.dirname(entry.target),{recursive:true});
      if(entry.compressed===0)await fs.writeFile(entry.target,Buffer.alloc(0),{flag:'wx'});
      else{
        const input=createReadStream(archive,{start,end:start+entry.compressed-1}),output=createWriteStream(entry.target,{flags:'wx'});
        if(entry.method===8)await pipeline(input,createInflateRaw(),output);else await pipeline(input,output);
      }
      if((await fs.stat(entry.target)).size!==entry.bytes)throw Error('BLENDER_ZIP_SIZE_MISMATCH');
    }
  }finally{await file.close();}
}
