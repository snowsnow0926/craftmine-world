'use strict';
const {companionPositionConfiguration}=require('./companion-position-bounds.cjs');
const companions=new Set(['cw.module.approved-pomeranian','cw.module.pet-companion']);
const fail=code=>{throw Object.assign(Error(code),{code});};
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
function validatePositionBounds(value){
  if(!record(value)||Object.keys(value).sort().join(',')!=='expectedSource,maximum,minimum'
    ||!['minimum','maximum'].every(key=>Array.isArray(value[key])&&value[key].length===3&&value[key].every(n=>Number.isFinite(n)&&Math.abs(n)<=100000))
    ||value.minimum.some((n,i)=>n>=value.maximum[i]))fail('PACKAGE_POSITION_BOUNDS_INVALID');
  const source=value.expectedSource;
  if(!record(source)||Object.keys(source).sort().join(',')!=='manifestHash,revision'||!Number.isSafeInteger(source.revision)||source.revision<0||!/^[a-f0-9]{64}$/.test(source.manifestHash))fail('PACKAGE_CONFIGURATION_SOURCE_REQUIRED');
  return {minimum:[...value.minimum],maximum:[...value.maximum],expectedSource:{...source}};
}
function configurationHint(content,files,source){
  const declaration=content.entry?.positionValidation;
  if(!declaration){
    if(!companions.has(content.assetId)||!Number.isInteger(content.version)||content.version>2)return null;
    const profile=companionPositionConfiguration(files,source),properties=profile.properties;
    const exceeds=properties&&[...properties.saved_position_min,...properties.saved_position_max].some(n=>n< -80||n>80);
    return {kind:'legacy-companion-range',status:exceeds?'legacy-range-insufficient':properties?'legacy-range-covers-stock':'legacy-range-unverified',fixedBounds:{minimum:[-80,-80,-80],maximum:[80,80,80]},
      instruction:'This published companion has fixed ±80 save bounds. Matching source prerequisites does not make it suitable for a larger world. Search/read a configurable v3 or newer companion, or review a source-local upgrade; never rewrite old archives or clamp positions.'};
  }
  if(declaration.mode!=='explicit-receiving-world-bounds'||declaration.requiresWorldConfiguration!==true
    ||declaration.sourceProperties?.minimum!=='saved_position_min'||declaration.sourceProperties?.maximum!=='saved_position_max')
    return {kind:'source-configuration',status:'unsupported-configuration',instruction:'Unsupported source-configuration contract.'};
  const profile=companionPositionConfiguration(files,source);
  return {kind:'companion-position-bounds',status:profile.properties?'configuration-planned':'configuration-required',
    ...(profile.properties&&source?{positionBounds:{minimum:profile.properties.saved_position_min,maximum:profile.properties.saved_position_max,
      expectedSource:{revision:source.revision,manifestHash:source.manifestHash}},evidence:profile.evidence,profile:profile.profile}:{}),
    sourceProperties:declaration.sourceProperties,appliedToInstances:false,
    instruction:profile.properties?'The installer revalidates this exact world source and writes both exported bounds on each new instance before checks.':
      'Read receiving-world source, then supply positionBounds={minimum:[x,y,z],maximum:[x,y,z],expectedSource:{revision,manifestHash}} in install/propose or its group item. Unknown worlds require explicit bounds; ±80 defaults are not used silently.'};
}
function resolveSourceConfiguration(archive,files,source,explicit){
  if(explicit!==undefined)explicit=validatePositionBounds(explicit);
  const rows=archive.resources.map(resource=>({resource,configuration:configurationHint(resource.manifest.content,files,source)}));
  const configurable=rows.filter(row=>row.configuration?.kind==='companion-position-bounds');
  if(explicit!==undefined&&configurable.length!==1)fail('PACKAGE_POSITION_BOUNDS_COMPONENT_REQUIRED');
  if(explicit&&(explicit.expectedSource.revision!==source.revision||explicit.expectedSource.manifestHash!==source.manifestHash))fail('PACKAGE_CONFIGURATION_SOURCE_CHANGED');
  const resolved=[];
  for(const row of rows){
    const hint=row.configuration;if(!hint)continue;
    const content=row.resource.manifest.content;
    // Historical versions do not declare required receiving-world configuration.
    // Warn without changing their supported installation or limited-area usage.
    if(hint.kind==='legacy-companion-range'){resolved.push({resourceId:content.assetId,warning:hint});continue;}
    if(hint.status==='unsupported-configuration')fail('PACKAGE_SOURCE_CONFIGURATION_UNSUPPORTED');
    const bounds=explicit??hint.positionBounds;if(!bounds)fail('PACKAGE_POSITION_BOUNDS_REQUIRED');
    resolved.push({resourceId:content.assetId,origin:explicit?'explicit-source-bound':'exact-stock-source',expectedSource:{revision:source.revision,manifestHash:source.manifestHash},
      properties:{saved_position_min:[...bounds.minimum],saved_position_max:[...bounds.maximum]}});
  }
  return resolved;
}
module.exports={validatePositionBounds,configurationHint,resolveSourceConfiguration};
