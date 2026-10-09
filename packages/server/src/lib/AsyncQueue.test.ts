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

Deno.test("abort stops a buffered burst before delivering more events", async () => {
  const queue = createAsyncQueue<number>();
  const controller = new AbortController();
  queue.push(1);
  queue.push(2);
  const iterator = queue.drain(controller.signal);
  expect((await iterator.next()).value).toBe(1);
  controller.abort();
  expect((await iterator.next()).done).toBe(true);
});

Deno.test("already aborted consumer delivers no events", async () => {
  const queue = createAsyncQueue<number>();
  const controller = new AbortController();
  controller.abort();
  queue.push(1);
  expect((await queue.drain(controller.signal).next()).done).toBe(true);
});

Deno.test("FIFO survives compaction and interleaved pushes", async () => {
  const queue = createAsyncQueue<number | undefined>();
  const controller = new AbortController();
  const iterator = queue.drain(controller.signal);
  for (let i = 0; i < 4096; i++) queue.push(i);
  for (let i = 0; i < 4096; i++) {
    expect((await iterator.next()).value).toBe(i);
    if (i === 2048) queue.push(undefined);
  }
  expect(await iterator.next()).toEqual({ value: undefined, done: false });
  const pending = iterator.next();
  controller.abort();
  expect((await pending).done).toBe(true);
});
