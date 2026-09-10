export function canonicalProgressJson(value:unknown,depth?:number):string;
export function hashProgress(value:unknown):string;
export function deriveAdditiveProgress(previousSnapshot:unknown,defaultsSnapshot:unknown):{
 format:'craftmine.godot-additive-progress/1';previousSnapshotHash:string;defaultsSnapshotHash:string;snapshotHash:string;
 added:Array<{path:string;id:string}>;snapshot:Record<string,any>;
};
