// Trusted product glue. Authored gameplay never runs in this Node process.
const {CoreClient} = require('./core-client.cjs');
const {randomUUID} = require('node:crypto');
const {emptyWorld, validateSnapshot, prepareLegacyWorld} = require('./domain.cjs');
let core;
const importErrors={
  LEGACY_PROJECT_NOT_FOUND:'所选文件夹里没有旧世界，请选择原项目目录或其中的 .craftmine 文件夹。',
  LEGACY_PROJECT_FORMAT:'所选文件夹的存档格式不兼容，原文件未更改。',
  LEGACY_SOURCE_CHANGED_RETRY:'旧世界仍在更新，未完成导入。请先暂停旧版创作，再重试。',
  LEGACY_ARCHIVE_TOO_LARGE:'旧项目超过 256 MB 的导入上限，原文件未更改。',
  LEGACY_FILE_TOO_LARGE:'旧项目包含超过 64 MB 的单个文件，原文件未更改。',
  LEGACY_TOO_MANY_ENTRIES:'旧项目超过 10,000 个文件及文件夹的导入上限，原文件未更改。',
  LEGACY_LINK_REFUSED:'旧项目包含链接，暂不支持导入。请选择实际存档目录。',
  LEGACY_REPARSE_POINT_REFUSED:'旧项目包含链接目录，暂不支持导入。请选择实际存档目录。',
  CORRUPT_LEGACY_FILE:'旧世界备份的文件校验失败，未导入。原项目仍然保留。',
  CORRUPT_LEGACY_ARCHIVE:'旧世界备份的完整性校验失败，未导入。原项目仍然保留。',
};
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
  if(channel==='world.importLegacy') {
    // Electron replaces this payload with the native picker's granted root.
    // The untrusted page cannot supply or override the filesystem source.
    const deadline=Date.now()+90000;
    const call=(method,params)=>{
      const remaining=deadline-Date.now();
      if(remaining<=0)throw Error('旧世界导入超时，已保留原始文件');
      return core.call(method,params,Math.min(remaining,60000)).catch(error=>{throw Error(importErrors[error.message]||error.message);});
    };
    const archive=await call('legacy.capture',{id:randomUUID(),source:payload.source});
    const world=await prepareLegacyWorld(archive.project,async path=>JSON.parse(await call('legacy.readText',{id:archive.id,path})));
    const record=await call('legacy.commit',{id:archive.id,title:world.build.scene.title,world});
    await pi.plugin.setSettings({activeWorldId:record.id});
    return {record,archive:{id:archive.id,files:archive.files,bytes:archive.bytes,manifestHash:archive.manifestHash},preserved:{candidate:!!archive.project.candidate,modules:archive.project.library?.length||0,tasks:archive.project.tasks?.length||0}};
  }
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
