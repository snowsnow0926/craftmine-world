/** Host-owned scope. A panel selection or a model argument cannot rebind a turn. */
export type CraftmineTurnBinding = Readonly<{
  sessionId: string;
  turnId: string;
  projectId: string;
  selectedWorld: string;
}>;

export const CRAFTMINE_PROXY_METHODS = new Set([
  "craftmine.context", "craftmine.budget.reserve", "craftmine.budget.settle",
  "craftmine.budget.boundary",
]);

function denied(code: string): Error {
  return Object.assign(new Error(code), { code: -32000, data: { errorCode: code } });
}

function identity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 &&
    value.trim() === value && !/[\x00-\x1f]/.test(value);
}

export class CraftmineTurnGateway {
  private bindings = new Map<string, CraftmineTurnBinding>();
  private ended = new Map<string, string>();
  private reservations = new Map<string, CraftmineTurnBinding>();

  constructor(private readonly activeTurn: (sessionId: string) => string | undefined,
    private readonly allowedTools: () => ReadonlySet<string>,
    private readonly request: (method: string, params: Record<string, unknown>, binding: CraftmineTurnBinding) => Promise<unknown>,
    private readonly readOnlyTurn: (sessionId: string, turnId: string) => boolean = () => false) {}

  bind(binding: CraftmineTurnBinding): void {
    if (!Object.values(binding).every(identity) || this.activeTurn(binding.sessionId) !== binding.turnId) {
      throw denied("CRAFTMINE_ACTIVE_TURN_REQUIRED");
    }
    const old = this.bindings.get(binding.sessionId);
    if (old && old.turnId === binding.turnId && JSON.stringify(old) !== JSON.stringify(binding)) {
      throw denied("CRAFTMINE_TURN_REBIND_REFUSED");
    }
    this.bindings.set(binding.sessionId, Object.freeze({ ...binding }));
    this.ended.delete(binding.sessionId);
  }

  get(sessionId: string): CraftmineTurnBinding | undefined {
    return this.bindings.get(sessionId);
  }

  /** Only after all turns and their final accounting have drained. */
  resetForProfileRestore(): void {
    if ([...this.bindings.keys()].some(id => this.activeTurn(id))) throw denied("ACTIVE_TASK_EXISTS");
    this.bindings.clear(); this.ended.clear(); this.reservations.clear();
  }

  end(sessionId: string, turnId: string): void {
    // A delayed completion from the preceding turn cannot clear its successor.
    if (this.bindings.get(sessionId)?.turnId === turnId) this.ended.set(sessionId, turnId);
  }

  beginGeneric(sessionId: string, turnId: string): void {
    if (this.activeTurn(sessionId) !== turnId || this.bindings.get(sessionId)?.turnId === turnId) {
      throw denied("CRAFTMINE_TURN_REBIND_REFUSED");
    }
    this.bindings.delete(sessionId);
    this.ended.delete(sessionId);
  }

  assertTool(params: Record<string, unknown>): void {
    const binding = this.bindings.get(String(params.sessionId ?? ""));
    if (!binding) return;
    if (this.readOnlyTurn(binding.sessionId, String(params.turnId ?? ""))) throw denied("CRAFTMINE_MAINTENANCE_SCOPE_DENIED");
    if (params.turnId !== binding.turnId || this.ended.get(binding.sessionId) === binding.turnId || this.activeTurn(binding.sessionId) !== binding.turnId) {
      throw denied("CRAFTMINE_ACTIVE_TURN_REQUIRED");
    }
    if (!this.allowedTools().has(String(params.toolName ?? ""))) {
      throw denied("CRAFTMINE_TOOL_SCOPE_DENIED");
    }
  }

  async invoke(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!CRAFTMINE_PROXY_METHODS.has(method)) throw denied("CRAFTMINE_METHOD_DENIED");
    const settlement = method === "craftmine.budget.settle";
    const reservationKey = JSON.stringify([params.sessionId, params.turnId, params.requestId]);
    const binding = settlement ? this.reservations.get(reservationKey) : this.bindings.get(String(params.sessionId ?? ""));
    if (!binding || params.turnId !== binding.turnId || (!settlement && (this.ended.get(binding.sessionId) === binding.turnId || this.activeTurn(binding.sessionId) !== binding.turnId))) {
      throw denied("CRAFTMINE_ACTIVE_TURN_REQUIRED");
    }
    const forbidden = ["context", "projectId", "worldId", "selectedWorld"];
    if (method === "craftmine.context") forbidden.push("binding", "generation");
    for (const key of forbidden) {
      if (Object.hasOwn(params, key)) throw denied("CRAFTMINE_FORGED_IDENTITY");
    }
    if (method === "craftmine.budget.reserve") {
      if (!identity(params.requestId)) throw denied("CRAFTMINE_REQUEST_ID_REQUIRED");
      this.reservations.set(reservationKey, binding);
    }
    const result = await this.request(method, params, binding);
    if (!settlement && (this.bindings.get(binding.sessionId) !== binding || this.ended.get(binding.sessionId) === binding.turnId || this.activeTurn(binding.sessionId) !== binding.turnId)) {
      throw denied("CRAFTMINE_STALE_REPLY");
    }
    return result;
  }
}
