// Static glTF 2.0 / GLB decoding shared by the server and isolated renderer.
// Reference: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
export const ASSET_LIMITS={bytes:8*1024*1024,jsonBytes:1024*1024,triangles:50000,vertices:150000,decodedValues:2_000_000,nodes:512,draws:128,images:8,imageSide:2048,imagePixels:8_388_608};
const fail=text=>{throw Error(text);};
const integer=(value,min,max,label='索引')=>{if(!Number.isInteger(value)||value<min||value>max)fail(label+'无效或超过素材预算');return value;};
const array=(value,max,label)=>{if(!Array.isArray(value)||value.length>max)fail(label+'无效或超过素材预算');return value;};
const numbers=(value,length,label,limit=1e6)=>{if(!Array.isArray(value)||value.length!==length||value.some(n=>!Number.isFinite(n)||Math.abs(n)>limit))fail(label+'无效');return value;};
const item=(items,id,label)=>items[integer(id,0,items.length-1,label)];
export function fromBase64(value){
  if(typeof value!=='string'||!value.length||value.length>Math.ceil(ASSET_LIMITS.bytes/3)*4||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('素材编码无效或文件超过 8 MB');
  const text=atob(value),bytes=new Uint8Array(text.length);if(bytes.length>ASSET_LIMITS.bytes)fail('素材文件超过 8 MB');for(let i=0;i<bytes.length;i++)bytes[i]=text.charCodeAt(i);return bytes;
}
export function imageInfo(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<24||bytes.length>ASSET_LIMITS.bytes)fail('图片文件无效或过大');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width,height,mime;
  if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)){
    if(bytes.length<33||v.getUint32(8)!==13||v.getUint32(12)!==0x49484452)fail('PNG 图片头无效');width=v.getUint32(16);height=v.getUint32(20);mime='image/png';
  }else if(bytes[0]===255&&bytes[1]===216){
    mime='image/jpeg';let offset=2;
    while(offset+3<bytes.length){
      if(bytes[offset++]!==255)fail('JPEG 标记无效');while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;
      const length=v.getUint16(offset);if(length<2||offset+length>bytes.length)fail('JPEG 数据被截断');
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)fail('JPEG 尺寸无效');height=v.getUint16(offset+3);width=v.getUint16(offset+5);break;}offset+=length;
    }
  }else fail('目前支持 PNG、JPEG 图片和 GLB 模型');
  integer(width,1,ASSET_LIMITS.imageSide,'图片宽度（最大 2048）');integer(height,1,ASSET_LIMITS.imageSide,'图片高度（最大 2048）');
  return {mime,width,height};
}
export const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function multiplyMatrix(a,b){const result=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)result[c*4+r]+=a[k*4+r]*b[c*4+k];return result;}
function matrix(node){
  if(node.matrix){if(['translation','rotation','scale'].some(k=>Object.hasOwn(node,k)))fail('节点不能同时使用矩阵和位移/旋转/缩放');const m=numbers(node.matrix,16,'节点矩阵');if(m[3]||m[7]||m[11]||m[15]!==1)fail('节点需要仿射矩阵');return m;}
  const t=numbers(node.translation||[0,0,0],3,'节点位移'),s=numbers(node.scale||[1,1,1],3,'节点缩放'),q=numbers(node.rotation||[0,0,0,1],4,'节点旋转');
  if(Math.abs(Math.hypot(...q)-1)>.001)fail('旋转四元数需要归一化');const [x,y,z,w]=q;
  return [(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,(2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,(2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,...t,1];
}
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normal=v=>{const length=Math.hypot(...v);return length>1e-12?v.map(n=>n/length):[0,1,0];};
const position=(m,v)=>[0,1,2].map(i=>m[i]*v[0]+m[i+4]*v[1]+m[i+8]*v[2]+m[i+12]);

export function decodeGLB(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<28||bytes.length>ASSET_LIMITS.bytes)fail('GLB 文件无效或超过 8 MB');
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(data.getUint32(0,true)!==0x46546c67||data.getUint32(4,true)!==2||data.getUint32(8,true)!==bytes.length)fail('GLB 文件头或长度无效，需要 glTF 2.0');
  let offset=12,json,bin,chunkIndex=0;
  while(offset<bytes.length){
    if(offset+8>bytes.length)fail('GLB 数据块被截断');const length=data.getUint32(offset,true),type=data.getUint32(offset+4,true);offset+=8;
    if(length%4||offset+length>bytes.length)fail('GLB 数据块长度或对齐无效');
    if(type===0x4e4f534a){if(chunkIndex!==0||json||length>ASSET_LIMITS.jsonBytes)fail('GLB JSON 数据块无效或过大');try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset,offset+length)));}catch{fail('GLB JSON 无法解析');}}
    else if(type===0x004e4942){if(chunkIndex!==1||bin)fail('GLB 二进制数据块无效');bin=bytes.subarray(offset,offset+length);}
    else if(chunkIndex===0)fail('GLB 首个数据块必须是 JSON');
    offset+=length;chunkIndex++;
  }
  if(json?.asset?.version!=='2.0'||json.asset.minVersion&&json.asset.minVersion!=='2.0'||!bin)fail('需要带内嵌数据的 glTF 2.0 GLB 文件');
  const required=array(json.extensionsRequired||[],32,'扩展列表'),used=array(json.extensionsUsed||[],32,'扩展列表');if([...required,...used].some(e=>typeof e!=='string'||e.length>80))fail('扩展名称无效');if(required.some(e=>e!=='KHR_materials_unlit'))fail('暂不支持模型必需的扩展：'+required.filter(e=>e!=='KHR_materials_unlit').join('、'));
  if((json.animations?.length||0)||(json.skins?.length||0))fail('当前导入静态模型，请先烘焙姿态并导出不含动画和骨骼的 GLB');
  const buffers=array(json.buffers||[],1,'缓冲区');if(buffers.length!==1||buffers[0].uri!==undefined)fail('GLB 需要单个内嵌缓冲区，不能依赖外部文件');
  const binLength=integer(buffers[0].byteLength,1,bin.length,'缓冲区长度');if(bin.length-binLength>3)fail('GLB 缓冲区长度不一致');
  const views=array(json.bufferViews||[],1024,'缓冲视图'),accessors=array(json.accessors||[],1024,'访问器'),nodes=array(json.nodes||[],ASSET_LIMITS.nodes,'节点'),meshes=array(json.meshes||[],128,'网格');
  const getView=id=>{const v=item(views,id,'缓冲视图');if(v.buffer!==0)fail('缓冲视图只能引用内嵌数据');const start=integer(v.byteOffset??0,0,binLength,'视图偏移'),length=integer(v.byteLength,1,binLength,'视图长度');if(start+length>binLength)fail('缓冲视图超出文件');return {start,length,stride:v.byteStride};};
  // Validate every view, including images and unused views, without allocating its length.
  for(let i=0;i<views.length;i++)getView(i);
  const sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},types={SCALAR:1,VEC2:2,VEC3:3,VEC4:4},cache=new Map();let decodedValues=0;
  const scalar=(view,at,component,normalized)=>{let n=component===5120?view.getInt8(at):component===5121?view.getUint8(at):component===5122?view.getInt16(at,true):component===5123?view.getUint16(at,true):component===5125?view.getUint32(at,true):view.getFloat32(at,true);if(normalized)n=component===5120?Math.max(-1,n/127):component===5121?n/255:component===5122?Math.max(-1,n/32767):n/65535;if(!Number.isFinite(n)||Math.abs(n)>1e9)fail('顶点包含无效数值');return n;};
  const readValues=(viewId,byteOffset,count,width,component,normalized,sparse=false)=>{
    const view=getView(viewId),bytesPer=sizes[component];if(!bytesPer)fail('顶点数据类型不支持');const start=integer(byteOffset??0,0,view.length,'访问器偏移'),stride=view.stride??width*bytesPer;
    if(sparse&&view.stride!==undefined||view.stride!==undefined&&(stride<width*bytesPer||stride>252||stride%4)||stride%bytesPer||start%bytesPer||(view.start+start)%bytesPer||start+(count-1)*stride+width*bytesPer>view.length)fail('顶点步长、对齐或长度无效');
    const source=new DataView(bin.buffer,bin.byteOffset+view.start,view.length),values=new Float32Array(count*width);for(let i=0;i<count;i++)for(let k=0;k<width;k++)values[i*width+k]=scalar(source,start+i*stride+k*bytesPer,component,normalized);return values;
  };
  const accessor=id=>{
    if(cache.has(id))return cache.get(id);const a=item(accessors,id,'访问器'),width=types[a.type],component=a.componentType,count=integer(a.count,1,ASSET_LIMITS.vertices,'顶点数量');
    if(!width||!sizes[component]||a.normalized!==undefined&&typeof a.normalized!=='boolean'||a.normalized&&![5120,5121,5122,5123].includes(component))fail('访问器类型或归一化标记无效');
    decodedValues+=count*width;if(decodedValues>ASSET_LIMITS.decodedValues)fail('模型解码数据超过预算');
    let values;if(a.bufferView!==undefined)values=readValues(a.bufferView,a.byteOffset,count,width,component,a.normalized);else{if(a.byteOffset)fail('没有缓冲视图时不能指定字节偏移');values=new Float32Array(count*width);}
    if(a.sparse){const sparse=a.sparse,n=integer(sparse.count,1,count,'稀疏数量');if(![5121,5123,5125].includes(sparse.indices?.componentType))fail('稀疏索引类型无效');const indices=readValues(sparse.indices.bufferView,sparse.indices.byteOffset,n,1,sparse.indices.componentType,false,true),overrides=readValues(sparse.values?.bufferView,sparse.values?.byteOffset,n,width,component,a.normalized,true);let previous=-1;for(let i=0;i<n;i++){const index=integer(indices[i],0,count-1,'稀疏索引');if(index<=previous)fail('稀疏索引需要严格递增');previous=index;values.set(overrides.subarray(i*width,(i+1)*width),index*width);}}
    const result={values,count,width,component,normalized:!!a.normalized};cache.set(id,result);return result;
  };
  const images=array(json.images||[],ASSET_LIMITS.images,'图片'),decodedImages=[];let pixels=0;
  for(const image of images){
    let imageBytes;
    if(image.bufferView!==undefined){if(image.uri!==undefined)fail('图片不能同时使用内嵌视图和 URI');const v=getView(image.bufferView);if(v.stride!==undefined)fail('图片缓冲视图不能包含顶点步长');imageBytes=bin.slice(v.start,v.start+v.length);}
    else{const uri=typeof image.uri==='string'&&image.uri.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);if(!uri)fail('模型贴图必须内嵌，不能读取外部网址或文件');imageBytes=fromBase64(uri[2]);if(image.mimeType&&image.mimeType!==uri[1])fail('贴图 MIME 不一致');}
    const info=imageInfo(imageBytes);if(image.mimeType&&image.mimeType!==info.mime)fail('贴图声明与实际格式不符');pixels+=info.width*info.height;if(pixels>ASSET_LIMITS.imagePixels)fail('模型贴图总像素超过预算');decodedImages.push({...info,bytes:imageBytes});
  }
  const textures=array(json.textures||[],32,'贴图'),samplers=array(json.samplers||[],32,'采样器');
  const materialDefs=array(json.materials||[],128,'材质');const warnings=new Set(['当前显示基础颜色、透明度与贴图，金属、粗糙度和法线贴图的光照效果简化。']);
  for(const extension of used)if(extension!=='KHR_materials_unlit')warnings.add('可选扩展未启用，显示基础定义：'+extension);
  const materials=materialDefs.map(m=>{
    const pbr=m.pbrMetallicRoughness||{},color=numbers(pbr.baseColorFactor||[1,1,1,1],4,'材质颜色',1);if(color.some(n=>n<0))fail('材质颜色不能为负数');
    const alpha=m.alphaMode??'OPAQUE';if(!['OPAQUE','MASK','BLEND'].includes(alpha))fail('透明模式无效');const cutoff=m.alphaCutoff??.5;if(!Number.isFinite(cutoff)||cutoff<0)fail('透明裁剪阈值无效');
    let texture=null;
    if(pbr.baseColorTexture){const ref=pbr.baseColorTexture,t=item(textures,ref.index,'贴图'),image=item(decodedImages,t.source,'贴图图片'),sampler=t.sampler===undefined?{}:item(samplers,t.sampler,'采样器');if(ref.extensions?.KHR_texture_transform)fail('贴图变换暂不支持，请烘焙 UV 后导出');
      const texCoord=integer(ref.texCoord??0,0,7,'纹理坐标集'),wrapS=sampler.wrapS??10497,wrapT=sampler.wrapT??10497;if(![33071,33648,10497].includes(wrapS)||![33071,33648,10497].includes(wrapT))fail('贴图环绕方式无效');
      texture={image:t.source,texCoord,wrapS,wrapT,nearest:sampler.magFilter===9728};
    }
    return {color:[...color],alpha,cutoff,doubleSided:m.doubleSided===true,unlit:!!m.extensions?.KHR_materials_unlit,texture};
  });materials.push({color:[1,1,1,1],alpha:'OPAQUE',cutoff:.5,doubleSided:false,unlit:false,texture:null});
  const parents=new Map(),marks=new Map();
  for(let i=0;i<nodes.length;i++){const n=nodes[i];if(n.skin!==undefined||n.weights!==undefined)fail('当前需要静态且无变形的节点');for(const child of array(n.children||[],ASSET_LIMITS.nodes,'子节点')){integer(child,0,nodes.length-1,'子节点');if(parents.has(child))fail('节点有多个父节点或重复子节点');parents.set(child,i);}}
  const inspect=(id,depth)=>{if(depth>64||marks.get(id)===1)fail('节点层级过深或存在循环');if(marks.get(id)===2)return;marks.set(id,1);matrix(nodes[id]);for(const child of nodes[id].children||[])inspect(child,depth+1);marks.set(id,2);};for(let i=0;i<nodes.length;i++)inspect(i,0);
  const scenes=array(json.scenes||[],64,'场景');if(!scenes.length)fail('模型没有可显示的场景');const roots=array(item(scenes,json.scene??0,'默认场景').nodes||[],ASSET_LIMITS.nodes,'根节点'),visited=new Set(),draws=[],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let triangles=0;
  const walk=(id,parent,depth)=>{
    item(nodes,id,'节点');if(depth>64||visited.has(id))fail('场景重复引用节点或层级过深');visited.add(id);const node=nodes[id],transform=multiplyMatrix(parent,matrix(node));
    if(node.mesh!==undefined){
      const mesh=item(meshes,node.mesh,'网格');if(mesh.weights)fail('当前需要不含变形权重的静态网格');const cofactor=[cross(transform.slice(4,7),transform.slice(8,11)),cross(transform.slice(8,11),transform.slice(0,3)),cross(transform.slice(0,3),transform.slice(4,7))],det=transform.slice(0,3).reduce((sum,n,i)=>sum+n*cofactor[0][i],0);if(Math.abs(det)<1e-16)fail('模型存在零尺度节点，请整理缩放后导出');
      for(const primitive of array(mesh.primitives,ASSET_LIMITS.draws,'子网格')){
        if(primitive.targets?.length)fail('当前需要不含变形目标的静态网格');if(primitive.extensions?.KHR_draco_mesh_compression)fail('请导出未使用 Draco 压缩的 GLB');
        const mode=primitive.mode??4;if(![4,5,6].includes(mode))fail('当前支持三角面、三角带和三角扇，请将线与点转成网格');
        const attributes=primitive.attributes||{},p=accessor(attributes.POSITION),n=attributes.NORMAL===undefined?null:accessor(attributes.NORMAL),c=attributes.COLOR_0===undefined?null:accessor(attributes.COLOR_0);
        const materialId=primitive.material===undefined?materials.length-1:integer(primitive.material,0,materialDefs.length-1,'材质'),mat=item(materials,materialId,'材质'),uvId=attributes['TEXCOORD_'+(mat.texture?.texCoord??0)],uv=uvId===undefined?null:accessor(uvId);
        if(p.width!==3||p.component!==5126||n&&(n.width!==3||n.component!==5126||n.count!==p.count)||c&&(![3,4].includes(c.width)||c.count!==p.count||!([5121,5123].includes(c.component)&&c.normalized||c.component===5126))||uv&&(uv.width!==2||uv.count!==p.count||!([5121,5123].includes(uv.component)&&uv.normalized||uv.component===5126)))fail('网格顶点属性类型或数量不一致');
        if(mat.texture&&!uv)fail('带贴图的网格缺少对应 UV 坐标');
        const indices=primitive.indices===undefined?null:accessor(primitive.indices);if(indices&&(indices.width!==1||![5121,5123,5125].includes(indices.component)||indices.normalized))fail('网格索引类型无效');const count=indices?.count||p.count;if(count<3||mode===4&&count%3)fail('三角面数量无效');
        const added=mode===4?count/3:count-2;triangles+=added;if(triangles>ASSET_LIMITS.triangles||draws.length>=ASSET_LIMITS.draws)fail('模型超过 50,000 三角面或 128 子网格预算');
        const vertices=new Float32Array(added*3*12);let cursor=0;
        const get=(a,index)=>Array.from(a.values.subarray(index*a.width,(index+1)*a.width));
        for(let tri=0;tri<added;tri++){
          let refs=mode===4?[tri*3,tri*3+1,tri*3+2]:mode===5?(tri%2?[tri+1,tri,tri+2]:[tri,tri+1,tri+2]):[0,tri+1,tri+2];if(det<0)[refs[1],refs[2]]=[refs[2],refs[1]];refs=refs.map(index=>integer(indices?indices.values[index]:index,0,p.count-1,'顶点索引'));
          const positions=refs.map(index=>position(transform,get(p,index))),faceNormal=normal(cross(positions[1].map((v,i)=>v-positions[0][i]),positions[2].map((v,i)=>v-positions[0][i])));
          for(let v=0;v<3;v++){
            const index=refs[v],point=positions[v];if(point.some(n=>!Number.isFinite(n)||Math.abs(n)>1e6))fail('变换后模型坐标无效');for(let k=0;k<3;k++){min[k]=Math.min(min[k],point[k]);max[k]=Math.max(max[k],point[k]);}
            const sourceNormal=n?get(n,index):null,transformedNormal=sourceNormal?normal([0,1,2].map(k=>cofactor.reduce((sum,column,i)=>sum+column[k]*sourceNormal[i],0)/det)):faceNormal;
            const color=c?get(c,index):[1,1,1,1];if(color.length===3)color.push(1);if(color.some(v=>v<0||v>1))fail('顶点颜色需要在 0 到 1 之间');const tex=uv?get(uv,index):[0,0];vertices.set([...point,...transformedNormal,...tex,...color],cursor);cursor+=12;
          }
        }
        draws.push({vertices,material:materialId});
      }
    }
    for(const child of node.children||[])walk(child,transform,depth+1);
  };
  for(const root of roots){integer(root,0,nodes.length-1,'根节点');if(parents.has(root))fail('场景根节点不能同时是子节点');walk(root,identity(),0);}
  if(!triangles||Math.max(...max.map((n,i)=>n-min[i]))<1e-8)fail('模型没有可见三角面');
  return {kind:'model',draws,materials,images:decodedImages,bounds:{min,max},triangles,warnings:[...warnings]};
}
export function decodeAsset(bytes,mime){
  if(mime==='model/gltf-binary')return decodeGLB(bytes);
  const info=imageInfo(bytes);if(info.mime!==mime)fail('图片声明与实际格式不符');return {kind:'image',...info,bytes,bounds:{min:[0,0,0],max:[info.width/info.height,1,0]},warnings:[]};
}
