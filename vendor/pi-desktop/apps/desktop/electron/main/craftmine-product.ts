import { isAbsolute, join, resolve } from "node:path";

/** Product profile boundaries are independent of an installed upstream PI. */
export function craftminePaths(env: NodeJS.ProcessEnv, appData: string) {
  const explicit = env.CRAFTMINE_DATA_DIR?.trim();
  if (explicit && !isAbsolute(explicit)) throw new Error("CRAFTMINE_DATA_DIR must be absolute");
  const dataDir = explicit ? resolve(explicit) : join(env.LOCALAPPDATA || appData, "CraftmineWorld");
  return { dataDir, userData: join(dataDir, "desktop") };
}
