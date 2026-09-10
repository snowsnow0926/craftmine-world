import assert from 'node:assert/strict';

// Requirement: the accepted product must actually play, and this module must not
// claim more than its evidence supports. A green build, a passed check or the
// model's own summary are not gameplay evidence.
//
// Every criterion is judged from one of three sources, in this order of strength:
//   1. live ordinary-command results of the running build
//   2. the live observation envelope captured beside each command
//   3. the authored source actually compiled into the checked candidate
//
// Four verdicts exist, and they are not interchangeable:
//   verified          direct, machine-checkable proof of the stated claim
//   failed            evidence that contradicts the stated claim
//   insufficient      the run never produced the evidence
//   review-required   evidence exists, but the claim cannot be settled by machine
//                     judgement alone; a named reviewer must confirm it from the
//                     cited evidence. It is NEVER a pass.
//
// Claims about the lightning effect's visibility and its own cooldown are
// `review-required` on purpose: the product exposes no channel for a
// model-authored effect's own state, and the driver is not allowed to widen the
// observation schema for a test. The attack gate's timing below is a fact about
// the ordinary attack, not about the lightning.

export const STATUSES = Object.freeze(['verified', 'failed', 'insufficient', 'review-required']);
/** The authored effect must declare at least this long a cooldown. */
export const LIGHTNING_MIN_COOLDOWN_SECONDS = 1.0;
/** Physics rate the fixed sequences are scheduled against. */
export const GAME_FPS = 60;
/** Base interaction radius (town Interactable area, first-person AimQuery 3.5 m). */
export const INTERACT_RADIUS_PX = 22;
/** The player must outwalk the radius by this much for "it followed" to mean
 * something; a few pixels of drift cannot explain the dog still being in range. */
export const FOLLOW_PROOF_MIN_PX = 150;
/** Distance the player must genuinely travel before "out of range" can mean the
 * dog stopped following rather than that the walk never left the spawn area. */
export const FAR_PROOF_MIN_PX = 250;

const value = action => (action && typeof action.result === 'object' && action.result !== null ? action.result : null);
const payload = action => (action?.observation && typeof action.observation.payload === 'object' ? action.observation.payload : null);
const errorOf = action => (typeof value(action)?.error === 'string' ? value(action).error : null);
const number = item => (typeof item === 'number' && Number.isFinite(item) ? item : null);
const texts = source => (Array.isArray(source) ? source : []).filter(file => typeof file?.text === 'string');
/** A file "names" the case when either its content or its own path does. */
const sourcesNaming = (source, needle) => texts(source).filter(file => file.text.includes(needle) || String(file?.path ?? '').includes(needle));
const attacks = actions => actions.filter(action => action?.op === 'fire' || action?.op === 'attack');
const equipActions = actions => actions.filter(action => action?.op === 'equip');
const talkActions = actions => actions.filter(action => action?.op === 'talk');

const criterion = (id, requirement, status, evidence) => ({ id, requirement, status, evidence });
const verified = (id, requirement, evidence) => criterion(id, requirement, 'verified', evidence);
const failed = (id, requirement, evidence) => criterion(id, requirement, 'failed', evidence);
const insufficient = (id, requirement, evidence) => criterion(id, requirement, 'insufficient', evidence);
const reviewRequired = (id, requirement, evidence) => criterion(id, requirement, 'review-required', evidence);

function targets(snapshot) {
  const list = snapshot?.targets;
  return Array.isArray(list) ? list.filter(item => item && typeof item === 'object') : [];
}
function maximum(list, key) {
  return list.reduce((best, item) => {
    const current = number(item?.[key]);
    return current !== null && (best === null || current > best) ? current : best;
  }, null);
}
const slots = snapshot => (Array.isArray(snapshot?.inventory?.slots) ? snapshot.inventory.slots.filter(slot => slot && typeof slot === 'object') : []);
const holds = (snapshot, id) => slots(snapshot).some(slot => typeof slot.id === 'string' && slot.id.includes(id));
const interactables = snapshot => (Array.isArray(snapshot?.interactables) ? snapshot.interactables.filter(item => item && typeof item === 'object') : []);
const overlaps = action => {
  const map = payload(action)?.physical?.overlaps;
  return map && typeof map === 'object' && !Array.isArray(map) ? map : null;
};

