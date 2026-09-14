/** Type contract for the existing bounded worker validator; no runtime shim. */
export const ARTIFACT_WORKER_FORMAT: "craftmine.artifact-worker/1";
export type ArtifactWorkerError = "INVALID_GODOT_CHECK_DESCRIPTOR" | "GODOT_CHECK_ARTIFACT_MISSING"
  | "GODOT_CHECK_ARTIFACT_MISMATCH" | "GODOT_CHECK_ARTIFACT_IO_ERROR" | "GODOT_CHECK_TIMEOUT" | "GODOT_CHECK_CANCELLED";
export const ARTIFACT_WORKER_ERRORS: ReadonlySet<string>;

export interface ArtifactWorkerBinding {
  attemptId: string;
  jobId: string;
  buildId: string;
  inputHash: string;
  worldId: string;
}
export interface ArtifactWorkerDescriptor {
  root: string;
  artifacts: Array<{path: string; bytes: number; sha256: string}>;
}
export interface ArtifactWorkerRequest {
  format: typeof ARTIFACT_WORKER_FORMAT;
  binding: ArtifactWorkerBinding;
  descriptor: ArtifactWorkerDescriptor;
  deadline: number;
}
export type ArtifactWorkerOperation = "root-lstat" | "entry-lstat" | "path-lstat" | "size-lstat"
  | "size-compare" | "stream-open" | "stream-read" | "hash-update" | "hash-digest" | "hash-compare";
export interface ArtifactWorkerResources {
  available: boolean;
  counts: Record<string, number>;
  omittedTypes: number;
}
export interface ArtifactWorkerSnapshot<State extends "running" | "completed" | "failed" = "running" | "completed" | "failed"> {
  progress: {
    operation: ArtifactWorkerOperation;
    path: string | null;
    artifactPath: string | null;
    artifactIndex: number;
    totalFiles: number;
    expectedBytes: number | null;
    bytesRead: number;
    totalBytesRead: number;
    verifiedFiles: number;
    elapsedMs: number;
    operationElapsedMs: number;
    lastByteProgressAgoMs: number;
  };
  runtime: {
    diagnosticOnly: true;
    state: State;
    elapsedMs: number;
    heartbeat: {periodMs: 100; samples: number; maxLagMs: number};
    resources: {start: ArtifactWorkerResources | null; end: ArtifactWorkerResources | null};
  };
}
/** Progress and successful results do not validate an optional error value.
 * Only a failed result narrows it to the allowed worker error codes. */
export type ArtifactWorkerMessage =
  | {kind: "progress"; ok: unknown; error: unknown; snapshot: ArtifactWorkerSnapshot}
  | {kind: "result"; ok: true; error: unknown; snapshot: ArtifactWorkerSnapshot<"completed">}
  | {kind: "result"; ok: false; error: ArtifactWorkerError; snapshot: ArtifactWorkerSnapshot<"failed">};

export function artifactWorkerRequest(input: unknown): ArtifactWorkerRequest;
export function artifactWorkerMessage(message: unknown, request: ArtifactWorkerRequest): ArtifactWorkerMessage;
