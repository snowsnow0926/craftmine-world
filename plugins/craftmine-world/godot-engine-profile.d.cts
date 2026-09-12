/// <reference types="node" />
type Pin=Readonly<{bytes:number;sha256:string}>;
type Pins=Readonly<Record<string,readonly Pin[]>>;
type FilePin={path:string;bytes:number;sha256:string};
export const PROFILE:'engine-monitor/1';
export const RESOURCES:Readonly<Record<string,string>>;
export function loadEnginePerformancePins(root:string):Pins|null;
export function hasEnginePerformanceSource(files:unknown,pins:Pins|null):boolean;
export function verifyEnginePerformancePack(buffer:Buffer,files:FilePin[],pins:Pins|null):{
  format:'craftmine.engine-monitor-pack-proof/1';profile:'engine-monitor/1';packSha256:string;packBytes:number;
  files:FilePin[];project:{sha256:string;selectors:Record<string,string>};boundary:string;
};
