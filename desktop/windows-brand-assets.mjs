// Original geometric voxel mark. Reproducible vector/raster assets; no
// upstream logo pixels or external artwork are copied into the product mark.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {deflateSync} from 'node:zlib';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../vendor/pi-desktop/apps/desktop/build');
const polygons=[{color:'#95cf75',points:[[128,132],[256,70],[384,132],[256,198]]},{color:'#477f4d',points:[[128,132],[256,198],[256,370],[128,304]]},{color:'#d8b46c',points:[[256,198],[384,132],[384,304],[256,370]]},{color:'#f6e8b3',points:[[210,227],[236,240],[256,301],[276,240],[302,227],[270,331],[242,331]]}];
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect x="20" y="20" width="472" height="472" rx="112" fill="#16342b"/>${polygons.map(p=>`<polygon points="${p.points.map(v=>v.join(',')).join(' ')}" fill="${p.color}"/>`).join('')}</svg>`;
function inside(x,y,points){let value=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const [a,b]=points[i],[c,d]=points[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)value=!value;}return value;}
function makePng(size){
const raw=Buffer.alloc(size*(size*4+1));
for(let y=0;y<size;y++)for(let x=0;x<size;x++){const px=(x+.5)*512/size,py=(y+.5)*512/size;let color;const dx=Math.max(132-px,0,px-380),dy=Math.max(132-py,0,py-380);if(px>=20&&px<492&&py>=20&&py<492&&dx*dx+dy*dy<=112*112)color='#16342b';for(const p of polygons)if(inside(px,py,p.points))color=p.color;if(color){const i=y*(size*4+1)+1+x*4;raw[i]=parseInt(color.slice(1,3),16);raw[i+1]=parseInt(color.slice(3,5),16);raw[i+2]=parseInt(color.slice(5,7),16);raw[i+3]=255;}}
function crc(buffer){let c=0xffffffff;for(const b of buffer){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const body=Buffer.concat([Buffer.from(type),data]),a=Buffer.alloc(4),b=Buffer.alloc(4);a.writeUInt32BE(data.length);b.writeUInt32BE(crc(body));return Buffer.concat([a,body,b]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
const png=makePng(512),icoPng=makePng(256);
// Windows accepts a PNG-backed icon entry. Electron-builder uses the PNG for
// EXE resource generation; this entry is for NSIS installer branding.
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(icoPng.length,14);header.writeUInt32LE(22,18);
await fs.writeFile(path.join(dir,'craftmine-icon.svg'),svg+'\n');await fs.writeFile(path.join(dir,'craftmine-icon.png'),png);await fs.writeFile(path.join(dir,'craftmine-icon.ico'),Buffer.concat([header,icoPng]));
