/** Limit UI snapshot work before flattening and IPC serialization. This is a
 * refresh cadence, not a limit on provider tokens or the duration of a turn. */
export class LatestPartialPublisher<T> {
  private pending?: T;
  private timer?: ReturnType<typeof setTimeout>;
  private nextAt = 0;
  private closed = false;

  constructor(private readonly publish: (value: T) => void, private readonly intervalMs = 100) {}

  enqueue(value: T): void {
    if (this.closed) return;
    if (!this.timer && Date.now() >= this.nextAt) {
      this.deliver(value);
      return;
    }
    this.pending = value;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), Math.max(0, this.nextAt - Date.now()));
  }

  private deliver(value: T): void {
    this.nextAt = Date.now() + this.intervalMs;
    this.publish(value);
  }

  /** Control/terminal events cannot overtake the latest visible partial. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const value = this.pending;
    this.pending = undefined;
    if (value !== undefined) this.deliver(value);
  }

  reset(): void {
    this.flush();
    this.nextAt = 0;
  }

  close(): void {
    this.flush();
    this.closed = true;
  }
}
