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