/** The snapshot an action's own result carries, with no fallback: an equip that
 * failed must not inherit "the hammer is active" from a neighbouring sample. */
function directSnapshot(action) {
  const direct = value(action);
  const nested = direct?.snapshot;
  if (nested && typeof nested === 'object' && nested.equipment && typeof nested.equipment === 'object') return nested;
  return direct && typeof direct.equipment === 'object' ? direct : null;
}
/** The world snapshot for the moment the given action was observed. An attack or
 * interact result carries its own post-action snapshot, which is the strongest
 * evidence; otherwise the snapshot beside the action is used. */
function snapshotOf(action) {
  const direct = directSnapshot(action);
  if (direct) return direct;
  const observed = payload(action);
  return observed && (typeof observed.equipment === 'object' || typeof observed.physical === 'object') ? observed : null;
}

/** Game frames an op declares it advances. Ops with no declared duration count
 * as zero, so any sum is a lower bound on the real elapsed game time. */
function declaredFrames(action) {
  if (!action) return 0;
  if (action.op === 'wait') return number(action.args?.frames) ?? 0;
  if (action.op === 'walk') return number(action.args?.frames) ?? 30;
  if (action.op === 'move') return number(action.args?.steps) ?? 0;
  return 0;
}
const framesBetween = (actions, from, to) => actions.slice(from + 1, to).reduce((sum, action) => sum + declaredFrames(action), 0);
function wallMs(action) {
  return number(action?.observedAtMs) ?? number(action?.observation?.observedAtMs);
}
/** Elapsed time between two actions. The wall clock is a real upper bound on the
 * game time; the declared frames are a lower bound. Both are reported. */
function elapsed(actions, from, to) {
  const start = wallMs(actions[from]), end = wallMs(actions[to]);
  const wall = start !== null && end !== null && end >= start ? end - start : null;
  const frames = framesBetween(actions, from, to);
  return { wallMs: wall, frames, gameMsLowerBound: Math.round(frames * 1000 / GAME_FPS), known: wall !== null };
}
function frameEvidence(actions) {
  return actions.filter(action => action?.frame && typeof action.frame === 'object').map(action => ({
    op: action.op, args: action.args, file: action.frame.file ?? null, sha256: action.frame.sha256 ?? null,
    width: action.frame.width ?? null, height: action.frame.height ?? null, observedAtMs: wallMs(action),
    offsetFromAttackMs: action.frame.offsetFromAttackMs ?? null, sampledAt: action.observation?.sampledAt ?? null,
  }));
}

