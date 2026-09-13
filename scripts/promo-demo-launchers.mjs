#!/usr/bin/env node
// Build manual launchers only from verified isolated desktop demo reports.
// This command never launches a visible window or changes the user's profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readRelease,verifySeal} from '../desktop/release-run.mjs';

const root=path.resolve(import.meta.dirname,'..');
const titles={mainline:'白色博美与巨兽试炼',rain:'雨的逆序',flight:'歼20自由飞行',city:'奥格瑞玛城市漫游'};
const controls={mainline:'B 返回树林，H 挑战巨怪；J 射击，K 瞄准，R 换弹，3 切换重刃。',rain:'Q 停雨／逆流，R 恢复降雨，F 完整施法；WASD 仍可行走。',flight:'回车开始／继续；W/S 油门，方向键俯仰，A/D 滚转，C 视角，G 起落架，F4 净画面。',city:'WASD 行走，方向键环顾，E 交谈，M 地图，V 俯瞰。'};
const inside=(parent,child)=>{const r=path.relative(parent,child);return r!==''&&!r.startsWith('..')&&!path.isAbsolute(r);};
const batchPath=p=>{if(/[\r\n"%]/.test(p))throw Error('UNSUPPORTED_LAUNCH_PATH');return p.replaceAll('/','\\');};
export async function main(args=process.argv.slice(2)){
  let releaseFile,output;const inputs=[];
  for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!value)throw Error('LAUNCHER_ARGUMENTS');
    if(key==='--release'&&!releaseFile)releaseFile=value;
    else if(key==='--output'&&!output)output=value;
    else if(key==='--scene')inputs.push(value);
    else throw Error('LAUNCHER_ARGUMENTS');
  }
  if(!releaseFile||!output||!path.isAbsolute(releaseFile)||!path.isAbsolute(output)||!inputs.length)throw Error('Usage: promo-demo-launchers.mjs --release ABS_RUN_JSON --output ABS_NEW_DIR --scene mainline=ABS_REPORT ...');
  const run=await readRelease(root,releaseFile);await verifySeal(run);
  const executable=path.join(run.output,'win-unpacked','Craftmine World.exe');
  const scenes={};
  for(const input of inputs){const split=input.indexOf('='),name=input.slice(0,split),reportPath=input.slice(split+1);
    if(!Object.hasOwn(titles,name)||scenes[name]||!path.isAbsolute(reportPath))throw Error('SCENE_ARGUMENT_INVALID');
    const report=JSON.parse(await fs.readFile(reportPath,'utf8'));
    if(path.resolve(report.package?.packaged??'')!==path.dirname(executable)||path.resolve(report.runtimeResources??'')!==path.join(path.dirname(executable),'resources'))throw Error('DEMO_PACKAGE_MISMATCH');
    if(report.format!=='craftmine.codex-desktop-native/1'||report.ok!==true||report.restore?.status!=='completed'||report.live!==false||report.prompts?.length||!report.demoLayout?.play||report.demoView?.overlay!=='closed'||report.demoView?.closed!==true)throw Error('VERIFIED_PLAY_DEMO_REQUIRED');
    const directory=await fs.realpath(report.out);
    if(!inside(path.join(root,'test-results'),directory)||!path.basename(directory).startsWith('desktop-native-codex-'))throw Error('ISOLATED_DEMO_REQUIRED');
    const profile=path.join(directory,'profile'),marker=JSON.parse(await fs.readFile(path.join(profile,'headless-profile.json'),'utf8'));
    if(marker.format!=='craftmine.headless-profile/1')throw Error('ISOLATED_DEMO_MARKER_REQUIRED');
    if(report.saved?.format!=='craftmine.godot-progress-receipt/1'||report.saved.worldId!==report.worldId||report.final?.worldId!==report.worldId||report.reopened?.buildId!==report.restored?.buildId)throw Error('DEMO_RECEIPT_MISMATCH');
    for(const launch of report.launches){if(!launch.audit||launch.audit.violations?.length||launch.audit.pageErrors?.length||launch.audit.shutdownFailures?.length)throw Error('DEMO_SHUTDOWN_AUDIT_FAILED');}
    scenes[name]={title:titles[name],worldId:report.worldId,buildId:report.final.buildId,profile,report:reportPath,controls:controls[name],launcher:path.join(output,'play-'+name+'.cmd')};
  }
  await fs.mkdir(output,{recursive:true});
  for(const [name,scene]of Object.entries(scenes)){
    const text=['@echo off','setlocal DisableDelayedExpansion',`set "CRAFTMINE_DATA_DIR=${batchPath(scene.profile)}"`,
      ...['CRAFTMINE_HEADLESS_TEST','CRAFTMINE_RUNTIME_RESOURCES','CRAFTMINE_CORE_BIN','PI_DESKTOP_HOST_BIN','CRAFTMINE_GODOT_BASES','ELECTRON_RUN_AS_NODE'].map(key=>`set "${key}="`),
      `start "" "${batchPath(executable)}"`,'endlocal',''].join('\r\n');
    await fs.writeFile(scene.launcher,text,{flag:'wx'});
  }
  const manifest={format:'craftmine.promo-demo-launchers/1',createdAt:new Date().toISOString(),release:releaseFile,commit:run.commit,executable,scenes,
    scope:'Manual user launch into separate already-restored desktop profiles. No visible launch was performed by this generator; no account credentials are included.'};
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  const guide=['# 宣传片可玩原型','',
    '双击对应的 CMD 文件打开已准备好的世界。每个入口使用独立演示存档；不用向你现有的档案恢复备份。',
    'F2 打开 AI 对话。演示档案已选择本地 Codex CLI（gpt-6-astra / xhigh），复用本机 Codex 登录。','',
    ...Object.entries(scenes).map(([name,s])=>`- **${s.title}**：\`play-${name}.cmd\`。${s.controls}`),'',
    '当前是可玩原型和实机素材准备，尚未剪辑为宣传片。参考图辅助 Blender 脚本建模，运行画面来自实际 Godot 世界。',''];
  await fs.writeFile(path.join(output,'README.md'),guide.join('\n'),{flag:'wx'});
  console.log(JSON.stringify({output,scenes:Object.keys(scenes),executable}));return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
