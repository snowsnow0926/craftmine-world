const FACES=[
  {n:[-1,0,0],c:[[0,1,0],[0,0,0],[0,1,1],[0,0,1]]},
  {n:[1,0,0],c:[[1,1,1],[1,0,1],[1,1,0],[1,0,0]]},
  {n:[0,-1,0],c:[[1,0,1],[0,0,1],[1,0,0],[0,0,0]]},
  {n:[0,1,0],c:[[0,1,1],[1,1,1],[0,1,0],[1,1,0]]},
  {n:[0,0,-1],c:[[1,0,0],[0,0,0],[1,1,0],[0,1,0]]},
  {n:[0,0,1],c:[[0,0,1],[1,0,1],[0,1,1],[1,1,1]]},
];
const tiles={dirt:1,stone:2,leaves:4,planks:5,sand:6,brick:7,light:15,glass:11,solid:14};
export function primitiveVertices(parts){
  const vertices=[];
  for(const p of parts){
    const color=[1,3,5].map(i=>parseInt(p.color.slice(i,i+2),16)/255);
    // Neutral atlas texel for plain color; compensate the legacy atlas's warm white.
    if(p.material==='solid')for(let i=0;i<3;i++)color[i]*=255/[226,227,210][i];
    const faces=p.shape==='box'?FACES:[
      {n:[0,0,1],c:[[0,0,.5],[.55,0,.5],[.7,1,.5],[.7,1,.5]]},
      {n:[0,0,-1],c:[[.55,0,.5],[0,0,.5],[.7,1,.5],[.7,1,.5]]},
      {n:[1,0,0],c:[[.5,0,.1],[.5,0,.65],[.5,1,1],[.5,1,1]]},
      {n:[-1,0,0],c:[[.5,0,.65],[.5,0,.1],[.5,1,1],[.5,1,1]]},
    ];
    for(const face of faces){
      const tile=p.material==='wood'?(face.n[1]?13:3):p.material==='grass'?(face.n[1]>0?0:face.n[1]<0?1:12):tiles[p.material];
      const uv=[[.03,.03],[.03,.97],[.97,.03],[.97,.97]];
      const axes=face.n[0]?[1,2]:face.n[1]?[0,2]:[0,1],dimensions=[p.size.x,p.size.y,p.size.z];
      const subdivisions=axes.map(a=>p.material!=='solid'&&p.shape==='box'?Math.ceil(dimensions[a]):1);
      for(let a=0;a<subdivisions[0];a++)for(let b=0;b<subdivisions[1];b++)for(const i of [0,1,2,2,1,3]){
        const c=face.c[i].slice(),tex=p.material==='solid'?[.5,.5]:uv[i];
        c[axes[0]]=(a+c[axes[0]])/subdivisions[0];c[axes[1]]=(b+c[axes[1]])/subdivisions[1];
        vertices.push(p.min.x+c[0]*p.size.x,p.min.y+c[1]*p.size.y,p.min.z+c[2]*p.size.z,...face.n,((tile%8)+tex[0])/8,(Math.floor(tile/8)+tex[1])/2,...color);
      }
    }
  }
  return vertices;
}
export function intersects(a,b){return ['x','y','z'].every(k=>a.min[k]<b.max[k]-0.00001&&a.max[k]>b.min[k]+0.00001);}
export function rayBox(origin,dir,box,reach=80){
  let near=0,far=reach,normal=[0,0,0];
  for(let i=0;i<3;i++){
    const axis=['x','y','z'][i],min=box.min[axis],max=box.max[axis];
    if(Math.abs(dir[i])<1e-9){if(origin[i]<min||origin[i]>max)return null;continue;}
    let t1=(min-origin[i])/dir[i],t2=(max-origin[i])/dir[i],sign=-1;
    if(t1>t2){[t1,t2]=[t2,t1];sign=1;}
    if(t1>near){near=t1;normal=[0,0,0];normal[i]=sign;}far=Math.min(far,t2);if(near>far)return null;
  }
  return near<=reach?{distance:near,normal}:null;
}
