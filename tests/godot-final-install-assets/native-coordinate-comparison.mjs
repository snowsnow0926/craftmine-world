// Cross-engine JSON decimals may differ while representing identical Vector
// float32 values. Only these native coordinate fields use bit-exact comparison.
export function nativeCoordinates(snapshot){
 const value=structuredClone(snapshot),changes=[];
 const coordinate=(object,key,path)=>{if(typeof object?.[key]!=='number'||!Number.isFinite(object[key]))throw Error('INVALID_NATIVE_COORDINATE');const original=object[key],native=Math.fround(original),bytes=Buffer.alloc(4);bytes.writeFloatLE(native);if(original!==native)changes.push({path,jsonValue:original,float32Value:native,float32Bits:bytes.readUInt32LE(0).toString(16).padStart(8,'0')});object[key]=native;};
 const vector=(array,path)=>{if(!Array.isArray(array)||![2,3].includes(array.length))throw Error('INVALID_NATIVE_VECTOR');for(let i=0;i<array.length;i++)coordinate(array,i,path+'/'+i);};
 if(value.baseId==='first-person')vector(value.body.player.position,'/body/player/position');
 else if(value.baseId==='top-down'){vector(value.body.player.position,'/body/player/position');for(const [scene,array]of Object.entries(value.body.scenePositions??{}))vector(array,'/body/scenePositions/'+scene);}
 else if(value.baseId==='side-view'){coordinate(value.body.player,'x','/body/player/x');coordinate(value.body.player,'y','/body/player/y');}
 else if(value.baseId==='mining-sandbox')vector(value.body.state.player.position,'/body/state/player/position');
 return {value,changes};
}
