// Types for desktop/godot/web/runtime.mjs, imported by the Electron main
// process (electron/main/godot-world-view-host.ts) and by acceptance tests.

export declare const RUNTIME_PROTOCOL: 'craftmine.godot-runtime/2';
/** Vertical space the creation panel reserves above the game surface. */
export declare const WORLD_CHROME_HEIGHT: 76;
export declare const RUNTIME_OPS: readonly string[];

export type RuntimeIdentity = {
  protocol: typeof RUNTIME_PROTOCOL;
  worldId: string;
  buildId: string;
  instanceId: string;
};

export type RuntimeState = 'loading' | 'ready' | 'error' | 'exited' | 'disposed';

export type RuntimeRequestResult = {
  id: number;
  result?: Record<string, unknown>;
  error?: string;
  identity?: {worldId: string; buildId: string; instanceId: string};
};

export type RuntimeEvent =
  | {type: 'ready'; ops: string[]}
  | {type: 'runtime-error'; error: string}
  | {type: 'event'; name: string; detail: unknown}
  | {type: 'exited'; exitCode: number | null};

export type RuntimeRequestRecord = {
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
};

export type WorldRuntime = RuntimeIdentity & {
  readonly url: string;
  readonly origin: string;
  readonly entry: string;
  readonly root: string;
  readonly threads: boolean;
  readonly state: RuntimeState;
  readonly requests: RuntimeRequestRecord[];
  waitReady(): Promise<RuntimeIdentity & {ops: string[]}>;
  attach(transport: (message: unknown) => void): () => void;
  receive(message: unknown): void;
  onEvent(listener: (event: RuntimeEvent) => void): () => void;
  request(op: string, args?: Record<string, unknown>, options?: {timeoutMs?: number}): Promise<RuntimeRequestResult>;
  load(args?: Record<string, unknown>): Promise<RuntimeRequestResult>;
  snapshot(args?: Record<string, unknown>): Promise<RuntimeRequestResult>;
  save(args?: Record<string, unknown>): Promise<RuntimeRequestResult>;
  pause(args?: Record<string, unknown>): Promise<RuntimeRequestResult>;
  resume(args?: Record<string, unknown>): Promise<RuntimeRequestResult>;
  cancel(id: number): Promise<RuntimeRequestResult>;
  acknowledge(args?: Record<string, unknown>): Promise<RuntimeRequestResult>;
  exit(options?: {timeoutMs?: number}): Promise<{exitCode: number | null; alreadyStopped?: boolean; error?: string}>;
  dispose(options?: {graceful?: boolean}): Promise<void>;
  evidence(): Record<string, unknown>;
};

export type WorldRuntimeOptions = {
  worldId: string;
  buildId: string;
  root: string;
  entry?: string;
  threads?: boolean;
  timeoutMs?: number;
  token?: string;
  instanceId?: string;
};

export declare function createWorldRuntime(options: WorldRuntimeOptions): Promise<WorldRuntime>;
export declare function isolationHeaders(options?: {threads?: boolean}): Record<string, string>;
export declare function hashBuildDirectory(root: string): Promise<string>;
