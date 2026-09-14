import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseOperatorProviderConfig,resolveOperatorApiModel,operatorProviderInput,operatorRedactor,redactedOperatorLog,assertOperatorProvider,assertRetainedOperatorCopy} from './helpers/operator-provider-config.mjs';

const secret='sk-synthetic-test-key-1234';
const config=()=>parseOperatorProviderConfig(`https://api.deepseek.com/\n模型：deepseek-v4.1-flash\n${secret}\n`);
test('official API identifier mapping is explicit, uniquely scoped and preserves requested identity',()=>{
  const original=config(),unchanged=resolveOperatorApiModel(original);
  assert.equal(unchanged.model,'deepseek-v4.1-flash');assert.equal(unchanged.resolutionSource,null);
  const mapped=resolveOperatorApiModel(original,'deepseek-flash');assert.equal(mapped.model,'deepseek-flash');assert.equal(mapped.apiModelId,'deepseek-flash');assert.equal(mapped.requestedModel,'deepseek-v4.1-flash');assert.equal(mapped.resolutionSource,'https://deepseek.com/news/deepseek-v4-1-flash/');assert.equal(mapped.secret,secret);assert.equal(original.model,'deepseek-v4.1-flash');
  assert.equal(operatorProviderInput(mapped).models[0].id,'deepseek-flash');
  for(const [source,target] of [[original,'deepseek-v4-pro'],[{...original,model:'deepseek-other'},'deepseek-flash'],[{...original,baseUrl:'https://third-party.invalid/'},'deepseek-flash']])assert.throws(()=>resolveOperatorApiModel(source,target));
});
test('attachment keeps exact model and player limits without alias substitution',()=>{
  const value=config(),input=operatorProviderInput(value);
  assert.equal(input.secretValue,secret);assert.equal(input.defaultModelId,'deepseek-v4.1-flash');
  assert.equal(input.models[0].contextWindow,500000);assert.equal(input.models[0].maxTokens,384000);assert.equal(input.models[0].defaultThinkingLevel,'max');
  assert.deepEqual(input.models[0].thinkingLevels,['max']);assert.equal(input.models[0].supportsImages,true);assert.equal(input.models[0].supportsDocuments,true);
  assert.equal(input.apiStyle,'chat_completions');
});
test('unexpected endpoint and malformed attachment fail closed without echoing attachment',()=>{
  for(const text of [`https://other.invalid/\ndeepseek-v4.1-flash\n${secret}`,`https://api.deepseek.com/?key=${secret}\ndeepseek-v4.1-flash\n${secret}`,'invalid']){
    assert.throws(()=>parseOperatorProviderConfig(text),error=>!String(error.stack).includes(secret));
  }
});
test('redaction protects nested tool/error receipts and credential property names',()=>{
  const value=operatorRedactor(secret)({message:`CDP failed ${secret}`,secretValue:'anything',nested:[{authorization:'Basic abc',detail:'Bearer unrelated-value'}]});
  assert(!JSON.stringify(value).includes(secret));assert.equal(value.secretValue,'[REDACTED]');assert.equal(value.nested[0].authorization,'[REDACTED]');assert(!value.nested[0].detail.includes('unrelated-value'));
});
test('pipe chunks never emit a partial credential or split UTF-8',()=>{
  const chunks=[],sink=redactedOperatorLog(operatorRedactor(secret),value=>chunks.push(value));
  const bytes=Buffer.from('开始 '+secret+' 结束\n');for(const byte of bytes)sink.push(Buffer.from([byte]));sink.end();
  assert.equal(chunks.join(''),'开始 [REDACTED] 结束\n');
  const tail=redactedOperatorLog(operatorRedactor(secret),value=>chunks.push(value));tail.push(Buffer.from(secret));tail.end();assert.equal(chunks.at(-1),'[REDACTED]');
});
const state=()=>{const c=config();return {config:c,providerId:'isolated-provider',provider:{id:'isolated-provider',...operatorProviderInput(c)},settings:{worldAgentBackend:'pi',defaultProviderId:'isolated-provider',defaultModelId:c.model,defaultPermissionMode:'auto'},session:{providerId:null,modelId:null,thinkingLevel:'max',permissionMode:'auto'}};};
test('effective inherited player selection is checked after restart and before every prompt',()=>{
  const checked=assertOperatorProvider(state());assert.equal(checked.model,'deepseek-v4.1-flash');assert.equal(checked.permissionMode,'auto');assert(!JSON.stringify(checked).includes(secret));
  for(const mutate of [s=>s.settings.worldAgentBackend='codex-cli',s=>s.provider.models[0].maxTokens=64000,s=>s.session.modelId='deepseek-flash',s=>s.session.thinkingLevel='high',s=>s.session.permissionMode='readonly',s=>s.provider.models[0].thinkingLevels=['high','max'],s=>s.provider.models[0].supportsImages=false,s=>s.provider.models[0].supportsDocuments=false]){const s=state();mutate(s);assert.throws(()=>assertOperatorProvider(s));}
});
test('inherit follows the actual default without losing raw permission evidence',()=>{
  const s=state();s.session.permissionMode='inherit';
  const checked=assertOperatorProvider(s);assert.equal(checked.sessionPermissionMode,'inherit');assert.equal(checked.defaultPermissionMode,'auto');assert.equal(checked.effectivePermissionMode,'auto');assert.equal(checked.permissionMode,'auto');
  s.settings.defaultPermissionMode='readonly';assert.throws(()=>assertOperatorProvider(s),/SESSION_PERMISSION_CHANGED/);
  s.session.permissionMode='auto';assert.equal(assertOperatorProvider(s).effectivePermissionMode,'auto');
  s.session.permissionMode='readonly';s.settings.defaultPermissionMode='auto';assert.throws(()=>assertOperatorProvider(s),/SESSION_PERMISSION_CHANGED/);
});
test('retained bootstrap requires matching isolated profile marker and existing provenance',()=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'operator-retained-test-')),profile=path.join(out,'profile'),legacy=path.join(out,'legacy'),manifest=path.join(out,'copy.json');fs.mkdirSync(profile);fs.mkdirSync(legacy);fs.writeFileSync(manifest,'{}');
  const marker={token:'test-token',legacySource:legacy},previous={sourceTemplate:'retained',sessionId:'original-session',turns:[],commands:[],retainedCopy:{format:'craftmine.operator-retained-copy/1',markerToken:marker.token,manifest}};
  try{assertRetainedOperatorCopy({previous,out,profile,marker});assert.throws(()=>assertRetainedOperatorCopy({previous,out,profile,marker:{...marker,token:'other'}}));assert.throws(()=>assertRetainedOperatorCopy({previous,out,profile,marker:{...marker,legacySource:os.tmpdir()}}));}finally{fs.rmSync(out,{recursive:true,force:true});}
});
