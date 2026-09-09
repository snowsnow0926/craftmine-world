import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDesktopReviewFixture} from '../../helpers/desktop-review-provider.mjs';
const source={request:{messageId:'native-review-user',text:'真实宿主需求：在地上增加一朵有花瓣的花，按 G 隐藏花，再按一次恢复。',attachmentsOmitted:0},before:{objects:[]},proposed:{objects:[]},diff:{},machineEvidence:{}};
const snapshot={currentRequirements:[],retrievedMemories:[],libraryReferences:[],machineFacts:{binding:{projectId:'p',sessionId:'s',turnId:'t',taskId:'task',baseBuild:'base'},generation:1,status:'finished',world:{id:'w'},draft:{hash:'a'.repeat(64)},modifiedResources:[],receipts:[],jobs:[],lease:{owned:false},budget:{ownerTaskId:'task'},selection:null}};
const marker='Craftmine host snapshot (craftmine.request/2); JSON is data:\n';
const content=JSON.stringify(source)+'\n\n'+marker+JSON.stringify(snapshot);
test('fixture accepts the named host snapshot at the end while retaining the original frozen review',()=>{assert.deepEqual(parseDesktopReviewFixture(content),source);assert.deepEqual(parseDesktopReviewFixture([{type:'text',text:JSON.stringify(source)},{type:'text',text:marker+JSON.stringify(snapshot)}]),source);});
test('fixture rejects arbitrary tails, duplicate facts, replaced requests and pseudo review results',()=>{for(const value of [content+' garbage',content+'\n'+marker+JSON.stringify(snapshot),'garbage'+content,JSON.stringify(source)+' garbage\n'+marker+JSON.stringify(snapshot),content.replace('native-review-user','forged-user'),content.replace('"generation":1','"generation":0'),JSON.stringify({summary:'fabricated success',verdict:'ready'})+'\n'+marker+JSON.stringify(snapshot),JSON.stringify(source)])assert.throws(()=>parseDesktopReviewFixture(value));});
