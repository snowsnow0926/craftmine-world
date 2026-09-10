import assert from 'node:assert/strict';

// Requirement: the accepted product must actually play. A green build, a passed
// check or a readable candidate are not gameplay evidence, and the model's own
// summary is never evidence. This module turns the driver's raw ordinary-command
// evidence plus the real built source into per-criterion verdicts, so a missing
// mechanic fails loudly instead of being averaged away by a passing pipeline.
//
// Evidence sources, in order of strength:
//   1. live ordinary-command results of the running build (equip/fire/talk/move)
//   2. the live observation envelope captured beside each command
//   3. the authored source actually compiled into the checked candidate
//
// A criterion is `verified` only on direct evidence; `failed` on contradicting
// evidence; `insufficient` when the run simply never produced the evidence.

export const HAMMER_MIN_COOLDOWN_SECONDS = 1.0;
/** The player must genuinely travel before "out of range" can mean the dog
 * stopped following; otherwise the walk never left the spawn area. */
export const DOG_FAR_MIN_DISPLACEMENT = 400;
/** The short move must stay short, so "still in range" proves following rather
 * than a walk that never left contact. The real distance bound is proven by the
 * stops-when-far criterion, not by this sanity ceiling. */
export const DOG_NEAR_MAX_DISPLACEMENT = 960;

const value = action => (action && typeof action.result === 'object' && action.result !== null ? action.result : null);
const payload = action => (action?.observation && typeof action.observation.payload === 'object' ? action.observation.payload : null);
const errorOf = action => (typeof value(action)?.error === 'string' ? value(action).error : null);
const number = item => (typeof item === 'number' && Number.isFinite(item) ? item : null);
const texts = source => (Array.isArray(source) ? source : []).filter(file => typeof file?.text === 'string');
/** A file "names" the case when either its content or its own path does, so an
 * effect script named after the item is not missed just because it references
 * the id through a constant. */
const sourcesNaming = (source, needle) => texts(source).filter(file => file.text.includes(needle) || String(file?.path ?? '').includes(needle));
const attacks = actions => actions.filter(action => action?.op === 'fire' || action?.op === 'attack');
const equipActions = actions => actions.filter(action => action?.op === 'equip');
const talkActions = actions => actions.filter(action => action?.op === 'talk');

const criterion = (id, requirement, status, evidence) => ({ id, requirement, status, evidence });
const verified = (id, requirement, evidence) => criterion(id, requirement, 'verified', evidence);
const failed = (id, requirement, evidence) => criterion(id, requirement, 'failed', evidence);
/** Distinct from failed: the run did not obtain the evidence at all. */
const insufficient = (id, requirement, evidence) => criterion(id, requirement, 'insufficient', evidence);

function targets(snapshot) {
  const list = snapshot?.targets;
  return Array.isArray(list) ? list.filter(item => item && typeof item === 'object') : [];
}
/** Highest value of a numeric field across a bounded list, or null when absent. */
function maximum(list, key) {
  return list.reduce((best, item) => {
    const current = number(item?.[key]);
    return current !== null && (best === null || current > best) ? current : best;
  }, null);
}
/** The snapshot an action's own result carries, with no fallback: an equip that
 * failed must not inherit "the hammer is active" from a neighbouring sample. */
function directSnapshot(action) {
  const direct = value(action);
  const nested = direct?.snapshot;
  if (nested && typeof nested === 'object' && nested.equipment && typeof nested.equipment === 'object') return nested;
  return direct && typeof direct.equipment === 'object' ? direct : null;
}
/** The world snapshot for the moment the given action was observed. An attack
 * result carries its own post-attack snapshot, which is the strongest evidence;
 * otherwise the snapshot beside the action is used. */
function snapshotOf(action) {
  const direct = directSnapshot(action);
  if (direct) return direct;
  const observed = payload(action);
  return observed && typeof observed.equipment === 'object' ? observed : null;
}

