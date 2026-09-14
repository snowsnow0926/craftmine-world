import type {WorkerOptions} from "node:worker_threads";
import type {ArtifactWorkerBinding, ArtifactWorkerDescriptor, ArtifactWorkerRequest} from "./godot-artifact-worker-protocol.mjs";

export type ArtifactVerificationDescriptor = ArtifactWorkerDescriptor & Omit<ArtifactWorkerBinding, "attemptId">;
export interface ArtifactVerificationWorker {
  on(event: "message", listener: (message: unknown) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<unknown>;
  stdout?: {resume(): unknown} | null;
  stderr?: {resume(): unknown} | null;
}
export type ArtifactWorkerTimer = number | {unref?(): unknown};
export interface ArtifactWorkerTimers<Timer extends ArtifactWorkerTimer> {
  setTimeout(callback: () => void, delay: number): Timer;
  clearTimeout(timer: Timer): void;
  setInterval(callback: () => void, delay: number): Timer;
  clearInterval(timer: Timer): void;
}
export interface ArtifactVerificationOptions<Timer extends ArtifactWorkerTimer> {
  signal?: AbortSignal;
  WorkerClass?: new (filename: string, options: Omit<WorkerOptions, "workerData"> & {workerData: ArtifactWorkerRequest}) => ArtifactVerificationWorker;
  timers?: ArtifactWorkerTimers<Timer>;
  now?: () => number;
}
export interface ArtifactVerificationTask {
  /** Resolves only after a valid successful result and confirmed worker exit. */
  result: Promise<void>;
  /** Confirms closure independently of result success. */
  closed: Promise<void>;
  /** Appends bounded diagnostics to the existing log at most once. */
  report(log: string[]): void;
}
export function startArtifactVerification<Timer extends ArtifactWorkerTimer = ReturnType<typeof setTimeout>>(
  descriptor: ArtifactVerificationDescriptor,
  deadline: number,
  options?: ArtifactVerificationOptions<Timer>,
): ArtifactVerificationTask;
