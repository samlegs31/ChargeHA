/** Single-consumer queue bridging push events to an async generator. */
export function createAsyncQueue<T>() {
  const state: {
    items: (T | undefined)[];
    head: number;
    resolve: (() => void) | null;
  } = { items: [], head: 0, resolve: null };

  return {
    push(item: T) {
      state.items.push(item);
      const resolve = state.resolve;
      state.resolve = null;
      resolve?.();
    },

    async *drain(signal?: AbortSignal): AsyncGenerator<T> {
      try {
        while (!signal?.aborted) {
          if (state.head === state.items.length) {
            state.items = [];
            state.head = 0;
            await new Promise<void>((resolve) => {
              const onAbort = () => finish();
              const finish = () => {
                signal?.removeEventListener("abort", onAbort);
                if (state.resolve === finish) state.resolve = null;
                resolve();
              };
              state.resolve = finish;
              if (signal?.aborted) finish();
              else signal?.addEventListener("abort", onAbort, { once: true });
            });
          }
          while (!signal?.aborted && state.head < state.items.length) {
            const item = state.items[state.head] as T;
            // Release consumed payloads even when the producer never goes idle.
            state.items[state.head++] = undefined;
            if (state.head >= 1024 && state.head * 2 >= state.items.length) {
              state.items = state.items.slice(state.head);
              state.head = 0;
            }
            yield item;
          }
        }
      } finally {
        state.resolve?.();
        state.items = [];
        state.head = 0;
      }
    },
  };
}
