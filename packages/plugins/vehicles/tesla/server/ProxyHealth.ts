/** Local proxy health only: no credentials, Fleet API or vehicle command. */
export function createProxyHealthProbe(
  fetcher: typeof fetch = globalThis.fetch,
  now: () => number = Date.now,
) {
  let cached: { url: string; expires: number; pending: Promise<boolean> } | undefined;
  return (baseUrl: string): Promise<boolean> => {
    let url: string;
    try {
      const parsed = new URL(baseUrl);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return Promise.resolve(false);
      url = new URL('/health', parsed).href;
    } catch { return Promise.resolve(false); }
    if (cached?.url === url && cached.expires > now()) return cached.pending;
    const entry = { url, expires: Infinity, pending: Promise.resolve(false) };
    entry.pending = (async () => {
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(3000), redirect: 'error' });
        const ok = response.status === 200;
        await response.body?.cancel();
        return ok;
      } catch { return false; }
      finally { entry.expires = now() + 10000; }
    })();
    cached = entry;
    return entry.pending;
  };
}
export const probeTeslaProxy = createProxyHealthProbe();