function hammerCriteria(exercise, source) {
  const actions = Array.isArray(exercise.actions) ? exercise.actions : [];
  const shots = attacks(actions), results = shots.map(value);
  const named = sourcesNaming(source, 'thunder_hammer');

  const identity = named.length
    ? verified('stable-equipment-id-authored', 'The built source declares the stable equipment id thunder_hammer.', { files: named.map(file => file.path) })
    : failed('stable-equipment-id-authored', 'The built source declares the stable equipment id thunder_hammer.', { files: [], note: 'No authored file in the checked build mentions thunder_hammer.' });

  // Source hint only. It says the author placed something to pick up; it is not
  // evidence that a player ever picked it up.
  const placement = named.filter(file => /(pickup|interactable|spawn|position|place)/i.test(file.text));
  const hint = placement.length
    ? verified('pickup-source-hint', 'The authored source places thunder_hammer as something obtainable in the world.', { files: placement.map(file => file.path), scope: 'source hint only; it does not prove a pickup happened' })
    : failed('pickup-source-hint', 'The authored source places thunder_hammer as something obtainable in the world.', { files: named.map(file => file.path), note: 'No file naming thunder_hammer mentions a pickup, interactable or placement.' });

  // Real pickup through the ordinary interact command.
  const interacts = actions.filter(action => action?.op === 'interact');
  const attempts = interacts.map((action, index) => {
    const at = actions.indexOf(action), before = at > 0 ? snapshotOf(actions[at - 1]) : null, after = snapshotOf(action) ?? before;
    const result = value(action);
    return {
      index, observedAtMs: wallMs(action), aimInteractable: payload(actions[at - 1])?.aim?.interactable ?? null, aimCollider: payload(actions[at - 1])?.aim?.collider ?? null,
      error: errorOf(action), handled: result?.handled ?? null, item: result?.item ?? null, taken: result?.taken ?? null, reason: result?.reason ?? null,
      carriedBefore: before ? holds(before, 'thunder_hammer') : null, carriedAfter: after ? holds(after, 'thunder_hammer') : null,
      interactablesBefore: before ? interactables(before).map(entry => ({ id: entry.id, enabled: entry.enabled ?? null, taken: entry.taken ?? null })) : null,
      interactablesAfter: after ? interactables(after).map(entry => ({ id: entry.id, enabled: entry.enabled ?? null, taken: entry.taken ?? null })) : null,
    };
  });
  const picked = attempts.find(entry => entry.carriedAfter === true && entry.carriedBefore !== true)
    ?? attempts.find(entry => entry.handled === true && entry.item === 'thunder_hammer' && entry.carriedAfter !== false);
  const pickup = !interacts.length
    ? insufficient('pickup-actual', 'The hammer is actually picked up by an ordinary interact while it is in reach.', { stepPresent: false, note: 'The fixed sequence issued no interact step, so no pickup was attempted.' })
    : (picked
      ? verified('pickup-actual', 'The hammer is actually picked up by an ordinary interact while it is in reach.', { attempts, picked })
      : failed('pickup-actual', 'The hammer is actually picked up by an ordinary interact while it is in reach.', { attempts, stepPresent: true, note: 'Interacts were issued but the hammer never entered the inventory.' }));

  const equipEvidence = equipActions(actions).map(action => ({ op: action.op, args: action.args, error: errorOf(action), active: directSnapshot(action)?.equipment?.active ?? null }));
  const equipped = equipActions(actions).map(directSnapshot).find(snapshot => snapshot?.equipment?.active === 'thunder_hammer') ?? null;
  const equip = equipped
    ? verified('equip-stable-id', 'An ordinary equip command accepts thunder_hammer and the running build reports it active.', { attempts: equipEvidence, note: 'Equip is never accepted as pickup evidence.' })
    : failed('equip-stable-id', 'An ordinary equip command accepts thunder_hammer and the running build reports it active.', { attempts: equipEvidence, note: 'No equip attempt left thunder_hammer active; a rejected id reports Unknown equipment.' });

  const display = equipped?.display ?? null;
  const visible = display && display.visible === true && typeof display.meshPath === 'string' && display.meshPath.length > 0;
  const visibility = equipped
    ? (visible
      ? verified('equipment-visible', 'The equipped hammer is visible in the running build with a real mesh.', { visible: display.visible, meshPath: display.meshPath, attachedToCamera: display.attachedToCamera ?? null, alignedWithCamera: display.alignedWithCamera ?? null })
      : failed('equipment-visible', 'The equipped hammer is visible in the running build with a real mesh.', { display }))
    : insufficient('equipment-visible', 'The equipped hammer is visible in the running build with a real mesh.', { note: 'The hammer never became active, so visibility could not be observed.' });

  const accepted = results.reduce((found, result, index) => found ?? (result?.fired === true && result?.equipment === 'thunder_hammer' ? { shotIndex: index } : null), null);
  const attackSummary = shots.map((action, index) => ({ op: action.op, args: action.args, error: errorOf(action), fired: results[index]?.fired ?? null, reason: results[index]?.reason ?? null, equipment: results[index]?.equipment ?? null, observedAtMs: wallMs(action) }));
  const attack = accepted
    ? verified('attack-accepted', 'The ordinary attack command fires with the hammer equipped.', { attempts: attackSummary })
    : failed('attack-accepted', 'The ordinary attack command fires with the hammer equipped.', { attempts: attackSummary });

  // Ordinary attack gate, measured from the real receipt times. This is a fact
  // about the attack command, not about the lightning effect's own cooldown.
  const refusals = shots.reduce((list, action, index) => {
    if (index === 0 || results[index]?.fired !== false || typeof results[index].reason !== 'string' || !results[index].reason.length) return list;
    const previous = [...results.slice(0, index)].map((item, at) => (item?.fired === true ? at : -1)).filter(at => at >= 0).pop();
    if (previous === undefined) return list;
    list.push({ refusedAt: index, afterShot: previous, reason: results[index].reason, ...elapsed(actions, actions.indexOf(shots[previous]), actions.indexOf(action)) });
    return list;
  }, []);
  const insideWindow = refusals.find(entry => entry.known && entry.wallMs < 1000);
  const anyAttack = shots.length > 0;
  const withinSecond = !anyAttack
    ? insufficient('attack-gate-refused-within-one-second', 'An attack repeated inside the same second is refused.', { note: 'No attack was issued.' })
    : (insideWindow
      ? verified('attack-gate-refused-within-one-second', 'An attack repeated inside the same second is refused.', { refusal: insideWindow, refusals, scope: 'ordinary attack gate; the lightning effect has its own cooldown and is judged separately' })
      : failed('attack-gate-refused-within-one-second', 'An attack repeated inside the same second is refused.', { refusals, note: 'No refused attack was observed within one second of a successful one.' }));
  const reopen = refusals.reduce((found, refusal) => {
    if (found) return found;
    for (let index = refusal.refusedAt + 1; index < shots.length; index++) {
      if (results[index]?.fired !== true) continue;
      const timing = elapsed(actions, actions.indexOf(shots[refusal.refusedAt]), actions.indexOf(shots[index]));
      if (timing.known && timing.wallMs >= 1000 && timing.gameMsLowerBound >= 1000) return { acceptedAt: index, afterRefusal: refusal.refusedAt, ...timing };
      return found;
    }
    return found;
  }, null);
  const reopened = !refusals.length
    ? insufficient('attack-gate-accepted-after-one-second', 'The attack gate reopens after more than a second.', { note: 'No refused attack was observed, so the window could not be timed.' })
    : (reopen
      ? verified('attack-gate-accepted-after-one-second', 'The attack gate reopens after more than a second.', { reopen, refusals })
      : failed('attack-gate-accepted-after-one-second', 'The attack gate reopens after more than a second.', { refusals, note: 'No attack succeeded more than one second after a refusal.' }));

  const hits = shots.map((action, index) => ({ index, hits: Array.isArray(results[index]?.hits) ? results[index].hits : [], damage: number(results[index]?.damage) }));
  const landed = hits.find(entry => entry.hits.length > 0 || (entry.damage !== null && entry.damage > 0));
  const targetSets = actions.map(action => targets(snapshotOf(action)));
  const first = targetSets.find(list => list.length) ?? [];
  const bestHits = targetSets.reduce((best, list) => Math.max(best, maximum(list, 'hitCount') ?? -1), -1);
  const bestDamage = targetSets.reduce((best, list) => Math.max(best, maximum(list, 'damageTaken') ?? -1), -1);
  const baselineHits = maximum(first, 'hitCount') ?? -1, baselineDamage = maximum(first, 'damageTaken') ?? -1;
  const effect = landed || bestHits > baselineHits || bestDamage > baselineDamage
    ? verified('attack-affects-target', 'The ordinary attack changes real target state in the running build.', { hits: landed?.hits ?? [], damage: landed?.damage ?? null, targetHitCount: { before: baselineHits, after: bestHits }, targetDamageTaken: { before: baselineDamage, after: bestDamage } })
    : failed('attack-affects-target', 'The ordinary attack changes real target state in the running build.', { attempts: hits, targetHitCount: { before: baselineHits, after: bestHits }, targetDamageTaken: { before: baselineDamage, after: bestDamage } });

  // Source fact: the authored effect exists. It does not prove it is visible.
  const lightningFiles = named.filter(file => /(lightning|Light3D|OmniLight|SpotLight|PointLight|DirectionalLight|flash|spark|bolt|glow)/i.test(file.text));
  const lightningSource = lightningFiles.length
    ? verified('lightning-visual-in-source', 'The authored hammer source defines a local lightning visual.', { files: lightningFiles.map(file => file.path), scope: 'source fact only; frame visibility is reviewed separately' })
    : failed('lightning-visual-in-source', 'The authored hammer source defines a local lightning visual.', { files: named.map(file => file.path), note: 'No file that declares thunder_hammer also defines a light or flash effect.' });

  // The declared effect cooldown, if the source states one near the effect.
  const declared = [];
  for (const file of lightningFiles) {
    for (const match of file.text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*(?::=\s*|=)\s*([0-9]+(?:\.[0-9]+)?)/g)) {
      const [, name, raw] = match;
      if (/(cooldown|delay|interval|charge|recover|reload|cd)/i.test(name)) declared.push({ file: file.path, name, seconds: Number(raw), snippet: match[0] });
    }
  }
  const declaredEnough = declared.filter(entry => entry.seconds >= LIGHTNING_MIN_COOLDOWN_SECONDS);
  const frames = frameEvidence(actions);
  const lightningVisibility = frames.length
    ? reviewRequired('lightning-visible-in-frames', 'The lightning effect is visible in the real rendered frames.', { frames: frames.length, evidence: frames, candidates: lightningFiles.map(file => file.path), reviewerMustConfirm: 'P5/P6 review the frames and the authored effect together; no product channel reports the effect state.' })
    : insufficient('lightning-visible-in-frames', 'The lightning effect is visible in the real rendered frames.', { frames: [], note: 'The run captured no frames near the attacks.' });
  const lightningCooldown = reviewRequired('lightning-cooldown-at-least-one-second', `The lightning effect itself has a cooldown of at least ${LIGHTNING_MIN_COOLDOWN_SECONDS}s.`, {
    declared: declaredEnough.length ? declaredEnough : null, declaredAll: declared.length ? declared : null,
    attackGateTimings: { refusals, reopen }, frames: frames.map(frame => ({ op: frame.op, observedAtMs: frame.observedAtMs, offsetFromAttackMs: frame.offsetFromAttackMs, sampledAt: frame.sampledAt, sha256: frame.sha256, file: frame.file })),
    scope: 'Neither the ordinary attack cooldown nor a model self-report proves the effect cooldown. The reviewer must read the authored effect and the frames.',
  });

  return [identity, hint, pickup, equip, visibility, attack, withinSecond, reopened, effect, lightningSource, lightningVisibility, lightningCooldown];
}

