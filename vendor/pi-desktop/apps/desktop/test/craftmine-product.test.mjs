import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { craftminePaths } from "../electron/main/craftmine-product.ts";

test("the product ignores an inherited PI profile and isolates explicit Craftmine profiles", () => {
  const base=path.resolve("test-profile-base");
  const paths=craftminePaths({PI_DESKTOP_DATA_DIR:path.join(base,"personal-pi"),LOCALAPPDATA:base},base);
  assert.equal(paths.dataDir,path.join(base,"CraftmineWorld"));
  const alternate=craftminePaths({CRAFTMINE_DATA_DIR:path.join(base,"isolated")},base);
  assert.notEqual(alternate.dataDir,paths.dataDir);
  assert.notEqual(alternate.userData,paths.userData);
  assert.equal(alternate.userData,path.join(base,"isolated","desktop"));
  assert.throws(()=>craftminePaths({CRAFTMINE_DATA_DIR:"relative/profile"},base),/must be absolute/);
});
