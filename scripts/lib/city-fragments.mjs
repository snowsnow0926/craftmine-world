// Bounded deterministic extraction of static material-batched GLB triangles.
// Source files are never written. This is geometry processing, not model inference.
import {createHash} from 'node:crypto';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(value,code)=>{if(!value)throw Error(code);};
export function decodeCityGlb(bytes){
 check(bytes.readUInt32LE(0)===0x46546c67&&bytes.readUInt32LE(4)===2&&bytes.readUInt32LE(8)===bytes.length,'CITY_GLB_INVALID');
 const size=bytes.readUInt32LE(12);check(bytes.readUInt32LE(16)===0x4e4f534a&&bytes.readUInt32LE(24+size)===0x004e4942,'CITY_GLB_CHUNKS_INVALID');
 const json=JSON.parse(bytes.subarray(20,20+size).toString('utf8')),bin=bytes.subarray(28+size);
 check(!json.skins&&!json.animations&&!json.images&&!json.textures&&json.buffers?.length===1&&!json.buffers[0].uri,'CITY_GLB_STATIC_EMBEDDED_REQUIRED');
 const read=index=>{
  const a=json.accessors[index],v=json.bufferViews[a.bufferView],width={5121:1,5123:2,5125:4,5126:4}[a.componentType],components={SCALAR:1,VEC3:3}[a.type];
  check(width&&components&&!a.sparse&&!a.normalized&&v.buffer===0,'CITY_GLB_ACCESSOR_UNSUPPORTED');
  return Array.from({length:a.count},(_,i)=>Array.from({length:components},(_,c)=>{const offset=(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??width*components)+c*width;check(offset+width<=bin.length,'CITY_GLB_ACCESSOR_BOUNDS');return a.componentType===5126?bin.readFloatLE(offset):width===4?bin.readUInt32LE(offset):width===2?bin.readUInt16LE(offset):bin.readUInt8(offset);}));
 };
 return {json,read};
}
const inside=(p,box)=>p.every((n,i)=>n>=box.min[i]-1e-5&&n<=box.max[i]+1e-5);
function clipTriangle(triangle,box){
 let polygon=triangle;
 for(let axis=0;axis<3;axis++)for(const side of ['min','max']){
  const next=[],edge=box[side][axis],accept=p=>side==='min'?p.p[axis]>=edge:p.p[axis]<=edge;
  for(let i=0;i<polygon.length;i++){
   const a=polygon[i],b=polygon[(i+1)%polygon.length],aIn=accept(a),bIn=accept(b);
   if(aIn)next.push(a);
   if(aIn!==bIn){const t=(edge-a.p[axis])/(b.p[axis]-a.p[axis]);next.push({p:a.p.map((v,k)=>v+(b.p[k]-v)*t),n:a.n.map((v,k)=>v+(b.n[k]-v)*t)});}
  }
  polygon=next;if(polygon.length<3)return [];
 }
 return Array.from({length:polygon.length-2},(_,i)=>[polygon[0],polygon[i+1],polygon[i+2]]);
}
export function extractCityFragment({sources,parts,anchor}){
 const json={asset:{version:'2.0',generator:'Craftmine deterministic static city fragment extractor / 1'},scene:0,scenes:[{name:'CityFragment',nodes:[]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}],extensionsUsed:['KHR_materials_emissive_strength']};
 const buffers=[],materials=new Map(),stats={triangles:0,collisionTriangles:0,meshInstances:0,boundaryTrianglesExcluded:0,sourceTriangles:0,bounds:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},parts:[]};let offset=0;
 const accessor=(values,type,componentType,target)=>{const components=type==='VEC3'?3:1,bytes=Buffer.alloc(values.length*components*4);values.forEach((row,i)=>(Array.isArray(row)?row:[row]).forEach((v,c)=>componentType===5126?bytes.writeFloatLE(v,(i*components+c)*4):bytes.writeUInt32LE(v,(i*components+c)*4)));const view=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target});buffers.push(bytes);offset+=bytes.length;const result=json.accessors.length;json.accessors.push({bufferView:view,componentType,count:values.length,type,...(type==='VEC3'?{min:[0,1,2].map(c=>Math.min(...values.map(v=>v[c]))),max:[0,1,2].map(c=>Math.max(...values.map(v=>v[c])))}:{})});return result;};
 for(const part of parts){
  const source=sources[part.file],{json:original,read}=decodeCityGlb(source),partStats={file:part.file,sourceSha256:sha(source),boxes:part.boxes,clip:part.clip===true,triangles:0,excluded:0};
  for(const node of original.nodes){
   if(!new RegExp(part.nodePattern).test(node.name))continue;check(node.mesh!==undefined&&!node.children&&!node.matrix&&!node.translation&&!node.rotation&&!node.scale,'CITY_TRANSFORM_UNSUPPORTED');
   const primitives=[];
   for(const primitive of original.meshes[node.mesh].primitives){
    check((primitive.mode??4)===4&&Object.keys(primitive.attributes).every(key=>['POSITION','NORMAL'].includes(key)),'CITY_PRIMITIVE_UNSUPPORTED');
    const positions=read(primitive.attributes.POSITION),normals=read(primitive.attributes.NORMAL),indices=read(primitive.indices).flat(),selected=[];
    for(let i=0;i<indices.length;i+=3){
     const triangle=indices.slice(i,i+3).map(index=>({p:positions[index],n:normals[index]}));stats.sourceTriangles++;
     for(const box of part.boxes){
      if(triangle.every(v=>inside(v.p,box))){selected.push(triangle);break;}
      if(part.clip){selected.push(...clipTriangle(triangle,box));break;}
      if(triangle.some(v=>inside(v.p,box))){partStats.excluded++;break;}
     }
    }
    if(!selected.length)continue;
    const outPositions=[],outNormals=[],outIndices=[],vertices=new Map();
    for(const triangle of selected)for(const vertex of triangle){const p=vertex.p.map((n,c)=>Math.fround(n-anchor[c]+(part.translation?.[c]??0))),key=JSON.stringify([p,vertex.n]);if(!vertices.has(key)){vertices.set(key,outPositions.length);outPositions.push(p);outNormals.push(vertex.n);for(let c=0;c<3;c++){stats.bounds.min[c]=Math.min(stats.bounds.min[c],p[c]);stats.bounds.max[c]=Math.max(stats.bounds.max[c],p[c]);}}outIndices.push(vertices.get(key));}
    const material=original.materials[primitive.material],materialKey=JSON.stringify(material);if(!materials.has(materialKey)){materials.set(materialKey,json.materials.length);json.materials.push(structuredClone(material));}
    primitives.push({attributes:{POSITION:accessor(outPositions,'VEC3',5126,34962),NORMAL:accessor(outNormals,'VEC3',5126,34962)},indices:accessor(outIndices,'SCALAR',5125,34963),material:materials.get(materialKey),mode:4});
    partStats.triangles+=selected.length;stats.triangles+=selected.length;if(/^(Solid_|HiddenSolid_)/.test(node.name))stats.collisionTriangles+=selected.length;
   }
   if(primitives.length){json.scenes[0].nodes.push(json.nodes.length);json.nodes.push({name:node.name,mesh:json.meshes.length});json.meshes.push({name:node.name,primitives});stats.meshInstances++;}
  }
  stats.boundaryTrianglesExcluded+=partStats.excluded;stats.parts.push(partStats);
 }
 check(stats.triangles>0&&stats.collisionTriangles>0,'CITY_FRAGMENT_EMPTY');json.buffers[0].byteLength=offset;
 const body=Buffer.concat(buffers),raw=Buffer.from(JSON.stringify(json)),padded=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),header=Buffer.alloc(20),binHeader=Buffer.alloc(8);
 header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+body.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);binHeader.writeUInt32LE(body.length,0);binHeader.writeUInt32LE(0x004e4942,4);
 return {bytes:Buffer.concat([header,padded,binHeader,body]),stats};
}
