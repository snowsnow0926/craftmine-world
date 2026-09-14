import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {readHeadlessProfile}=await import('../electron/main/craftmine-headless-profile.ts');
const {createCheckReplayDirectory,createCheckReplayProfile}=await import('../../../../../tests/helpers/check-replay-profile.mjs');
test('actual replay profile factory satisfies the unchanged production profile guard',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'cm-replay-contract-')),out=createCheckReplayDirectory(path.join(temporary,'test-results'));
 assert(path.basename(out).startsWith('desktop-native-check-replay-'));
 const {profile,legacySource,token}=createCheckReplayProfile(out);
 const env={CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
 assert.deepEqual(readHeadlessProfile(env),{root:fs.realpathSync(out),profile:fs.realpathSync(profile),legacySource:fs.realpathSync(legacySource)});
 assert.throws(()=>readHeadlessProfile({...env,CRAFTMINE_HEADLESS_TOKEN:'incorrect'}),/marker/);
});
test('replay factory refuses alternate output parents; old incompatible prefix stays rejected',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'cm-replay-contract-'));
 assert.throws(()=>createCheckReplayDirectory(path.join(temporary,'other-results')),/REPLAY_TEST_RESULTS_DIRECTORY_REQUIRED/);
 const results=path.join(temporary,'test-results');fs.mkdirSync(results);const out=fs.mkdtempSync(path.join(results,'godot-check-replay-'));
 const {profile,token}=createCheckReplayProfile(out);
 assert.throws(()=>readHeadlessProfile({CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token}),/dedicated/);
});
