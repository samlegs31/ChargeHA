/** Async queue for bridging push-based events to pull-based async generators.
 *  Encapsulates the mutable state (buffer + resolver) in one place. */
export function createAsyncQueue<T>() {
  const state: {
    items: T[];
    head: number;
    resolve: (() => void) | null;
  } = {
    items: [],
    head: 0,
    resolve: null,
  };

  return {
    push(item: T) {
      state.items.push(item);
      const resolve = state.resolve;
      state.resolve = null;
      resolve?.();
    },

    async *drain(signal?: AbortSignal): AsyncGenerator<T> {
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      while (!signal?.aborted) {
        if (state.head >= state.items.length) {
          // Reset the consumed buffer before sleeping so long-lived SSE
          // connections do not retain references to already-delivered events.
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
            if (signal?.aborted) {
              finish();
              return;
            }
            signal?.addEventListener("abort", onAbort, { once: true });
          });
        }

        // Use a cursor instead of Array.shift(), which is O(n) because it has
        // to re-index the remaining items on every delivered event.
        // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
        while (state.head < state.items.length) {
          const item = state.items[state.head];
          state.head += 1;
          yield item;
        }
      }
    },
  };
}
