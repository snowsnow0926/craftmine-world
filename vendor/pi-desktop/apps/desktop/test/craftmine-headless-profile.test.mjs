import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { readHeadlessProfile } from "../electron/main/craftmine-headless-profile.ts";

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
