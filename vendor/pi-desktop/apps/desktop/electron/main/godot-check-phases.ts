/** Observations only: stage completion never contributes to the check verdict. */
export function createGodotCheckPhases(log: string[], now = Date.now) {
  const started = now();
  let active: { name: string; started: number } | null = null;
  const record = (state: string) => {
    if (!active) return;
    const time = now();
    if (log.length >= 64) log.splice(63);
    log.push(`[phase] ${active.name} ${state} elapsedMs=${Math.max(0, time - started)} stageElapsedMs=${Math.max(0, time - active.started)}`);
  };
  return {
    begin(name: 'artifact-verification' | 'runtime-server' | 'window' | 'load' | 'ready' | 'runtime-check') {
      active = { name, started: now() }; record('started');
    },
    complete() { record('completed'); active = null; },
    fail() { record('failed'); active = null; },
  };
}
