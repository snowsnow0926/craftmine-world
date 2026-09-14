// Read-only verification of actual operator receipts across one author edit.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
const names=['--before-snapshot','--after-snapshot','--before-capture','--after-capture','--reopen'];
assert(names.every(name=>args.includes(name)),'FIVE_RECEIPT_PATHS_REQUIRED');
const inputs={};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function read(name,command){
  const file=path.resolve(option(name)),bytes=fs.readFileSync(file),value=JSON.parse(bytes);
  assert.equal(value.status,'completed',`${name}: RECEIPT_NOT_COMPLETED`);
  assert.equal(value.command,command,`${name}: WRONG_COMMAND`);
  inputs[name.slice(2)]={file,sha256:hash(bytes),bytes:bytes.length,id:value.id};
  return value.result;
}
function preserved(before,after,location='state'){
  if(before&&typeof before==='object'&&!Array.isArray(before)){
    assert(after&&typeof after==='object'&&!Array.isArray(after),location);
    for(const key of Object.keys(before)){
      assert(Object.hasOwn(after,key),`${location}.${key}: missing`);
      preserved(before[key],after[key],`${location}.${key}`);
    }
  }else assert.deepEqual(after,before,location);
}
const before=read('--before-snapshot','snapshot'),after=read('--after-snapshot','snapshot');
const beforeCapture=read('--before-capture','capture'),afterCapture=read('--after-capture','capture');
const cold=read('--reopen','reopen');
assert.equal(before.worldId,after.worldId);
assert.equal(beforeCapture.identity.worldId,before.worldId);
assert.equal(afterCapture.identity.worldId,after.worldId);
assert.notEqual(beforeCapture.identity.buildId,afterCapture.identity.buildId,'AUTHOR_EDIT_MUST_PRODUCE_A_NEW_BUILD');
preserved(before.state.body,after.state.body);
assert.equal(cold.before.worldId,after.worldId);
assert.equal(cold.before.buildId,afterCapture.identity.buildId);
assert.equal(cold.after.buildId,cold.before.buildId);
assert.notEqual(cold.after.instanceId,cold.before.instanceId,'NEW_NATIVE_INSTANCE_REQUIRED');
preserved(after.state.body,cold.savedSnapshot.state.body);
assert.deepEqual(cold.snapshot.state.body,cold.savedSnapshot.state.body,'COLD_SAVED_BODY_MUST_MATCH');
for(const capture of [beforeCapture,afterCapture])assert.equal(hash(fs.readFileSync(capture.file)),capture.sha256,'CAPTURE_BYTES_CHANGED');
console.log(JSON.stringify({format:'craftmine.product-continuation-evidence/1',verified:true,inputs,
  worldId:before.worldId,beforeBuildId:beforeCapture.identity.buildId,afterBuildId:afterCapture.identity.buildId,
  allPriorProgressFieldsPreserved:true,coldSavedBodyExactlyEqual:true,
  priorComponentIds:Object.keys(before.state.body.components??{}),inventory:after.state.body.inventory,
  afterCapture:{file:afterCapture.file,sha256:afterCapture.sha256},
  limitations:['This verifies actual saved fields and version identities. It does not judge visual quality or prove every gameplay action.','Additional state fields are allowed; every existing field and value must remain unchanged.'],
},null,2));
