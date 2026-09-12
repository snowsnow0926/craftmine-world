import test from 'node:test';import assert from 'node:assert/strict';
import {creationSessionPermission,immersiveCreationContext} from '../src/lib/creation-session-permission.ts';
test('both world entry forms default unset/inherited sessions to Auto without changing global settings',()=>{
 for(const sessionPermission of [undefined,'inherit'])assert.equal(creationSessionPermission({worldFlow:true,sessionPermission}),'auto');
 assert.equal(immersiveCreationContext('play',[{id:'plugin:craftmine.world/world'}]),true);
});
test('every explicit session permission is retained in a world conversation',()=>{
 for(const sessionPermission of ['ask','accept-edits','auto'])for(const globalPermission of [undefined,'ask','accept-edits','auto'])assert.equal(creationSessionPermission({worldFlow:true,sessionPermission,globalPermission}),sessionPermission);
});
test('explicit global choices retain inheritance rather than silently converting Ask to Auto',()=>{
 for(const globalPermission of ['ask','accept-edits','auto'])for(const sessionPermission of [undefined,'inherit'])assert.equal(creationSessionPermission({worldFlow:true,sessionPermission,globalPermission}),sessionPermission);
});
test('ordinary workbench and non-world panels keep their existing permission semantics',()=>{
 assert.equal(creationSessionPermission({worldFlow:false}),undefined);assert.equal(creationSessionPermission({worldFlow:false,sessionPermission:'inherit'}),'inherit');
 assert.equal(immersiveCreationContext('create',[{id:'plugin:craftmine.world/world'}]),false);assert.equal(immersiveCreationContext('play',[{id:'file:readme'}]),false);
});
