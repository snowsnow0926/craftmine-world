import {createHash, randomUUID} from "node:crypto";
import {lstat, open} from "node:fs/promises";
import {isAbsolute, join, parse, resolve, sep} from "node:path";
import {writeSelectedFile} from "./craftmine-backup-service";

const ACTIONS=["describe","preview","export","importPreview","importCommit","list","read"];
export const PLAYTEST_CHANNELS=new Set(ACTIONS.map(action=>`playtest.${action}`));
function fail(code:string):never {throw Error(code);}
const stable=(value:any):any=>Array.isArray(value)?value.map(stable):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=(bytes:string|Buffer)=>createHash("sha256").update(bytes).digest("hex");
// Progress revisions identify the reviewed historical moment. Only a change
// to the selected formal content invalidates permission to export that moment.
const sameFormalContext=(a:any,b:any)=>["worldId","buildId","baseId","baseVersion","engineVersion","progressFormat"].every(key=>a[key]===b[key]);
const keys=(value:any,allowed:string[])=>{if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail("PLAYTEST_INVALID_PARAMS");};
async function readReport(filename:string) {
  if(!isAbsolute(filename))fail("PLAYTEST_INVALID_FILE");
  const absolute=resolve(filename),root=parse(absolute).root;let current=root;
  for(const part of absolute.slice(root.length).split(sep).filter(Boolean)){current=join(current,part);const stat=await lstat(current);if(stat.isSymbolicLink()||(current===absolute&&!stat.isFile()))fail("PLAYTEST_INVALID_FILE");}
  const file=await open(absolute,"r");try {const before=await file.stat();if(before.size>800_000)fail("PLAYTEST_TOO_LARGE");const bytes=await file.readFile();const after=await file.stat();if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)fail("PLAYTEST_FILE_CHANGED");return JSON.parse(bytes.toString("utf8"));}finally{await file.close();}
}
/** Native dialogs mint short-lived grants. Export commits exactly the reviewed bytes. */
export function createPlaytestFeedbackPanel(options:{
  domain:(method:string,args:Record<string,unknown>)=>Promise<any>;
  selection:()=>Promise<string|null>; blocked:()=>boolean;
  client:{version:string;commit?:string};
  capture:(worldId:string)=>Promise<{worldId:string;buildId:string;pngBase64:string;sha256:string}>;
  pick:(kind:"import"|"export",suggestedName?:string)=>Promise<string|null>;
}) {
  const grants=new Map<string,{worldId:string;report:any;origin:"local"|"imported";expires:number}>();let busy=false,disposed=false;
  const selected=async(worldId:any)=>{if(disposed||options.blocked())fail("PLAYTEST_BUSY");if(typeof worldId!=="string"||await options.selection()!==worldId)fail("PLAYTEST_WORLD_CHANGED");};
  const remember=(worldId:string,report:any,origin:"local"|"imported")=>{
    for(const [id,g] of grants)if(g.expires<Date.now())grants.delete(id);
    // Cancelled UI previews hold no durable state. Evict the oldest grant so
    // repeated review/cancel actions cannot strand a player behind the cap.
    if(grants.size>=8)grants.delete(grants.keys().next().value!);
    const previewId=randomUUID();grants.set(previewId,{worldId,report,origin,expires:Date.now()+15*60_000});
    return {status:"preview",previewId,report,origin,exclusions:["credentials","conversation","systemLogs","worldSource","savedProgress"],unverifiedPlayerStatement:origin==="imported"};
  };
  return {dispose(){disposed=true;grants.clear();},async request(channel:string,input:any){
    if(!PLAYTEST_CHANNELS.has(channel)||busy)fail("PLAYTEST_BUSY");keys(input,["worldId","description","expected","includeScreenshot","replyTo","previewId","id"]);
    if(Buffer.byteLength(JSON.stringify(input))>32_000)fail("PLAYTEST_INVALID_PARAMS");
    busy=true;try {
      await selected(input.worldId);const worldId=input.worldId;
      if(channel==="playtest.describe"||channel==="playtest.list"||channel==="playtest.read") {
        keys(input,channel==="playtest.read"?["worldId","id"]:["worldId"]);
        const value=await options.domain(channel==="playtest.describe"?"playtest.context":channel,input);await selected(worldId);return value;
      }
      if(channel==="playtest.preview") {
        keys(input,["worldId","description","expected","includeScreenshot","replyTo"]);
        if(typeof input.description!=="string"||typeof input.expected!=="string"||typeof input.includeScreenshot!=="boolean")fail("PLAYTEST_INVALID_PARAMS");
        if(input.replyTo!=null)await options.domain("playtest.read",{worldId,id:input.replyTo});
        const context=await options.domain("playtest.context",{worldId});
        const screenshot=input.includeScreenshot?await options.capture(worldId):null;
        await selected(worldId);
        if(!sameFormalContext(context,await options.domain("playtest.context",{worldId})))fail("PLAYTEST_WORLD_CHANGED");
        const body={format:"craftmine.playtest-feedback/1",createdAt:Date.now(),context,client:{version:options.client.version,commit:options.client.commit??null},description:input.description.trim(),expected:input.expected.trim(),replyTo:input.replyTo??null,screenshot};
        const report={...body,id:`feedback-${hash(JSON.stringify(stable(body)))}`};
        await options.domain("playtest.validate",{report});return remember(worldId,report,"local");
      }
      if(channel==="playtest.importPreview") {
        keys(input,["worldId"]);const file=await options.pick("import");if(!file)return {status:"cancelled"};
        const report=await options.domain("playtest.validate",{report:await readReport(file)});await selected(worldId);
        return remember(worldId,report,"imported");
      }
      keys(input,["worldId","previewId"]);
      const grant=grants.get(input.previewId);if(!grant||grant.worldId!==worldId||grant.expires<Date.now())fail("PLAYTEST_PREVIEW_EXPIRED");
      if(channel==="playtest.importCommit") {
        if(grant.origin!=="imported")fail("PLAYTEST_INVALID_PREVIEW");
        const result=await options.domain("playtest.record",{worldId,report:grant.report,origin:"imported"});await selected(worldId);return result;
      }
      if(grant.origin!=="local")fail("PLAYTEST_INVALID_PREVIEW");
      const file=await options.pick("export",`Craftmine-feedback-${grant.report.id.slice(9,21)}.json`);if(!file)return {status:"cancelled"};
      const verify=async()=>{await selected(worldId);if(!sameFormalContext(await options.domain("playtest.context",{worldId}),grant.report.context))fail("PLAYTEST_WORLD_CHANGED");return true;};
      await verify();const bytes=Buffer.from(JSON.stringify(grant.report,null,2)+"\n");await writeSelectedFile(file,bytes,verify);
      await options.domain("playtest.record",{worldId,report:grant.report,origin:"local"});
      return {status:"completed",id:grant.report.id,bytes:bytes.length,sha256:hash(bytes)};
    }finally{busy=false;}
  }};
}
