import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

// The authorized attachment is read only by the operator process, never placed
// in argv/environment/report or copied into the evidence directory.
export function parseOperatorProviderConfig(text) {
  const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  assert.equal(lines.length,3,'PROVIDER_ATTACHMENT_REQUIRES_THREE_LINES');
  const endpoint=lines[0].match(/https:\/\/[^\s]+/)?.[0];
  const model=lines[1].match(/deepseek-[a-z0-9.-]+/i)?.[0];
  const secret=lines[2].match(/\bsk-[A-Za-z0-9_-]+\b/)?.[0];
  assert(endpoint&&model&&secret,'PROVIDER_ATTACHMENT_FIELDS_INVALID');
  let url;try{url=new URL(endpoint);}catch{throw Error('PROVIDER_ENDPOINT_INVALID');}
  assert(url.origin==='https://api.deepseek.com','AUTHORIZED_PROVIDER_ENDPOINT_REQUIRED');
  assert(!url.username&&!url.password&&!url.search&&!url.hash,'PROVIDER_ENDPOINT_MUST_NOT_CONTAIN_CREDENTIALS');
  return {baseUrl:url.href,model,secret,contextWindow:500000,maxTokens:384000,thinkingLevel:'max'};
}

export function operatorProviderInput(config) {
  return {name:'Isolated player DeepSeek attachment',vendorKey:'deepseek',protocol:'openai_compatible',type:'openai_compatible',baseUrl:config.baseUrl,authKind:'api_key_and_base_url',secretValue:config.secret,apiStyle:'chat_completions',defaultModelId:config.model,models:[{id:config.model,contextWindow:config.contextWindow,maxTokens:config.maxTokens,thinkingLevels:['off','minimal','low','medium','high','max'],defaultThinkingLevel:config.thinkingLevel,supportsImages:false,supportsDocuments:false}]};
}

export function operatorRedactor(secret) {
  const string=value=>{
    let result=String(value);
    if(secret)result=result.split(secret).join('[REDACTED]');
    return result.replace(/\bsk-[A-Za-z0-9_-]+/g,'[REDACTED]').replace(/(Bearer\s+)\S+/gi,'$1[REDACTED]');
  };
  const redact=value=>typeof value==='string'?string(value):Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[string(key),/^(secretValue|apiKey|authorization)$/i.test(key)?'[REDACTED]':redact(item)])):value;
  return redact;
}

// Keep incomplete lines in memory so a credential spanning OS pipe chunks is
// never emitted in pieces. StringDecoder also preserves split UTF-8 sequences.
export function redactedOperatorLog(redact,write) {
  const decoder=new StringDecoder('utf8');let pending='';
  const flush=()=>{const end=pending.lastIndexOf('\n');if(end<0)return;write(redact(pending.slice(0,end+1)));pending=pending.slice(end+1);};
  return {push(bytes){pending+=decoder.write(bytes);flush();},end(){pending+=decoder.end();if(pending)write(redact(pending));pending='';}};
}

export function assertOperatorProvider({config,providerId,provider,settings,session}) {
  assert.equal(settings.worldAgentBackend,'pi','PLAYER_BACKEND_CHANGED');
  assert.equal(settings.defaultProviderId,providerId,'PLAYER_PROVIDER_CHANGED');
  assert.equal(settings.defaultModelId,config.model,'PLAYER_MODEL_CHANGED');
  assert.equal(provider?.id,providerId,'PLAYER_PROVIDER_MISSING');
  assert.equal(provider.baseUrl,config.baseUrl,'PLAYER_ENDPOINT_CHANGED');
  const binding=provider.models?.find(row=>row.id===config.model);
  assert.equal(binding?.contextWindow,config.contextWindow,'PLAYER_CONTEXT_CHANGED');
  assert.equal(binding?.maxTokens,config.maxTokens,'PLAYER_OUTPUT_CHANGED');
  assert.equal(binding?.defaultThinkingLevel,config.thinkingLevel,'PLAYER_THINKING_CHANGED');
  if(session){assert.notEqual(session.worldAgentBackend,'codex-cli');assert.equal(session.providerId??settings.defaultProviderId,providerId,'SESSION_PROVIDER_CHANGED');assert.equal(session.modelId??settings.defaultModelId,config.model,'SESSION_MODEL_CHANGED');assert.equal(session.thinkingLevel,config.thinkingLevel,'SESSION_THINKING_CHANGED');assert.equal(session.permissionMode,'auto','SESSION_PERMISSION_CHANGED');}
  return {backend:'pi',providerId,baseUrl:config.baseUrl,model:config.model,contextWindow:binding.contextWindow,maxTokens:binding.maxTokens,thinkingLevel:binding.defaultThinkingLevel,permissionMode:session?.permissionMode??settings.defaultPermissionMode};
}

export function assertRetainedOperatorCopy({previous,out,profile,marker}) {
  if(previous?.sourceTemplate!=='retained')return;
  assert.equal(previous.retainedCopy?.format,'craftmine.operator-retained-copy/1','RETAINED_COPY_PROVENANCE_REQUIRED');
  assert.equal(previous.retainedCopy.markerToken,marker.token,'RETAINED_COPY_MARKER_MISMATCH');
  assert(typeof previous.sessionId==='string'&&previous.sessionId.length>0,'RETAINED_SESSION_REQUIRED');
  assert(Array.isArray(previous.turns)&&Array.isArray(previous.commands),'RETAINED_MAILBOX_HISTORY_REQUIRED');
  assert.equal(path.resolve(marker.legacySource),path.join(path.resolve(out),'legacy'),'RETAINED_LEGACY_MUST_BE_ISOLATED');
  for(const directory of [out,profile,marker.legacySource])assert.equal(fs.realpathSync(directory).toLowerCase(),path.resolve(directory).toLowerCase(),'RETAINED_LINK_DENIED');
  // Reject linked profile members, including junctions into a live user profile.
  const walk=directory=>{for(const entry of fs.readdirSync(directory)){const file=path.join(directory,entry),stat=fs.lstatSync(file);assert(!stat.isSymbolicLink(),'RETAINED_LINK_DENIED');if(stat.isDirectory())walk(file);}};
  walk(profile);walk(marker.legacySource);
  assert(path.isAbsolute(previous.retainedCopy.manifest)&&fs.statSync(previous.retainedCopy.manifest).isFile(),'RETAINED_COPY_MANIFEST_REQUIRED');
}
