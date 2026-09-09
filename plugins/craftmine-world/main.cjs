// Trusted product glue. Authored gameplay never runs in this Node process.
const {CoreClient} = require('./core-client.cjs');
const {randomUUID} = require('node:crypto');
const {emptyWorld, validateSnapshot} = require('./domain.cjs');
let core;
async function onLoad() {
  core = new CoreClient(process.env.CRAFTMINE_CORE_BIN, await pi.plugin.getDataPath());
  pi.services.register({id:'world-core',start:()=>core.start(),stop:()=>core.stop()});
  await pi.agent.registerTool({
    name: 'runtime_info',
    description: 'Inspect the connected Craftmine runtime and available integration capabilities.',
    risk: 'low', schema: {type:'object',properties:{},additionalProperties:false},
    execute: async (_args, context) => ({
      format: 'craftmine.desktop-runtime/1',
      view: 'world',
      worldWritesAvailable: false,
      core: await core.start(),
      invocation: {sessionId:context?.sessionId,turnId:context?.turnId,toolCallId:context?.toolCallId},
    }),
  });
}

async function onPanelInvoke(channel, payload={}) {
  await core.start();
  if(channel==='world.list') {
    return {worlds:await core.call('world.list'),activeWorldId:(await pi.plugin.getSettings()).activeWorldId};
  }
  if(channel==='world.create') {
    const title=String(payload.title??'').trim();
    const record=await core.call('world.create',{id:randomUUID(),title,world:emptyWorld(title)});
    await pi.plugin.setSettings({activeWorldId:record.id});
    return record;
  }
  if(channel==='world.open') {
    const record=await core.call('world.read',{id:payload.id});
    await pi.plugin.setSettings({activeWorldId:record.id});
    return record;
  }
  if(channel==='world.saveProgress') {
    return core.call('world.saveProgress',{id:payload.id,revision:payload.revision,baseBuild:payload.baseBuild,snapshot:validateSnapshot(payload.snapshot)});
  }
  throw Error('Unsupported Craftmine panel operation');
}

async function onUnload() { await core?.stop();await pi.agent.unregisterTool('runtime_info'); }
module.exports = {onLoad, onUnload, onPanelInvoke};
