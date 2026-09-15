/** Retry only the host's known read timeout while the original create is owned. */
export async function readWorldCreationConfirmation<T>({read, current, pending, wait}: {
  read: () => Promise<T>;
  current: () => boolean;
  pending: () => void;
  wait: () => Promise<void>;
}): Promise<T | null> {
  while (current()) {
    try {
      const result = await read();
      return current() ? result : null;
    } catch (error) {
      if (!current()) return null;
      if (!(error instanceof Error) || !/^(?:Error: )?Craftmine Rust request timed out$/.test(error.message)) throw error;
      // A read timeout says nothing about whether the registered world failed.
      // Never replay creation, retry initialization, or change its identity here.
      pending();
      await wait();
    }
  }
  return null;
}
