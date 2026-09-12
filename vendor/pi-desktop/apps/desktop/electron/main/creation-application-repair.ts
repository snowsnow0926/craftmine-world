// These diagnostics are emitted by the fixed progress validator/migration.
// A source repair is allowed only after the coordinator confirms rollback and
// the formal source identity is unchanged. CAS, I/O and receipt errors are not
// source failures and must never enter the model's repair loop.
const codes=new Set(['GODOT_ADDITIVE_REMOVAL_REJECTED','GODOT_ADDITIVE_ENTITY_SHAPE_CHANGED','GODOT_ADDITIVE_COMPONENT_SCHEMA_CHANGED']);
const messages=['Saved player overlaps candidate entity: ','Authored rule rejected progress: '];
export function creationApplicationRepairReason(error:unknown,rolledBack:boolean,formalUnchanged:boolean):string|null {
  if(!rolledBack||!formalUnchanged)return null;
  const text=error instanceof Error?error.message:String(error);
  if(/recovery pending|UNCONFIRMED|UNCERTAIN|CONFLICT|IDENTITY|PERMISSION|EACCES|ENOSPC|EPERM/i.test(text))return null;
  const normalized=text.replace(/^Error:\s*/, '');
  if(codes.has(normalized)||messages.some(prefix=>normalized.startsWith(prefix)&&normalized.length>prefix.length))return normalized;
  return null;
}
export const CREATION_APPLICATION_REPAIR_PREFIX='CREATION_APPLICATION_REPAIR: ';
