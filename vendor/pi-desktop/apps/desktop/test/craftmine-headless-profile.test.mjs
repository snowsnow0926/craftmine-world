import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { readHeadlessProfile, usesNormalAcceptanceRendering, assertAcceptanceWindow } from "../electron/main/craftmine-headless-profile.ts";

const results = resolve("../../../../test-results");
mkdirSync(results, { recursive: true });

function fixture() {
  const root = mkdtempSync(join(results, "desktop-native-profile-"));
  const profile = join(root, "profile"), legacySource = join(root, "legacy");
  mkdirSync(profile); mkdirSync(legacySource);
  const token = randomUUID();
  writeFileSync(join(profile, "headless-profile.json"), JSON.stringify({
    format: "craftmine.headless-profile/1", token, legacySource,
  }));
  return { root, profile, legacySource, env: {
    CRAFTMINE_HEADLESS_TEST: "1", CRAFTMINE_HEADLESS_ROOT: root,
    CRAFTMINE_DATA_DIR: profile, CRAFTMINE_HEADLESS_TOKEN: token,
  } };
}

test("normal application mode does not read a test profile", () => {
  assert.equal(readHeadlessProfile({}), null);
});

test("only the marked, isolated profile is accepted", () => {
  const { env, root, profile, legacySource } = fixture();
  assert.deepEqual(readHeadlessProfile(env), { root, profile, legacySource });
  assert.throws(() => readHeadlessProfile({ ...env, CRAFTMINE_HEADLESS_TOKEN: "another-run" }), /marker/);
  assert.throws(() => readHeadlessProfile({ ...env, CRAFTMINE_DATA_DIR: root }), /dedicated/);
  assert.throws(() => readHeadlessProfile({ ...env, CRAFTMINE_DATA_DIR: "profile" }), /absolute/);
  assert.throws(() => readHeadlessProfile({ CRAFTMINE_HEADLESS_TEST: "1" }), /absolute/);
});

test("profiles and import fixtures cannot escape their run directory", () => {
  const first = fixture(), second = fixture();
  assert.throws(() => readHeadlessProfile({ ...first.env, CRAFTMINE_DATA_DIR: second.profile }), /dedicated/);
  writeFileSync(join(first.profile, "headless-profile.json"), JSON.stringify({
    format: "craftmine.headless-profile/1", token: first.env.CRAFTMINE_HEADLESS_TOKEN,
    legacySource: second.legacySource,
  }));
  assert.throws(() => readHeadlessProfile(first.env), /same isolated/);
});

test("a directory junction cannot disguise an external profile", () => {
  const first = fixture(), second = fixture();
  const alias = join(first.root, "aliased-profile");
  symlinkSync(second.profile, alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => readHeadlessProfile({ ...first.env, CRAFTMINE_DATA_DIR: alias }), /dedicated/);
});

test("normal rendering is opt-in within the same token and isolated-profile boundary", () => {
  const f=fixture();
  const marker={format:'craftmine.headless-profile/1',token:f.env.CRAFTMINE_HEADLESS_TOKEN,legacySource:f.legacySource,rendering:'normal'};
  writeFileSync(join(f.profile,'headless-profile.json'),JSON.stringify(marker));
  const profile=readHeadlessProfile(f.env);assert.equal(profile.rendering,'normal');
  assert.equal(usesNormalAcceptanceRendering(profile,true),true);
  assert.equal(usesNormalAcceptanceRendering(profile,false),false);
  assert.equal(usesNormalAcceptanceRendering(null,true),false);
  assert.throws(()=>readHeadlessProfile({...f.env,CRAFTMINE_HEADLESS_TOKEN:'wrong-token'}),/marker/);
  for(const rendering of ['visible',true,null]) {
    writeFileSync(join(f.profile,'headless-profile.json'),JSON.stringify({...marker,rendering}));
    assert.throws(()=>readHeadlessProfile(f.env),/rendering/);
  }
});

test("both renderers retain hidden/unfocusable guards and verifier offscreen rendering remains permitted", () => {
  const normal={root:'fixture',profile:'fixture',legacySource:'fixture',rendering:'normal'};
  const hidden={visible:false,focusable:false,offscreen:false};
  assert.doesNotThrow(()=>assertAcceptanceWindow(normal,true,hidden));
  assert.doesNotThrow(()=>assertAcceptanceWindow(normal,true,{...hidden,offscreen:true}));
  assert.throws(()=>assertAcceptanceWindow(normal,false,hidden),/authorized rendering/);
  assert.throws(()=>assertAcceptanceWindow({...normal,rendering:'offscreen'},true,hidden),/authorized rendering/);
  for(const offscreen of [true,false]) {
    assert.throws(()=>assertAcceptanceWindow(normal,true,{...hidden,offscreen,visible:true}),/hidden/);
    assert.throws(()=>assertAcceptanceWindow(normal,true,{...hidden,offscreen,focusable:true}),/unfocusable/);
  }
});