function hammerCriteria(exercise, source) {
  const actions = Array.isArray(exercise.actions) ? exercise.actions : [];
  const shots = attacks(actions);
  const results = shots.map(value);
  const equipped = equipActions(actions).map(directSnapshot).find(snapshot => snapshot?.equipment?.active === 'thunder_hammer') ?? null;

  const named = sourcesNaming(source, 'thunder_hammer');
  const identity = named.length
    ? verified('stable-equipment-id-authored', 'The built source declares the stable equipment id thunder_hammer.', { files: named.map(file => file.path) })
    : failed('stable-equipment-id-authored', 'The built source declares the stable equipment id thunder_hammer.', { files: [], note: 'No authored file in the checked build mentions thunder_hammer.' });

  const equipResult = equipActions(actions).map(action => ({ op: action.op, args: action.args, error: errorOf(action), active: directSnapshot(action)?.equipment?.active ?? null }));
  const equip = equipped
    ? verified('equip-stable-id', 'An ordinary equip command accepts thunder_hammer and the running build reports it active.', { attempts: equipResult })
    : failed('equip-stable-id', 'An ordinary equip command accepts thunder_hammer and the running build reports it active.', { attempts: equipResult, note: 'No equip attempt left thunder_hammer active; a rejected id reports Unknown equipment.' });

  const display = equipped?.display ?? null;
  const visible = display && display.visible === true && typeof display.meshPath === 'string' && display.meshPath.length > 0;
  const visibility = equipped
    ? (visible
      ? verified('equipment-visible', 'The equipped hammer is visible in the running build with a real mesh.', { visible: display.visible, meshPath: display.meshPath, attachedToCamera: display.attachedToCamera ?? null, alignedWithCamera: display.alignedWithCamera ?? null })
      : failed('equipment-visible', 'The equipped hammer is visible in the running build with a real mesh.', { display }))
    : insufficient('equipment-visible', 'The equipped hammer is visible in the running build with a real mesh.', { note: 'The hammer never became active, so visibility could not be observed.' });

  const inventory = equipped?.inventory?.slots;
  const carried = Array.isArray(inventory) && inventory.some(slot => slot && typeof slot.id === 'string' && slot.id.includes('thunder_hammer'));
  const pickups = (Array.isArray(equipped?.interactables) ? equipped.interactables : []).filter(item => item && typeof item.id === 'string' && /hammer/i.test(item.id));
  const authoredPickup = sourcesNaming(source, 'thunder_hammer').some(file => /pickup|interactable|spawn|position/i.test(file.text));
  const obtainable = equipped
    ? (carried || pickups.length > 0 || authoredPickup
      ? verified('obtainable-near-spawn', 'The hammer is obtainable through ordinary play rather than only by direct equip.', { carriedInInventory: carried, pickupInteractables: pickups, authoredPickupPlacement: authoredPickup })
      : failed('obtainable-near-spawn', 'The hammer is obtainable through ordinary play rather than only by direct equip.', { carriedInInventory: carried, pickupInteractables: pickups, authoredPickupPlacement: authoredPickup, note: 'It is neither carried, nor an interactable, nor placed by authored source.' }))
    : insufficient('obtainable-near-spawn', 'The hammer is obtainable through ordinary play rather than only by direct equip.', { note: 'The hammer never became active.' });

  const accepted = shots.reduce((found, action, index) => found ?? (results[index]?.fired === true && results[index]?.equipment === 'thunder_hammer' ? { action: index, result: results[index] } : null), null);
  const attack = accepted
    ? verified('ordinary-attack-accepted', 'The ordinary attack command fires with the hammer equipped.', { fired: accepted.result.fired, attackMode: accepted.result.attackMode ?? null, shot: accepted.result.shot ?? null })
    : failed('ordinary-attack-accepted', 'The ordinary attack command fires with the hammer equipped.', { attempts: shots.map(action => ({ op: action.op, args: action.args, error: errorOf(action), fired: value(action)?.fired ?? null, reason: value(action)?.reason ?? null, equipment: value(action)?.equipment ?? null })) });

  const hits = shots.map((action, index) => ({ index, hits: Array.isArray(results[index]?.hits) ? results[index].hits : [], damage: number(results[index]?.damage) }));
  const landed = hits.find(entry => entry.hits.length > 0 || (entry.damage !== null && entry.damage > 0));
  const targetSets = actions.map(action => targets(snapshotOf(action)));
  const first = targetSets.find(list => list.length) ?? [];
  const bestHits = targetSets.reduce((best, list) => Math.max(best, maximum(list, 'hitCount') ?? -1), -1);
  const bestDamage = targetSets.reduce((best, list) => Math.max(best, maximum(list, 'damageTaken') ?? -1), -1);
  const baselineHits = maximum(first, 'hitCount') ?? -1;
  const baselineDamage = maximum(first, 'damageTaken') ?? -1;
  const moved = bestHits > baselineHits || bestDamage > baselineDamage;
  const effect = landed || moved
    ? verified('attack-affects-target', 'The ordinary attack changes real target state in the running build.', { hits: landed?.hits ?? [], damage: landed?.damage ?? null, targetHitCount: { before: baselineHits, after: bestHits }, targetDamageTaken: { before: baselineDamage, after: bestDamage } })
    : failed('attack-affects-target', 'The ordinary attack changes real target state in the running build.', { attempts: hits, targetHitCount: { before: baselineHits, after: bestHits }, targetDamageTaken: { before: baselineDamage, after: bestDamage }, note: 'No swing or shot reported a hit and no target counter moved.' });

  const cooldowns = shots.map(snapshotOf).map(snapshot => number(snapshot?.equipment?.cooldownSeconds)).filter(item => item !== null);
  const cooldown = cooldowns.find(item => item >= HAMMER_MIN_COOLDOWN_SECONDS);
  const cooldownCriterion = cooldown !== undefined
    ? verified('lightning-cooldown-at-least-one-second', `The equipped hammer declares a cooldown of at least ${HAMMER_MIN_COOLDOWN_SECONDS}s.`, { cooldownSeconds: cooldown, observed: cooldowns })
    : failed('lightning-cooldown-at-least-one-second', `The equipped hammer declares a cooldown of at least ${HAMMER_MIN_COOLDOWN_SECONDS}s.`, { observed: cooldowns, note: 'No observation of the active hammer reached the required cooldown.' });

  const suppressed = shots.slice(1).reduce((found, action, index) => {
    const previous = results[index], current = results[index + 1], snapshot = snapshotOf(action);
    if (previous?.fired !== true) return found;
    if (current?.fired !== false || typeof current.reason !== 'string' || !current.reason.length) return found;
    const remaining = number(snapshot?.equipment?.cooldownRemaining);
    return found ?? { index: index + 1, reason: current.reason, cooldownRemaining: remaining };
  }, null);
  const enforced = suppressed && suppressed.cooldownRemaining !== null && suppressed.cooldownRemaining > 0
    ? verified('cooldown-enforced-live', 'A repeated attack inside the cooldown window is refused while the cooldown is still running.', suppressed)
    : failed('cooldown-enforced-live', 'A repeated attack inside the cooldown window is refused while the cooldown is still running.', { suppressed, attempts: shots.map((action, index) => ({ index, fired: results[index]?.fired ?? null, reason: results[index]?.reason ?? null })) });

  const namedFiles = sourcesNaming(source, 'thunder_hammer');
  const lightningFiles = namedFiles.filter(file => /(lightning|Light3D|OmniLight|SpotLight|PointLight|DirectionalLight|flash|spark|bolt|glow)/i.test(file.text));
  const lightning = lightningFiles.length
    ? verified('lightning-visual-authored', 'The authored hammer source defines the local lightning visual.', { files: lightningFiles.map(file => file.path) })
    : failed('lightning-visual-authored', 'The authored hammer source defines the local lightning visual.', { files: namedFiles.map(file => file.path), note: 'No file that declares thunder_hammer also defines a light or flash effect.' });

  return [identity, equip, visibility, obtainable, attack, effect, cooldownCriterion, enforced, lightning];
}

