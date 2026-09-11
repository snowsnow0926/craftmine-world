'use strict';
// Exported to the broker so model-visible fields stay aligned with compilation.
const CREATION_OPERATION_LIMIT=4096,CREATION_JOURNAL_BYTES=4*1024*1024;
const id={type:'string',pattern:'^[a-z][a-z0-9_-]{0,63}$'};
const vector=(minimum,maximum)=>({type:'array',minItems:3,maxItems:3,items:{type:'number',minimum,maximum}});
const position=vector(-28,28); // Compiler additionally bounds y to [0,16].
const CREATION_OPERATION_DESCRIPTION='Edit the base-generator entities declared in world/creation.json using the immutable host-captured target. place kind=tree/rock/chest/door/marker selects a base generator, not an installed asset ID, GLB, or reusable scene; it does not reuse a same-named object visible in the world. duplicate copies only an existing creation.json entity and its generator parameters, not arbitrary addon nodes. For another object with the same installed appearance, inspect the actual installed scene reference and create a separate instance with a new independent entity_id through ordinary source patching, or use godot_source_library with its exact archiveRef. Matching kind or display name is not proof of matching appearance. Check the result before claiming visual equivalence. request.expected uses the current source revision/hash from godot_project_index and world/build/instance/snapshot identity from the immutable host creation context. Coordinates alone are not target authority. Recapture when source or runtime changes outside this turn. Returns a durable draft receipt, not adoption: run godot_build_start mode check and inspect the actual result. Undo preserves played progress and rejects intervening changes; deletion of referenced objects is refused.';
const fields={
  id,kind:{type:'string',enum:['tree','rock','chest','door','marker'],description:'Base-generator category in world/creation.json; not an AssetRef, GLB name or installed scene ID. The stock tree generator creates default geometry and does not reuse a visible same-named prefab.'},position,
  offset:vector(-8,8),color:{type:'string',pattern:'^#[a-fA-F0-9]{6}$'},scale:vector(.25,4),rotationY:{type:'number',minimum:-180,maximum:180},
  parameters:{type:'object',properties:{rewardId:id,rewardCount:{type:'integer',minimum:1,maximum:99},initiallyOpen:{type:'boolean'},label:{type:'string',maxLength:80}},additionalProperties:false},
  undoOperationId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,120}$'},targetId:{...id,description:'Existing entity ID declared in world/creation.json. An addon node, generic scene target or asset ID is not interchangeable with this ID.'},count:{type:'integer',minimum:1,maximum:8},timeOfDay:{type:'number',minimum:0,maximum:24},ruleId:id,doorId:id,sequence:{type:'array',items:id,minItems:2,maxItems:16,uniqueItems:true},
};
const expected={type:'object',properties:{worldId:{type:'string',minLength:1,maxLength:240},buildId:{type:'string',minLength:1,maxLength:240},instanceId:{type:'string',minLength:1,maxLength:240},revision:{type:'integer',minimum:0},manifestHash:{type:'string',pattern:'^[a-f0-9]{64}$'},targetSnapshotId:{type:'string',minLength:1,maxLength:240}},required:['worldId','buildId','instanceId','revision','manifestHash','targetSnapshotId'],additionalProperties:false};
const common={operationId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,120}$',description:'稳定重放编号；每个世界最多保留4096条操作，回执包含operationLimit与operationsRemaining。'},expected};
const actionDescriptions={place:'Create a new base-generator entity. This does not instance an installed model or reuse the appearance of a similarly named scene object.',duplicate:'Duplicate one creation.json entity with its generator parameters. For an installed prefab, instance its actual scene through source patching or the source-library flow instead.'};
const branch=(action,names,required)=>({type:'object',properties:{...common,action:{type:'string',const:action,...(actionDescriptions[action]?{description:actionDescriptions[action]}:{})},...Object.fromEntries(names.map(name=>[name,fields[name]]))},required:['operationId','expected','action',...required],additionalProperties:false});
fields.changes={type:'object',properties:Object.fromEntries(['position','rotationY','scale','color','parameters'].map(name=>[name,fields[name]])),minProperties:1,additionalProperties:false};
const CREATION_OPERATION_SCHEMA={oneOf:[
  branch('place',['kind','position','offset','id','color','scale','rotationY','parameters'],['kind']),
  branch('modify',['targetId','changes'],['targetId','changes']),
  branch('duplicate',['targetId','count','offset'],['targetId','count','offset']),
  branch('delete',['targetId'],['targetId']),
  branch('undo',['undoOperationId'],['undoOperationId']),
  branch('environment',['timeOfDay'],['timeOfDay']),
  branch('sequence-door',['ruleId','doorId','sequence'],['ruleId','doorId','sequence']),
]};
module.exports={CREATION_OPERATION_SCHEMA,CREATION_OPERATION_DESCRIPTION,CREATION_OPERATION_LIMIT,CREATION_JOURNAL_BYTES};
