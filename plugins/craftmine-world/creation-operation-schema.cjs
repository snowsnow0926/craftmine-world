'use strict';
// Exported to the broker so model-visible fields stay aligned with compilation.
const CREATION_OPERATION_LIMIT=4096,CREATION_JOURNAL_BYTES=4*1024*1024;
const id={type:'string',pattern:'^[a-z][a-z0-9_-]{0,63}$'};
const vector=(minimum,maximum)=>({type:'array',minItems:3,maxItems:3,items:{type:'number',minimum,maximum}});
const position=vector(-28,28); // Compiler additionally bounds y to [0,16].
const fields={
  id,kind:{type:'string',enum:['tree','rock','chest','door','marker']},position,
  offset:vector(-8,8),color:{type:'string',pattern:'^#[a-fA-F0-9]{6}$'},scale:vector(.25,4),rotationY:{type:'number',minimum:-180,maximum:180},
  parameters:{type:'object',properties:{rewardId:id,rewardCount:{type:'integer',minimum:1,maximum:99},initiallyOpen:{type:'boolean'},label:{type:'string',maxLength:80}},additionalProperties:false},
  targetId:id,count:{type:'integer',minimum:1,maximum:8},timeOfDay:{type:'number',minimum:0,maximum:24},ruleId:id,doorId:id,sequence:{type:'array',items:id,minItems:2,maxItems:16,uniqueItems:true},
};
const expected={type:'object',properties:{worldId:{type:'string',minLength:1,maxLength:240},buildId:{type:'string',minLength:1,maxLength:240},instanceId:{type:'string',minLength:1,maxLength:240},revision:{type:'integer',minimum:0},manifestHash:{type:'string',pattern:'^[a-f0-9]{64}$'},targetSnapshotId:{type:'string',minLength:1,maxLength:240}},required:['worldId','buildId','instanceId','revision','manifestHash','targetSnapshotId'],additionalProperties:false};
const common={operationId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,120}$',description:'稳定重放编号；每个世界最多保留4096条操作，回执包含operationLimit与operationsRemaining。'},expected};
const branch=(action,names,required)=>({type:'object',properties:{...common,action:{type:'string',const:action},...Object.fromEntries(names.map(name=>[name,fields[name]]))},required:['operationId','expected','action',...required],additionalProperties:false});
fields.changes={type:'object',properties:Object.fromEntries(['position','rotationY','scale','color','parameters'].map(name=>[name,fields[name]])),minProperties:1,additionalProperties:false};
const CREATION_OPERATION_SCHEMA={oneOf:[
  branch('place',['kind','position','offset','id','color','scale','rotationY','parameters'],['kind']),
  branch('modify',['targetId','changes'],['targetId','changes']),
  branch('duplicate',['targetId','count','offset'],['targetId','count','offset']),
  branch('environment',['timeOfDay'],['timeOfDay']),
  branch('sequence-door',['ruleId','doorId','sequence'],['ruleId','doorId','sequence']),
]};
module.exports={CREATION_OPERATION_SCHEMA,CREATION_OPERATION_LIMIT,CREATION_JOURNAL_BYTES};
