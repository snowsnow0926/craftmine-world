import {validCreationRequirement,creationRequirementsHash,creationEntitiesMatch,type CreationRequirement,type CreationEntity} from "./creation-check-requirements.ts";
import {createHash} from "node:crypto";

export type GodotCheckRequirements = {
  format: "craftmine.godot-check-requirements/1";
  targetFeedback?: {targetId: string; hitFlashMilliseconds: number};
  creation?: CreationRequirement;
};
export type GodotRequirementsObservation = {
  phase: "loaded" | "running";
  targetId?: string;
  hitFlashMilliseconds?: number;
  entities?:CreationEntity[];
  timeOfDay?:number;
  doorTrace?:import("./creation-door-verifier").CreationDoorTrace;
  harvestTrace?:import("./creation-harvest-verifier").CreationHarvestTrace;
};
export type GodotRequirementsEvidence = {
  format: "craftmine.godot-check-requirements-evidence/1";
  requirementsHash: string;
  jobId: string;
  worldId: string;
  buildId: string;
  instanceId: string;
  observations: GodotRequirementsObservation[];
};
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.match(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)?.[0] === value;
const exactKeys = (value: RecordValue, keys: string[]): boolean => Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const invalid = (): never => {throw Error("INVALID_GODOT_CHECK_REQUIREMENTS");};

/** Fixed finite contract from the core descriptor, never renderer authority. */
export function parseGodotCheckRequirements(value: unknown, digest: unknown, baseId: string):
  {checkRequirements: GodotCheckRequirements; checkRequirementsHash: string} | undefined {
  if(value === undefined && digest === undefined) return undefined;
  if(baseId === "creation-sandbox"){
    if(!record(value)||!exactKeys(value,["format","creation"])||value.format!=="craftmine.godot-check-requirements/1"||!validCreationRequirement(value.creation)||digest!==creationRequirementsHash(value.creation))return invalid();
    return {checkRequirements:{format:"craftmine.godot-check-requirements/1",creation:value.creation},checkRequirementsHash:digest as string};
  }
  if(baseId !== "first-person" || !record(value) || !exactKeys(value,["format","targetFeedback"]) || value.format !== "craftmine.godot-check-requirements/1") return invalid();
  const target=value.targetFeedback;
  if(!record(target) || !exactKeys(target,["targetId","hitFlashMilliseconds"]) || !validId(target.targetId) || !Number.isInteger(target.hitFlashMilliseconds) || (target.hitFlashMilliseconds as number)<1 || (target.hitFlashMilliseconds as number)>1000) return invalid();
  const requirements: GodotCheckRequirements={format:"craftmine.godot-check-requirements/1",targetFeedback:{targetId:target.targetId,hitFlashMilliseconds:target.hitFlashMilliseconds as number}};
  const hash=createHash("sha256").update(`${requirements.format}\n${target.targetId}\n${target.hitFlashMilliseconds}\n`,"utf8").digest("hex");
  if(typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest) || digest !== hash) return invalid();
  return {checkRequirements:requirements,checkRequirementsHash:hash};
}

/** Read one finite value from a freshly requested, scoped runtime envelope.
 * No source read, expected-value substitution, rounding or write is performed. */
export function readGodotTargetFeedback(raw: unknown, scope: {worldId:string;buildId:string;instanceId:string}, targetId: string, phase: "loaded"|"running"): GodotRequirementsObservation {
  const fail=(): never=>{throw Error("GODOT_CHECK_TARGET_FEEDBACK_OBSERVATION_INVALID");};
  if(!record(raw) || raw.format!=="craftmine.godot-observation/1" || raw.worldId!==scope.worldId || raw.buildId!==scope.buildId || raw.instanceId!==scope.instanceId || raw.baseId!=="first-person" || raw.baseVersion!=="0.1.0" || typeof raw.sampledAt!=="string" || !Number.isFinite(Date.parse(raw.sampledAt)) || !record(raw.payload)) return fail();
  const feedback=raw.payload.targetFeedback;
  if(!record(feedback) || !exactKeys(feedback,["format","targets"]) || feedback.format!=="craftmine.target-feedback-observation/1" || !Array.isArray(feedback.targets) || feedback.targets.length>256) return fail();
  const ids=new Set<string>();let actual: number|undefined;
  for(const entry of feedback.targets){
    if(!record(entry) || !exactKeys(entry,["targetId","hitFlashMilliseconds"]) || !validId(entry.targetId) || ids.has(entry.targetId) || !finite(entry.hitFlashMilliseconds)) return fail();
    ids.add(entry.targetId);
    if(entry.targetId===targetId)actual=entry.hitFlashMilliseconds;
  }
  if(actual===undefined)return fail();
  return {phase,targetId,hitFlashMilliseconds:actual};
}

export function godotTargetFeedbackMatches(observation: GodotRequirementsObservation, requirements: GodotCheckRequirements): boolean {
  return !!requirements.targetFeedback && observation.targetId===requirements.targetFeedback.targetId && typeof observation.hitFlashMilliseconds==="number" && Number.isFinite(observation.hitFlashMilliseconds) && Math.abs(observation.hitFlashMilliseconds-requirements.targetFeedback.hitFlashMilliseconds)<=1e-6;
}

export function readGodotCreationObservation(raw:unknown,scope:{worldId:string;buildId:string;instanceId:string},phase:"loaded"|"running"):GodotRequirementsObservation {
 if(!record(raw)||raw.format!=="craftmine.godot-observation/1"||raw.baseId!=="creation-sandbox"||raw.baseVersion!=="1.0.0"||raw.worldId!==scope.worldId||raw.buildId!==scope.buildId||raw.instanceId!==scope.instanceId||typeof raw.sampledAt!=="string"||!Number.isFinite(Date.parse(raw.sampledAt))||!record(raw.payload)||!record(raw.payload.creation)||!Array.isArray(raw.payload.creation.entities))throw Error("GODOT_CHECK_CREATION_OBSERVATION_INVALID");
 const creation=raw.payload.creation;
 return {phase,timeOfDay:creation.timeOfDay as number,entities:structuredClone(creation.entities as any[]).map((e:any)=>{const b=Array.isArray(creation.obstacles)?creation.obstacles.find((b:any)=>b.entityId===e.id):null;return b?{...e,bounds:{min:b.min,max:b.max}}:e;}) as CreationEntity[]};
}
export function godotCreationMatches(observation:GodotRequirementsObservation,requirements:GodotCheckRequirements):boolean{return !!requirements.creation&&!!observation.entities&&creationEntitiesMatch(requirements.creation,observation.entities)&&(requirements.creation.timeOfDay===undefined||observation.timeOfDay===requirements.creation.timeOfDay);}
