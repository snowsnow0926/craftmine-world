import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export function createCheckReplayDirectory(results){
 assert.equal(path.basename(path.resolve(results)),'test-results','REPLAY_TEST_RESULTS_DIRECTORY_REQUIRED');
 fs.mkdirSync(results,{recursive:true});
 return fs.mkdtempSync(path.join(results,'desktop-native-check-replay-'));
}
export function createCheckReplayProfile(out){
 const profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();
 fs.mkdirSync(profile);fs.mkdirSync(legacySource);
 fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}),{flag:'wx'});
 return {profile,legacySource,token};
}
