import { deflateSync } from 'node:zlib';
export function png(width=4,height=4,color=[35,142,91,255]){
  const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([name,data])),out.length-4);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const scanlines=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const pixel=typeof color==='function'?color(x,y):color;for(let c=0;c<4;c++)scanlines[y*(width*4+1)+1+x*4+c]=pixel[c];}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scanlines)),chunk('IEND',Buffer.alloc(0))]);
}
export function packGLB(json,bin){
  json=structuredClone(json);json.buffers=[{byteLength:bin.length}];const text=Buffer.from(JSON.stringify(json)),jsonChunk=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(jsonChunk);const binChunk=Buffer.alloc(Math.ceil(bin.length/4)*4);Buffer.from(bin).copy(binChunk);
  const result=Buffer.alloc(12+8+jsonChunk.length+8+binChunk.length);result.writeUInt32LE(0x46546c67);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(jsonChunk.length,12);result.writeUInt32LE(0x4e4f534a,16);jsonChunk.copy(result,20);result.writeUInt32LE(binChunk.length,20+jsonChunk.length);result.writeUInt32LE(0x004e4942,24+jsonChunk.length);binChunk.copy(result,28+jsonChunk.length);return result;
}
export function triangleFixture({texture=false,interleaved=false}={}){
  const positions=[-.5,0,0,.5,0,0,0,1,0],uv=[0,1,1,1,.5,0],buffer=Buffer.alloc(interleaved?60:42);
  if(interleaved){for(let i=0;i<3;i++){for(let k=0;k<3;k++)buffer.writeFloatLE(positions[i*3+k],i*20+k*4);for(let k=0;k<2;k++)buffer.writeFloatLE(uv[i*2+k],i*20+12+k*4);}}
  else{for(let i=0;i<9;i++)buffer.writeFloatLE(positions[i],i*4);[0,1,2].forEach((n,i)=>buffer.writeUInt16LE(n,36+i*2));}
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},...(interleaved?{}:{indices:1}),material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.1,.7,.4,1]}}],bufferViews:[{buffer:0,byteOffset:0,byteLength:interleaved?60:36,...(interleaved?{byteStride:20}:{})},...(interleaved?[]:[{buffer:0,byteOffset:36,byteLength:6}])],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},...(interleaved?[]:[{bufferView:1,componentType:5123,count:3,type:'SCALAR'}])]};
  let bin=buffer;
  if(interleaved){json.accessors.push({bufferView:0,byteOffset:12,componentType:5126,count:3,type:'VEC2'});json.meshes[0].primitives[0].attributes.TEXCOORD_0=1;}
  if(texture){if(!interleaved)throw Error('Textured fixture needs interleaved data');const image=png();json.bufferViews.push({buffer:0,byteOffset:buffer.length,byteLength:image.length});json.images=[{bufferView:1,mimeType:'image/png'}];json.textures=[{source:0}];json.materials[0].pbrMetallicRoughness={baseColorFactor:[1,1,1,1],baseColorTexture:{index:0}};bin=Buffer.concat([buffer,image]);}
  return {json,bin,bytes:()=>packGLB(json,bin)};
}
