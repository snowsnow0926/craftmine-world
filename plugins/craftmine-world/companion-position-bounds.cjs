'use strict';
const {profiles}=require('./companion-position-profiles.json');
const {rootBindingMatches,pinnedScripts}=require('./companion-root-binding.mjs');

function companionPositionConfiguration(files){
  // A stock sandbox script can coexist with an authored overriding city script.
  // Prefer the exact authored cohort; unknown overrides require source review.
  const city=profiles.find(profile=>profile.id==='orgrimmar-city');
  const applicable=files.has(city.path)?[city]:profiles.filter(profile=>profile.id==='stock-sandbox');
  const known=applicable.find(profile=>files.get(profile.path)?.sha256===profile.sha256&&pinnedScripts(profile,files)&&profile.selectors.every(item=>files.get(item.path)?.sha256===item.sha256||item.path===profile.rootBinding?.scene&&rootBindingMatches(profile,files)));
  return {status:known?'source-configuration-required':'world-source-review-required',
    ...(known?{profile:known.id,evidence:{path:known.path,sha256:known.sha256,rootBinding:{scene:known.rootBinding.scene,sha256:files.get(known.rootBinding.scene).sha256,script:known.rootBinding.script,verification:files.get(known.rootBinding.scene).sha256===known.selectors.find(item=>item.path===known.rootBinding.scene).sha256?'exact-scene':'pinned-root-binding'}},properties:{saved_position_min:known.minimum,saved_position_max:known.maximum}}:{}),
    coordinateAnchor:'companion-feet',verticalContactToleranceMm:2,
    instruction:'Set both exported bounds on each companion instance before check/adoption. This plan does not write properties or certify runtime behavior. Inspect custom world overrides; the legacy ±80 defaults do not cover the full city.'};
}
module.exports={companionPositionConfiguration};
