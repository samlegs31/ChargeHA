import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createAsyncQueue } from "./AsyncQueue.ts";

interface FakeAbortSignalState {
  aborted: boolean;
  listener: (() => void) | null;
  added: number;
  removed: number;
}

describe("createAsyncQueue()", () => {
  function createFakeAbortSignal() {
    const state: FakeAbortSignalState = {
      aborted: false,
      listener: null,
      added: 0,
      removed: 0,
    };
    const signal = {
      get aborted() {
        return state.aborted;
      },
      addEventListener(
        _type: string,
        listener: EventListenerOrEventListenerObject,
      ) {
        state.added += 1;
        state.listener = typeof listener === "function"
          ? () => listener(new Event("abort"))
          : () => listener.handleEvent(new Event("abort"));
      },
      removeEventListener(
        _type: string,
        _listener: EventListenerOrEventListenerObject,
      ) {
        state.removed += 1;
        state.listener = null;
      },
    } as unknown as AbortSignal;

    return {
      signal,
      state,
      abort() {
        state.aborted = true;
        state.listener?.();
      },
    };
  }

  it("delivers buffered events in FIFO order", async () => {
    const queue = createAsyncQueue<number>();
    const abort = createFakeAbortSignal();
    queue.push(1);
    queue.push(2);
    queue.push(3);

    const iterator = queue.drain(abort.signal);
    expect((await iterator.next()).value).toBe(1);
    expect((await iterator.next()).value).toBe(2);
    expect((await iterator.next()).value).toBe(3);
    abort.abort();
    expect((await iterator.next()).done).toBe(true);
  });

  it("removes each abort listener after a waiting consumer is resumed", async () => {
    const queue = createAsyncQueue<number>();
    const abort = createFakeAbortSignal();
    const iterator = queue.drain(abort.signal);

    const pending = iterator.next();
    await Promise.resolve();
    expect(abort.state.added).toBe(1);

    queue.push(42);
    expect((await pending).value).toBe(42);
    expect(abort.state.removed).toBe(1);

    const waitingAgain = iterator.next();
    await Promise.resolve();
    expect(abort.state.added).toBe(2);

    abort.abort();
    expect((await waitingAgain).done).toBe(true);
    expect(abort.state.removed).toBe(2);
  });
});
