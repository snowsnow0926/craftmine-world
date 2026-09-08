// Trusted product glue. Authored gameplay never runs in this Node process.
const {CoreClient} = require('./core-client.cjs');
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

async function onUnload() { await core?.stop();await pi.agent.unregisterTool('runtime_info'); }
module.exports = {onLoad, onUnload};
