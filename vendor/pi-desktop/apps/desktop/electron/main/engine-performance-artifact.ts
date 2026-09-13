import {readFileSync, realpathSync} from 'node:fs';
import {resolve, sep, toNamespacedPath} from 'node:path';

/** Resolve only a Core-authorized external PCK; namespace syntax is not a link. */
export function readEnginePerformanceArtifact(descriptor: {root: unknown}, artifact: {path: string}, allowedRoots: string[]): Buffer {
  const root=resolve(String(descriptor.root));
  if(!allowedRoots.some(candidate=>resolve(candidate)===root))throw Error('ENGINE_PERFORMANCE_ROOT_UNAUTHORIZED');
  if(!artifact.path.startsWith('web/')||artifact.path.includes('..')||/[\\:\x00-\x1f\x7f]/.test(artifact.path))throw Error('ENGINE_PERFORMANCE_ARTIFACT_PATH');
  const file=resolve(root,artifact.path);
  if(!file.startsWith(root+sep))throw Error('ENGINE_PERFORMANCE_ARTIFACT_ESCAPE');
  // Core may return a Windows extended-length path. Electron's ASAR wrapper
  // mishandles that external-file syntax; native resolution removes its prefix.
  // Compare both in the same namespace while retaining exact link rejection.
  if(toNamespacedPath(realpathSync.native(file))!==toNamespacedPath(file))throw Error('ENGINE_PERFORMANCE_ARTIFACT_LINK');
  return readFileSync(file);
}
