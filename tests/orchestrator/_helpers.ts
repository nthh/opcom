/**
 * Poll until `fn` returns true or timeout (default 2000ms).
 * Polls every 5ms for fast resolution without wasting time.
 */
export async function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}
