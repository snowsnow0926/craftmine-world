/** A deadline reports incomplete teardown; it never substitutes for completion. */
export function awaitOwnedClose(completion: Promise<unknown>, label: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_CLOSE_TIMEOUT`)), timeoutMs);
    completion.then(() => { clearTimeout(timer); resolve(); }, error => { clearTimeout(timer); reject(error); });
  });
}

/** UtilityProcess has exit, not ChildProcess.close. Track its exposed pipes too. */
export function utilityProcessClosed(child: {
  once(event: "exit", callback: () => void): unknown;
  stdout?: { closed?: boolean; once(event: "close", callback: () => void): unknown } | null;
  stderr?: { closed?: boolean; once(event: "close", callback: () => void): unknown } | null;
}): Promise<void> {
  const exit = new Promise<void>(resolve => { child.once("exit", resolve); });
  const pipes = [child.stdout, child.stderr].map(stream => !stream || stream.closed ? Promise.resolve()
    : new Promise<void>(resolve => { stream.once("close", resolve); }));
  return Promise.all([exit, ...pipes]).then(() => undefined);
}
