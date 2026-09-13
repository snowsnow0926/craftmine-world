import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Only explicit operator paths enter here. No model tool can invoke this loader.
export async function prepareInputImages(data,files=[]) {
  const images=[];
  for(const input of files) {
    if(typeof input!=='string'||!path.isAbsolute(input)||!['.png','.jpg','.jpeg'].includes(path.extname(input).toLowerCase()))throw Error('INPUT_IMAGE_PATH_REQUIRED');
    const file=path.resolve(input);let cursor=path.parse(file).root;
    for(const part of file.slice(cursor.length).split(path.sep)){cursor=path.join(cursor,part);if((await fs.lstat(cursor)).isSymbolicLink())throw Error('INPUT_IMAGE_LINK_REFUSED');}
    const stat=await fs.stat(file);if(!stat.isFile())throw Error('INPUT_IMAGE_FILE_REQUIRED');
    const bytes=await fs.readFile(file);
    const png=bytes.length>=24&&bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&bytes.toString('ascii',12,16)==='IHDR';
    const jpeg=bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9;
    const extension=path.extname(file).toLowerCase();
    if(!(png&&extension==='.png'||jpeg&&['.jpg','.jpeg'].includes(extension)))throw Error('INPUT_IMAGE_FORMAT_MISMATCH');
    const sha256=createHash('sha256').update(bytes).digest('hex'),mimeType=png?'image/png':'image/jpeg';
    const directory=path.join(data,'input-images');await fs.mkdir(directory,{recursive:true});
    const storedPath=path.join(directory,sha256+(png?'.png':'.jpg'));
    try{await fs.writeFile(storedPath,bytes,{flag:'wx'});}catch(error){
      if(error.code!=='EEXIST')throw error;
      const existing=await fs.readFile(storedPath);if(createHash('sha256').update(existing).digest('hex')!==sha256)throw Error('INPUT_IMAGE_ARCHIVE_CHANGED');
    }
    images.push({input:{type:'image',url:`data:${mimeType};base64,${bytes.toString('base64')}`},
      provenance:{source:'operator-local-image',originalPath:file,storedPath,mimeType,sha256,bytes:bytes.length,importedAt:new Date().toISOString()}});
  }
  return images;
}
