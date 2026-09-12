/** A retained world must never silently enter or create a different slot. */
export function retainedEntryAction(state, worldId) {
  if (!state.entry) return 'already-open';
  if (!state.cards.length) return 'legacy-ui';
  if (state.cards.some(card => card.worldId === worldId && !card.disabled)) return 'matching-card';
  if (state.cards.some(card => card.state === 'loading')) return 'wait';
  return state.canReturn ? 'return-current' : 'advanced-saves';
}

/** Invokes only visible React controls; never sends native or browser input. */
export async function enterRetainedPlayerWorld(page, worldId, until) {
  const read = () => page.evaluate(() => ({
    entry: !!document.querySelector('[data-mode-entry]'),
    cards: [...document.querySelectorAll('[data-player-world]')].map(node => ({kind:node.dataset.playerWorld,worldId:node.dataset.worldId,state:node.dataset.worldState,disabled:node.disabled})),
    canReturn: !!document.querySelector('.craftmine-mode-back'),
    error: document.querySelector('[data-player-world-error]')?.textContent ?? null,
  }));
  const click = selector => page.evaluate(selector => {
    const node = [...document.querySelectorAll(selector)].find(el => el.getClientRects().length && !el.closest('[hidden],[inert],[aria-hidden="true"]'));
    if (!node || node.disabled) throw Error('PLAYER_ENTRY_CONTROL_UNAVAILABLE:'+selector);
    const props = node[Object.keys(node).find(key => key.startsWith('__reactProps$'))];
    if (typeof props?.onClick !== 'function') throw Error('PLAYER_ENTRY_CALLBACK_MISSING');
    props.onClick();
  },selector);
  const state = await until(read, value => {if(value.error)throw Error(value.error);return retainedEntryAction(value,worldId)!=='wait';});
  const action = retainedEntryAction(state,worldId);
  if (action === 'matching-card') await click('[data-player-world][data-world-id="'+worldId+'"]');
  else if (action === 'return-current') await click('.craftmine-mode-back');
  else if (action === 'advanced-saves') {
    await click('.craftmine-mode-manage');
    await until(() => page.evaluate(() => !!document.querySelector('[data-advanced-world-saves]')),Boolean);
    // Opening native details changes presentation only, like its summary toggle.
    await page.evaluate(() => {document.querySelector('[data-advanced-world-saves]').open=true;});
    const selector='[data-advanced-world-saves] .craftmine-world-item[data-world-id="'+worldId+'"]';
    await until(() => page.evaluate(selector => {const row=document.querySelector(selector);return !!row && row.dataset.worldPlayable==='true' && !row.disabled;},selector),Boolean);
    await click(selector);
    await until(() => page.evaluate(selector => document.querySelector(selector)?.dataset.worldActive==='true',selector),Boolean);
    if ((await read()).entry) throw Error('PLAYER_ENTRY_NOT_CLOSED');
    // A previously inactive legacy row first selects, then opens its existing world.
    const layout=await page.evaluate(()=>JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')??'null'));
    if(layout?.mode!=='play')await click(selector);
  } else if (action === 'legacy-ui') {
    await click('[data-mode-entry] [data-mode="play"]');
    if(await page.evaluate(()=>!!document.querySelector('.craftmine-mode-enter-world')))await click('.craftmine-mode-enter-world');
  }
  await until(read,value=>{if(value.error)throw Error(value.error);return !value.entry;});
  return {action,expectedWorldId:worldId,initial:state};
}
