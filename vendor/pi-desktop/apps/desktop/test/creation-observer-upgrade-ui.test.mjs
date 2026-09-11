import Module from 'node:module';import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const component=fileURLToPath(new URL('../src/components/CreationTargetContext.tsx',import.meta.url));
const bundle=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {CreationTargetContext} from ${JSON.stringify(component)};export const render=controller=>renderToStaticMarkup(React.createElement(CreationTargetContext,{controller}));`,resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',plugins:[{name:'isolated-renderer-fixture',setup(b){b.onResolve({filter:/^(react-i18next)$|craftmine-worlds$/},args=>({path:args.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='react-i18next'?`export const useTranslation=()=>({i18n:{language:'zh-CN'}});`:`export const craftmineWorldBridge=()=>null;`,loader:'js'}));}}]});
const compiled=new Module(component);compiled.filename=component;compiled.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));compiled._compile(bundle.outputFiles[0].text,component);const {render}=compiled.exports;
test('normal target panel offers explicit maintenance while showing no bound object',()=>{
 const capture={worldId:'world-a',captureId:null,target:null,upgradeId:'upgrade-a',reason:'SCENE_OBJECT_OBSERVER_UPGRADE_REQUIRED'};
 const html=render({sessionId:'session-a',capture,available:true,loading:false});
 assert.match(html,/当前指向尚未绑定/);assert.match(html,/仍可继续文字聊天/);assert.match(html,/<button type="button">更新世界观察组件并检查<\/button>/);
 assert.doesNotMatch(render({sessionId:'session-a',capture:{...capture,upgradeId:undefined},available:true,loading:false}),/更新世界观察组件并检查/);
});
