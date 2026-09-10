import { awaitOwnedClose } from "./owned-resource-close";

type OwnedContents = {
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): unknown;
  close(): void;
};

/** Retains every owned renderer until actual destruction, including failed closes. */
export class OwnedViewClose {
  private readonly promises = new WeakMap<OwnedContents, Promise<void>>();
  private readonly closing = new Map<OwnedContents, { promise: Promise<void>; owner: object }>();
  private readonly failures = new Set<unknown>();
  constructor(private readonly label: string, private readonly timeoutMs = 3000) {}

  recordFailure(error: unknown): void { this.failures.add(error); }

  close(contents: OwnedContents, owner: object = contents): Promise<void> {
    const existing = this.promises.get(contents);
    if (existing) return existing;
    let finish!: () => void;
    let fail!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const boundary = awaitOwnedClose(completion, this.label, this.timeoutMs);
    this.promises.set(contents, boundary);
    this.closing.set(contents, { promise: boundary, owner });
    // Handling the rejection here preserves it for drain without an unhandled
    // rejection when eviction/automatic plugin reload owns no awaiting caller.
    void boundary.catch(error => this.recordFailure(error));
    const destroyed = () => { this.closing.delete(contents); finish(); };
    try {
      if (contents.isDestroyed()) destroyed();
      else {
        contents.once("destroyed", destroyed);
        contents.close();
      }
    } catch (error) {
      this.recordFailure(error);
      // Keep the listener and strong reference on failure. Timeout/throw is not
      // evidence that Chromium has stopped; late destruction still releases it.
      let gone = false;
      try { gone = contents.isDestroyed(); } catch { /* Preserve the original close error. */ }
      if (gone) destroyed(); else fail(error);
    }
    return boundary;
  }

  async drain(): Promise<void> {
    const results = await Promise.allSettled([...this.closing.values()].map(entry => entry.promise));
    for (const result of results) if (result.status === "rejected") this.recordFailure(result.reason);
    if (this.failures.size) throw new AggregateError([...this.failures], `${this.label}_CLOSE_INCOMPLETE`);
  }
}
