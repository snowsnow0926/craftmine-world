import assert from 'node:assert/strict';

export const promoBody=snapshot=>{assert.equal(snapshot?.state?.body?.format,'craftmine.creation-progress/1');return snapshot.state.body;};
export function preservePriorComponents(before,after){
  const a=promoBody(before),b=promoBody(after);
  for(const [id,state]of Object.entries(a.components??{}))assert.deepEqual(b.components?.[id],state,'PRIOR_COMPONENT_CHANGED:'+id);
  assert.deepEqual(b.player,a.player,'PLAYER_CHANGED_DURING_INSTALL');
  for(const key of ['inventory','openedChests','doors','rules'])assert.deepEqual(b[key],a[key],'PRIOR_WORLD_PROGRESS_CHANGED:'+key);
  return {previousComponentIds:Object.keys(a.components??{}),addedComponentIds:Object.keys(b.components??{}).filter(id=>!Object.hasOwn(a.components??{},id)),priorComponentsPreserved:true};
}

export function observeLiveComponents(before,after){
  const a=promoBody(before),b=promoBody(after),changed=[];
  for(const [id,state]of Object.entries(a.components??{})){
    const live=b.components?.[id];assert(live,'LIVE_COMPONENT_MISSING:'+id);
    assert.equal(live.entityId,state.entityId);assert.equal(live.format,state.format);
    if(typeof live.health==='number')assert(Number.isFinite(live.health)&&live.health>=0,'INVALID_LIVE_HEALTH:'+id);
    if(!Object.is(JSON.stringify(live),JSON.stringify(state)))changed.push(id);
  }
  return {scope:'live-after-UI-and-simulation',oldComponentIds:Object.keys(a.components??{}),changedComponentIds:changed,
    note:'Live state may advance. This observation is not the strict application or cold-restore preservation proof.'};
}

// Only fields changed by the shipped scripts without new player input can be
// outside the cold exact-value assertion, and only with real frame evidence.
// They remain in the raw snapshots and are explicitly UNCONFIRMED, not passed.
export function compareColdLiveProgress(saved,reopened,observation){
  const a=structuredClone(promoBody(saved)),b=structuredClone(promoBody(reopened));
  const ticks=observation?.payload?.creation?.physicsTick;
  assert(Number.isSafeInteger(ticks)&&ticks>=0,'COLD_PHYSICS_EVIDENCE_REQUIRED');
  const unconfirmed=[];
  const exclude=(left,right,key,label)=>{
    if(!Object.hasOwn(left,key)||!Object.hasOwn(right,key))return;
    try{assert.deepEqual(left[key],right[key]);}catch{
      assert(ticks>0,'COLD_CHANGED_WITHOUT_FRAME_EVIDENCE:'+label);
      unconfirmed.push({path:label,before:left[key],after:right[key],reason:'native snapshot sampled after runtime resumed; exact restored value unconfirmed'});
    }
    delete left[key];delete right[key];
  };
  for(const key of ['position','onFloor'])exclude(a.player,b.player,key,'player.'+key);
  for(const [id,value]of Object.entries(a.components??{})){
    const live=b.components?.[id];assert(live,'COLD_COMPONENT_MISSING:'+id);
    let allowed=[];
    if(value.format==='craftmine.promo-hornling/1')allowed=['position','yaw'];
    if(value.format==='craftmine.promo-heavyblade/1'&&value.action==='none'&&live.action==='none')allowed=['stamina','staminaDelay','dodgeCooldown','invulnerable'];
    if(value.format==='craftmine.promo-ak47/1')allowed=['cooldown','reloadRemaining'];
    for(const key of allowed)exclude(value,live,key,'components.'+id+'.'+key);
  }
  assert.deepEqual(b,a,'COLD_PERSISTENT_VALUE_CHANGED');
  let fullDifference=null;try{assert.deepEqual(promoBody(reopened),promoBody(saved),'COLD_PROGRESS_CHANGED');}catch(error){fullDifference=String(error);}
  return {scope:'native-after-resume-persistent-values',strictPersistentValues:true,physicsTick:ticks,
    fullSnapshotEqual:fullDifference===null,fullDifference,unconfirmedFields:unconfirmed,
    exactNativePoseRestore:'unconfirmed-after-resume',note:'This is not a complete zero-frame native restore proof. Closed Core persistence and application migration are checked separately.'};
}
