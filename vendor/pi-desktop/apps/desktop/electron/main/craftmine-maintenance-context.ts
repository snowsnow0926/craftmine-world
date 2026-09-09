import type { CraftmineTurnBinding } from "./craftmine-turn-gateway";

type Context = { projectId: string; sessionId: string; turnId: string };
type DomainCall = (method: string, input: Record<string, any>) => Promise<any>;

/** A PI maintenance turn can summarize a finished domain turn, never replace it.
 * Retained mappings permit only exact-owner late accounting after PI ends. */
export class CraftmineMaintenanceContexts {
  private contexts = new Map<string, Readonly<Context>>();
  private key(sessionId: string, turnId: string) { return JSON.stringify([sessionId, turnId]); }

  bind(host: CraftmineTurnBinding, snapshot: any): void {
    if (snapshot?.status !== "finished" || snapshot.lease?.owned ||
        snapshot.binding?.projectId !== host.projectId || snapshot.binding?.sessionId !== host.sessionId ||
        snapshot.world?.id !== host.selectedWorld || !snapshot.binding?.turnId) {
      throw new Error("CRAFTMINE_FINISHED_TASK_REQUIRED");
    }
    const key = this.key(host.sessionId, host.turnId);
    if (this.contexts.has(key)) throw new Error("CRAFTMINE_MAINTENANCE_REBIND_REFUSED");
    this.contexts.set(key, Object.freeze({ projectId: host.projectId, sessionId: host.sessionId, turnId: snapshot.binding.turnId }));
  }

  has(sessionId: string, turnId: string): boolean { return this.contexts.has(this.key(sessionId, turnId)); }

  async request(host: CraftmineTurnBinding, operation: string, input: Record<string, any>, call: DomainCall): Promise<any> {
    const context = this.contexts.get(this.key(host.sessionId, host.turnId));
    if (!context || context.projectId !== host.projectId) throw new Error("CRAFTMINE_MAINTENANCE_OWNER_MISMATCH");
    if (operation === "task.context") {
      const current = await call(operation, { context });
      if (current.status !== "finished" || current.lease?.owned || current.world.id !== host.selectedWorld) throw new Error("CRAFTMINE_FINISHED_TASK_REQUIRED");
      return current;
    }
    if (operation === "budget.reserve" && input.purpose !== "summary" ||
        operation === "budget.boundary" && input.kind !== "compaction" ||
        !["budget.reserve", "budget.boundary", "budget.settle"].includes(operation)) {
      throw new Error("CRAFTMINE_MAINTENANCE_SCOPE_DENIED");
    }
    return call(operation, { ...input, context });
  }
}
