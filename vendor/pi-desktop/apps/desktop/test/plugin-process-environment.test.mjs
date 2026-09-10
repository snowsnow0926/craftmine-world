import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { pluginProcessEnv } = await import("../electron/main/plugin-runtime.ts");

test("the native Craftmine utility process receives its core path without host credentials", () => {
  const source = { PATH: "fixture-path", CRAFTMINE_CORE_BIN: "D:/test/core.exe", PROVIDER_API_KEY: "fixture-secret", CRAFTMINE_HEADLESS_TOKEN: "fixture-token" };
  assert.deepEqual(pluginProcessEnv("craftmine.world", source), {
    PI_PLUGIN_ID: "craftmine.world", NODE_ENV: "production", PATH: "fixture-path", CRAFTMINE_CORE_BIN: "D:/test/core.exe",
  });
  assert.deepEqual(pluginProcessEnv("another.plugin", source), {
    PI_PLUGIN_ID: "another.plugin", NODE_ENV: "production", PATH: "fixture-path",
  });
});

test("only a validated headless P8 phase passes a policy bit to the built-in broker", () => {
  const source = {CRAFTMINE_HEADLESS_TEST: "1", CRAFTMINE_P8_NATIVE: "1", CRAFTMINE_P8_AUTHORIZATION_PHASE: "parallel-20260910", CRAFTMINE_P8_PROXY_AUTH: "private-relay", PROVIDER_API_KEY: "private-key"};
  assert.deepEqual(pluginProcessEnv("craftmine.world", source), {PI_PLUGIN_ID: "craftmine.world", NODE_ENV: "production", CRAFTMINE_P8_UNLIMITED_REQUESTS: "1"});
  for (const phase of [undefined, "initial-16", "unknown"]) assert.equal(pluginProcessEnv("craftmine.world", {...source, CRAFTMINE_P8_AUTHORIZATION_PHASE: phase}).CRAFTMINE_P8_UNLIMITED_REQUESTS, undefined);
  assert.equal(pluginProcessEnv("other.plugin", source).CRAFTMINE_P8_UNLIMITED_REQUESTS, undefined);
  assert.equal(pluginProcessEnv("craftmine.world", {CRAFTMINE_P8_UNLIMITED_REQUESTS: "1"}).CRAFTMINE_P8_UNLIMITED_REQUESTS, undefined);
});
