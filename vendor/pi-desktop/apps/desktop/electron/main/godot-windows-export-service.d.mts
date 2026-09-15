export function createGodotWindowsExportService(options: {
 domainCall:(method:string,args:Record<string,unknown>)=>Promise<any>;
 selection:()=>Promise<string|null>|string|null;
 checkpoint:(worldId:string)=>Promise<unknown>;
 pickDirectory:(input:{worldId:string})=>Promise<string|null>;
 stagingRoot:string; resourcesRoot:string;
 toolchain:{broker:string;brokerIdentity:string;engineRoot:string};
}): {request(channel:string,input:{worldId:string;operationId:string}):Promise<any>;dispose():Promise<void>};
export function writeWindowsExportNotices(resourcesRoot: string, outputStage: string): Promise<void>;