function dogCriteria(exercise, source) {
  const actions = Array.isArray(exercise.actions) ? exercise.actions : [];
  const named = sourcesNaming(source, 'p8-dog');
  const identity = named.length
    ? verified('stable-dog-id-authored', 'The built source declares the stable id p8-dog.', { files: named.map(file => file.path) })
    : failed('stable-dog-id-authored', 'The built source declares the stable id p8-dog.', { files: [] });

  const talks = talkActions(actions);
  // The talk argument is matched against entity_id; the returned npcId is the
  // data id, so it is recorded but never required to equal the argument.
  const dialogueOf = action => {
    const result = value(action);
    return result && result.ok === true && typeof result.line === 'string' && result.line.trim().length > 0 ? result : null;
  };
  const attempt = action => ({ op: action?.op, args: action?.args, error: errorOf(action), ok: value(action)?.ok ?? null, dataId: value(action)?.npcId ?? null, name: value(action)?.name ?? null, line: value(action)?.line ?? null, reason: value(action)?.reason ?? null, observedAtMs: wallMs(action) });
  const firstMove = actions.findIndex(entry => entry?.op === 'move');
  const spawnTalk = talks.find(action => { const at = actions.indexOf(action); return (firstMove < 0 || at < firstMove) && dialogueOf(action); });
  const dialogue = spawnTalk
    ? verified('dog-dialogue-live', 'A dog entity with the stable id answers with real dialogue at spawn distance.', { argument: spawnTalk.args?.npcId ?? null, dataId: dialogueOf(spawnTalk).npcId ?? null, name: dialogueOf(spawnTalk).name ?? null, line: dialogueOf(spawnTalk).line, attempts: talks.map(attempt), scope: 'The talk argument resolves by entity_id, so a successful answer proves that id exists and is in range.' })
    : failed('dog-dialogue-live', 'A dog entity with the stable id answers with real dialogue at spawn distance.', { attempts: talks.map(attempt), note: 'No talk with that entity id, issued while at spawn, returned a dialogue line.' });

  const spawn = actions.find((action, index) => (firstMove < 0 || index < firstMove) && overlaps(action));
  const spawnOverlaps = spawn ? overlaps(spawn) : null;
  const present = spawnOverlaps && Object.prototype.hasOwnProperty.call(spawnOverlaps, 'p8-dog');
  const presence = present
    ? (spawnOverlaps['p8-dog'] === true
      ? verified('dog-near-spawn-observed', 'The running town build reports the dog entity in contact range at spawn.', { overlaps: spawnOverlaps, observedAtMs: wallMs(spawn) })
      : failed('dog-near-spawn-observed', 'The running town build reports the dog entity in contact range at spawn.', { overlaps: spawnOverlaps, note: 'The entity exists but was not in contact range at spawn.' }))
    : failed('dog-near-spawn-observed', 'The running town build reports the dog entity in contact range at spawn.', { overlaps: spawnOverlaps, note: 'The physical overlap report has no p8-dog key, so no such entity is registered in the running scene.' });

  const moves = actions.filter(action => action?.op === 'move');
  const travelledBefore = index => moves.filter(action => actions.indexOf(action) < index).reduce((sum, action) => sum + (number(value(action)?.distance) ?? 0), 0);
  // The far boundary is the first answer that says "out of range": it closes both
  // the following window and the far window, so a walk back cannot be mistaken
  // for evidence about how far the dog followed.
  const farTalk = talks.reduce((found, action) => {
    const index = actions.indexOf(action);
    if (firstMove < 0 || index < firstMove) return found;
    const error = errorOf(action);
    return found ?? (typeof error === 'string' && error.includes('out_of_range') ? { index, travelled: travelledBefore(index), error } : null);
  }, null);
  const farLimit = farTalk ? farTalk.index : actions.length - 1;
  const followTalk = talks.reduce((found, action) => {
    if (found) return found;
    const index = actions.indexOf(action);
    if (index < 0 || firstMove < 0 || index < firstMove) return null;
    const result = dialogueOf(action); if (!result) return null;
    const travelled = travelledBefore(index);
    return travelled > 0 ? { index, travelled, line: result.line } : null;
  }, null);
  const followOverlap = actions.map((action, index) => ({ action, index }))
    // Strictly before the first answer that says "out of range": the observation
    // taken at that same step cannot be used to prove the dog was still in range.
    .find(entry => entry.index > firstMove && entry.index < farLimit && overlaps(entry.action) && overlaps(entry.action)['p8-dog'] === true && travelledBefore(entry.index) >= FOLLOW_PROOF_MIN_PX) ?? null;
  const follow = followTalk && followOverlap
    ? verified('bounded-follow-observed', 'The dog stays in contact range after the player walks well beyond it.', { travelled: travelledBefore(followOverlap.index), overlaps: overlaps(followOverlap.action), line: followTalk.line, requiredTravelled: FOLLOW_PROOF_MIN_PX, withinFarBoundary: farLimit })
    : failed('bounded-follow-observed', 'The dog stays in contact range after the player walks well beyond it.', { followTalk, followOverlap, requiredTravelled: FOLLOW_PROOF_MIN_PX, withinFarBoundary: farLimit, moves: moves.map(action => ({ args: action.args, distance: number(value(action)?.distance), blocked: value(action)?.blocked ?? null })), note: 'Following is only proven if the player really outwalked the dog and it was still in range before the far boundary.' });
  const totalTravelled = moves.reduce((sum, action) => sum + (number(value(action)?.distance) ?? 0), 0);
  const farOverlap = actions.map((action, index) => ({ action, index }))
    .filter(entry => entry.index > firstMove && entry.index <= farLimit && overlaps(entry.action) && travelledBefore(entry.index) >= FAR_PROOF_MIN_PX).at(-1) ?? null;
  const farMap = farOverlap ? overlaps(farOverlap.action) : null;
  const far = farTalk && farMap && farTalk.travelled >= FAR_PROOF_MIN_PX && farMap['p8-dog'] === false
    ? verified('far-out-of-contact-observed', 'Once the player is genuinely far away the dog is no longer in contact and does not answer.', { travelled: travelledBefore(farOverlap.index), overlaps: farMap, error: farTalk.error, requiredTravelled: FAR_PROOF_MIN_PX })
    : failed('far-out-of-contact-observed', 'Once the player is genuinely far away the dog is no longer in contact and does not answer.', { farTalk, farOverlap: farOverlap ? { index: farOverlap.index, travelled: travelledBefore(farOverlap.index), overlaps: farMap } : null, totalTravelled, requiredTravelled: FAR_PROOF_MIN_PX, attempts: talks.map(attempt), note: farTalk ? 'The far leg did not produce both a real distance and a lost contact.' : 'A talk from far away still succeeded, so the follow is unbounded.' });

  const farIndex = farTalk ? farTalk.index : (farOverlap ? farOverlap.index : -1);
  const recontact = (() => {
    if (farIndex < 0) return null;
    const later = actions.map((action, index) => ({ action, index })).filter(entry => entry.index > farIndex && (entry.action.op === 'move' || entry.action.op === 'wait'));
    const hit = later.find(entry => { const talk = talks.find(action => actions.indexOf(action) > entry.index && dialogueOf(action)); return Boolean(talk); });
    if (!hit) return null;
    const talk = talks.find(action => actions.indexOf(action) > hit.index && dialogueOf(action));
    return { index: hit.index, op: hit.action.op, overlaps: overlaps(hit.action), talkIndex: actions.indexOf(talk), talkObservedAtMs: wallMs(talk), line: dialogueOf(talk).line };
  })();
  const approach = recontact
    ? verified('approach-recontact-observed', 'The player can walk back and reach the dog again, so it stayed behind instead of following.', { recontact })
    : failed('approach-recontact-observed', 'The player can walk back and reach the dog again, so it stayed behind instead of following.', { recontact, attempts: talks.map(attempt), note: 'No approach leg re-established contact and produced dialogue again.' });

  const frames = frameEvidence(actions);
  const visibility = frames.length
    ? reviewRequired('dog-visible-in-frames', 'The dog is visibly rendered in the real frames.', { frames: frames.length, evidence: frames, candidates: named.map(file => file.path), reviewerMustConfirm: 'P6 reviews the frames and the authored scene; the overlap report proves presence, not visibility.' })
    : insufficient('dog-visible-in-frames', 'The dog is visibly rendered in the real frames.', { frames: [], note: 'The run captured no frames.' });
  const stop = reviewRequired('dog-stop-not-continuing', 'After the boundary the dog stops moving rather than circling or resuming the chase.', {
    farLeg: farOverlap, recontact, frames: frames.map(frame => ({ op: frame.op, observedAtMs: frame.observedAtMs, sha256: frame.sha256, file: frame.file })),
    reviewerMustConfirm: 'No product channel reports the dog position over time, so "it stopped" needs the frames and the authored follow logic.',
  });

  return [identity, dialogue, presence, follow, far, approach, visibility, stop];
}

/** Evaluate one case's gameplay standard from its own raw evidence. */
export function evaluateGameplay({ caseId, exercise, source }) {
  assert.ok(['hammer', 'dog'].includes(caseId), 'P8_GAMEPLAY_CASE_REQUIRED');
  const criteria = caseId === 'hammer' ? hammerCriteria(exercise ?? {}, source) : dogCriteria(exercise ?? {}, source);
  const withStatus = status => criteria.filter(item => item.status === status).map(item => item.id);
  const machineVerified = withStatus('verified').length === criteria.length;
  return {
    format: 'craftmine.p8-gameplay-verdict/1',
    caseId,
    criteria,
    machineVerified,
    failed: withStatus('failed'),
    insufficient: withStatus('insufficient'),
    reviewRequired: withStatus('review-required'),
    // A pass needs every criterion verified by machine AND nothing left to a
    // reviewer. A review-required item is never silently treated as a pass.
    verified: machineVerified && withStatus('review-required').length === 0,
    note: 'Verdicts come from live ordinary-command results, live observations and the authored source actually compiled into the checked candidate. They never come from the model\'s own claims, and review-required items are not passes.',
  };
}
