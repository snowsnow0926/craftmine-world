// Binary protocol fixture, never executed as a Godot world.
import {createHash} from 'node:crypto';
const u32=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;};
const u64=value=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(value));return b;};
const variantString=value=>{const raw=Buffer.from(value);return Buffer.concat([u32(4),u32(raw.length),raw,Buffer.alloc((4-raw.length%4)%4)]);};
export function creationProjectBinary(){
 const selectors=[['autoload/CraftmineRuntime','*res://craftmine_shared/runtime_bridge.gd'],['craftmine/runtime/adapter','res://craftmine_shared/base_adapter.gd']];
 return Buffer.concat([Buffer.from('ECFG'),u32(selectors.length),...selectors.flatMap(([key,value])=>{const bytes=variantString(value);return [u32(Buffer.byteLength(key)),Buffer.from(key),u32(bytes.length),bytes];})]);
}
export function creationPackFixture(entries){
 const header=Buffer.alloc(112);for(const [offset,value]of [[0,0x43504447],[4,4],[8,4],[12,7],[16,2],[20,2]])header.writeUInt32LE(value,offset);
 header.writeBigUInt64LE(112n,24);let offset=0;const chunks=[],directory=[];
 for(const item of entries){const bytes=Buffer.from(item.data),name=Buffer.from(item.path),padded=Buffer.concat([name,Buffer.alloc((4-name.length%4)%4)]);chunks.push(bytes);directory.push(Buffer.concat([u32(padded.length),padded,u64(offset),u64(bytes.length),createHash('md5').update(bytes).digest(),u32(0)]));offset+=bytes.length;}
 header.writeBigUInt64LE(BigInt(112+offset),32);return Buffer.concat([header,...chunks,u32(entries.length),...directory]);
}
