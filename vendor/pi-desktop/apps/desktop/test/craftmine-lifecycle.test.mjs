import assert from "node:assert/strict";
import test from "node:test";
import { prepareWorldViewsForQuit } from "../electron/main/craftmine-lifecycle.ts";

test("quit preparation waits for the world checkpoint and ignores unrelated plugins", async () => {
  let complete,finished=false;
  const pending=prepareWorldViewsForQuit([
    {pluginId:"other.plugin",prepare:()=>{throw Error("must not run");},cancel:async()=>{}},
    {pluginId:"craftmine.world",prepare:()=>new Promise(resolve=>{complete=resolve;}),cancel:async()=>{throw Error("must not cancel");}},
  ]).then(()=>{finished=true;});
  await Promise.resolve();assert.equal(finished,false);
  complete({loaded:true,worldId:"first",revision:2,buildId:"build-first"});await pending;assert.equal(finished,true);
});

test("failed, missing and timed-out checkpoints cannot allow shutdown", async () => {
  let resumes=0;
  const view=prepare=>({pluginId:"craftmine.world",prepare,cancel:async()=>{resumes++;}});
  await assert.rejects(prepareWorldViewsForQuit([view(async()=>{throw Error("disk full");})]),/disk full/);
  await assert.rejects(prepareWorldViewsForQuit([view(async()=>({loaded:true}))]),/saved revision/);
  await assert.rejects(prepareWorldViewsForQuit([view(()=>new Promise(()=>{}))],5),/timed out/);
  assert.equal(resumes,3);
  await prepareWorldViewsForQuit([view(async()=>({loaded:false}))]);
  await prepareWorldViewsForQuit([]);
});