function dogCriteria(exercise, source) {
  const actions = Array.isArray(exercise.actions) ? exercise.actions : [];
  const named = sourcesNaming(source, 'p8-dog');
  const identity = named.length
    ? verified('stable-dog-id-authored', 'The built source declares the stable id p8-dog.', { files: named.map(file => file.path) })
    : failed('stable-dog-id-authored', 'The built source declares the stable id p8-dog.', { files: [] });

  const visualFiles = named.filter(file => /(sprite2d|animatedsprite2d|sprite|texture|sheet|visual|\.png|frame)/i.test(file.text) || /(npc|character|sprite|visual)/i.test(file.path));
  const visual = visualFiles.length
    ? verified('dog-visible-authored', 'The authored dog has a visible representation, not just data.', { files: visualFiles.map(file => file.path) })
    : failed('dog-visible-authored', 'The authored dog has a visible representation, not just data.', { files: named.map(file => file.path), note: 'No file declaring p8-dog references a sprite, texture or scene visual.' });

  const talks = talkActions(actions);
  const indexOfFirstMove = actions.findIndex(action => action?.op === 'move');
  const dialogueOf = action => { const result = value(action); return result && result.ok === true && result.npcId === 'p8-dog' && typeof result.line === 'string' && result.line.trim().length > 0 ? result : null; };
  const attempt = action => ({ op: action?.op, args: action?.args, error: errorOf(action), ok: value(action)?.ok ?? null, npcId: value(action)?.npcId ?? null, line: value(action)?.line ?? null, reason: value(action)?.reason ?? null });
  const spawnTalk = talks.find((action, index) => (indexOfFirstMove < 0 || actions.indexOf(action) < indexOfFirstMove) && dialogueOf(action));
  const dialogue = spawnTalk
    ? verified('close-range-dialogue', 'The dog answers with a dialogue line at spawn distance.', { line: dialogueOf(spawnTalk).line, name: dialogueOf(spawnTalk).name ?? null })
    : failed('close-range-dialogue', 'The dog answers with a dialogue line at spawn distance.', { attempts: talks.map(attempt), note: 'No talk issued while still at spawn produced an ok dialogue line.' });

  const moves = actions.filter(action => action?.op === 'move');
  const followTalk = talks.reduce((found, action) => {
    if (found) return found;
    const index = actions.indexOf(action);
    if (index < 0 || indexOfFirstMove < 0 || index < indexOfFirstMove) return null;
    const result = dialogueOf(action); if (!result) return null;
    const travelled = moves.filter(move => actions.indexOf(move) < index).reduce((sum, move) => sum + (number(value(move)?.distance) ?? 0), 0);
    return { index, travelled, line: result.line };
  }, null);
  const follow = followTalk && followTalk.travelled > 0 && followTalk.travelled <= DOG_NEAR_MAX_DISPLACEMENT
    ? verified('bounded-distance-follow', 'The dog stays within a bounded distance while the player walks a short way.', { travelled: followTalk.travelled, line: followTalk.line })
    : failed('bounded-distance-follow', 'The dog stays within a bounded distance while the player walks a short way.', { found: followTalk, moves: moves.map(action => ({ args: action.args, distance: number(value(action)?.distance), blocked: value(action)?.blocked ?? null })) });

  const travelled = moves.reduce((sum, action) => sum + (number(value(action)?.distance) ?? 0), 0);
  const farTalk = talks.reduce((found, action) => {
    const index = actions.indexOf(action);
    if (index < indexOfFirstMove) return found;
    const upTo = moves.filter(move => actions.indexOf(move) < index).reduce((sum, move) => sum + (number(value(move)?.distance) ?? 0), 0);
    const error = errorOf(action);
    return typeof error === 'string' && error.includes('out_of_range') ? { index, upTo, error } : found;
  }, null);
  const stops = farTalk && farTalk.upTo >= DOG_FAR_MIN_DISPLACEMENT
    ? verified('stops-when-far', 'The dog stops following once the player is genuinely far away.', { travelled: farTalk.upTo, error: farTalk.error })
    : failed('stops-when-far', 'The dog stops following once the player is genuinely far away.', { found: farTalk, totalTravelled: travelled, requiredDisplacement: DOG_FAR_MIN_DISPLACEMENT, attempts: talks.map(attempt), note: farTalk ? 'The player never actually travelled far enough for this to prove a bound.' : 'A talk from far away still succeeded, so the follow is unbounded.' });

  return [identity, visual, dialogue, follow, stops];
}

/** Evaluate one case's gameplay standard from its own raw evidence. */
export function evaluateGameplay({ caseId, exercise, source }) {
  assert.ok(['hammer', 'dog'].includes(caseId), 'P8_GAMEPLAY_CASE_REQUIRED');
  const found = caseId === 'hammer' ? hammerCriteria(exercise ?? {}, source) : dogCriteria(exercise ?? {}, source);
  return {
    format: 'craftmine.p8-gameplay-verdict/1',
    caseId,
    criteria: found,
    verified: found.every(item => item.status === 'verified'),
    failed: found.filter(item => item.status === 'failed').map(item => item.id),
    insufficient: found.filter(item => item.status === 'insufficient').map(item => item.id),
    note: 'Verdicts come from live ordinary-command results, live observations and the authored source actually compiled into the checked candidate. They never come from the model\'s own claims.',
  };
}
