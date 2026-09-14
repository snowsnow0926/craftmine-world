// Declarative assertions over real receipts. This module never edits progress.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';

export function pointerValue(document, pointer) {
  assert(typeof pointer === 'string' && (pointer === '' || pointer.startsWith('/')), 'JSON_POINTER_REQUIRED');
  assert(!/~(?:[^01]|$)/.test(pointer), 'INVALID_JSON_POINTER_ESCAPE');
  if (pointer === '') return {found:true, value:document};
  let value=document;
  for (const encoded of pointer.slice(1).split('/')) {
    assert(!/~(?:[^01]|$)/.test(encoded), 'INVALID_JSON_POINTER_ESCAPE');
    const key=encoded.replaceAll('~1','/').replaceAll('~0','~');
    if (value===null || typeof value!=='object' || !Object.hasOwn(value,key)) return {found:false};
    value=value[key];
  }
  return {found:true,value};
}

export function validateTemplateExpectations(packet) {
  assert.equal(packet?.format,'craftmine.template-import-expectations/1');
  assert.match(packet.archiveSha256??'',/^[a-f0-9]{64}$/,'EXACT_ARCHIVE_SHA256_REQUIRED');
  assert(typeof packet.title==='string' && packet.title.trim(), 'IMPORT_TITLE_REQUIRED');
  assert(Array.isArray(packet.checks) && packet.checks.length>0, 'DECLARED_STATE_CHECKS_REQUIRED');
  const ids=new Set();
  for (const check of packet.checks) {
    assert(typeof check.id==='string' && check.id && !ids.has(check.id), 'UNIQUE_CHECK_ID_REQUIRED');ids.add(check.id);
    assert(['snapshot','observation'].includes(check.source), 'READ_ONLY_CHECK_SOURCE_REQUIRED');
    pointerValue({},check.pointer);
    assert(Object.hasOwn(check,'value'), 'EXPLICIT_EXPECTED_VALUE_REQUIRED');
    if (check.tolerance!==undefined) assert(typeof check.value==='number' && Number.isFinite(check.value) && Number.isFinite(check.tolerance) && check.tolerance>=0, 'NUMERIC_TOLERANCE_REQUIRED');
  }
  if (packet.city) {
    assert.deepEqual(packet.city,{districts:6,authoredBuildings:22}, 'DECLARED_CITY_6_22_REQUIRED');
    assert([0,3].includes(packet.quest?.collected), 'DECLARE_DEFAULT_ZERO_OR_COMPLETED_THREE');
    assert.deepEqual([...packet.quest.items].sort(),['org-flight-chart','org-flight-clearance','org-flight-compass']);
    for (const [key,format] of [['flight','craftmine.reusable-j20-state/1'],['pet','craftmine.pet-companion-state/1']]) {
      assert(typeof packet[key]?.entityId==='string' && packet[key].entityId, 'ACTUAL_'+key.toUpperCase()+'_ENTITY_REQUIRED');
      assert.equal(packet[key].format,format);
      const prefix='/state/body/components/'+packet[key].entityId.replaceAll('~','~0').replaceAll('/','~1')+'/';
      for (const field of key==='flight'?['hasFlown','landings','piloted','crashed','grounded']:['interactionCount','settings/following','settings/name'])
        assert(packet.checks.some(check=>check.source==='snapshot' && check.pointer===prefix+field),'DECLARE_COMPONENT_FIELD:'+key+':'+field);
    }
  }
  return packet;
}

export function inspectTemplateState(packet, receipts) {
  validateTemplateExpectations(packet);
  const checks=[];
  const add=(id,passed,actual,expected)=>checks.push({id,passed:!!passed,actual,expected});
  for (const check of packet.checks) {
    const actual=pointerValue(receipts[check.source],check.pointer);
    const passed=actual.found && (check.tolerance===undefined?isDeepStrictEqual(actual.value,check.value):typeof actual.value==='number' && Math.abs(actual.value-check.value)<=check.tolerance);
    add(check.id,passed,actual,check.value);
  }
  if (packet.city) {
    for (const [key,expected] of Object.entries(packet.city)) {
      const actual=pointerValue(receipts.observation,'/payload/city/'+key);
      add('city-'+key,actual.found && actual.value===expected,actual,expected);
    }
    const inventory=pointerValue(receipts.snapshot,'/state/body/inventory');
    const validInventory=inventory.found && inventory.value!==null && typeof inventory.value==='object' && !Array.isArray(inventory.value);
    const counts=packet.quest.items.map(id=>validInventory && Object.hasOwn(inventory.value,id)?inventory.value[id]:0);
    add('quest-items',validInventory && counts.every(count=>count===(packet.quest.collected===3?1:0)),counts,packet.quest.collected===3?[1,1,1]:[0,0,0]);
    const preparation=receipts.observation?.payload?.flightPreparation;
    add('observed-quest',preparation?.collected===packet.quest.collected && preparation?.required===3 && preparation?.objectiveComplete===(packet.quest.collected===3),preparation?{collected:preparation.collected,required:preparation.required,objectiveComplete:preparation.objectiveComplete}:null,{collected:packet.quest.collected,required:3,objectiveComplete:packet.quest.collected===3});
    for (const key of ['flight','pet']) {
      const component=receipts.snapshot?.state?.body?.components?.[packet[key].entityId];
      add(key+'-component-identity',component?.entityId===packet[key].entityId && component?.format===packet[key].format,component?{entityId:component.entityId,format:component.format}:null,packet[key]);
      // Authored city components are declared by its actual flight integration;
      // they are not stock-editor entities (the actual stock list is empty).
      const entityId=preparation?.[key==='flight'?'aircraftId':'companionId'];
      add(key+'-observed-entity',entityId===packet[key].entityId,entityId??null,packet[key].entityId);
    }
  }
  return {passed:checks.every(check=>check.passed),checks};
}

export function requirePackagedResources(packaged, resources) {
  // Use the platform path implementation: callers pass actual Windows paths on Windows.
  if (!packaged) return;
  assert.equal(resources.replaceAll('\\','/').replace(/\/$/,'').toLowerCase(),(packaged.replaceAll('\\','/').replace(/\/$/,'')+'/resources').toLowerCase(),'PACKAGED_RUNTIME_RESOURCES_REQUIRED');
}
