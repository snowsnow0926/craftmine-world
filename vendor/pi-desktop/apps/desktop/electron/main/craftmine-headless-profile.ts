import { readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export function readHeadlessProfile(env: Record<string, string | undefined>): { root: string; profile: string; legacySource: string } | null {
  if (env.CRAFTMINE_HEADLESS_TEST !== "1") return null;
  const root = env.CRAFTMINE_HEADLESS_ROOT, profile = env.CRAFTMINE_DATA_DIR;
  if (!root || !profile || !isAbsolute(root) || !isAbsolute(profile)) throw new Error("Headless acceptance requires absolute isolated paths");
  const inside = (parent: string, child: string) => {
    const part = relative(realpathSync(parent), realpathSync(child));
    return !!part && !isAbsolute(part) && part !== ".." && !part.startsWith("..\\") && !part.startsWith("../");
  };
  if (!basename(root).startsWith("desktop-native-") || basename(resolve(root, "..")) !== "test-results" || !inside(root, profile)) {
    throw new Error("Headless profile must be inside its dedicated test-results/desktop-native-* directory");
  }
  const marker = JSON.parse(readFileSync(join(profile, "headless-profile.json"), "utf8"));
  if (marker.format !== "craftmine.headless-profile/1" || !env.CRAFTMINE_HEADLESS_TOKEN || marker.token !== env.CRAFTMINE_HEADLESS_TOKEN) {
    throw new Error("Headless profile marker does not match this test run");
  }
  if (typeof marker.legacySource !== "string" || !isAbsolute(marker.legacySource) || !inside(root, marker.legacySource)) {
    throw new Error("Headless import fixture must belong to the same isolated test directory");
  }
  return { root: realpathSync(root), profile: realpathSync(profile), legacySource: realpathSync(marker.legacySource) };
}
