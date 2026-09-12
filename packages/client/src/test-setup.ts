import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Radix components construct ResizeObserver. Vitest 4 no longer makes an
// arrow-backed vi.fn() implementation constructible, while a few legacy tests
// still assign that shape in beforeEach. Keep a real constructor installed in
// jsdom and ignore those test-local replacements.
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  get: () => TestResizeObserver,
  set: () => {},
});

// Tests must not inherit standalone vi.fn() call counts from previous cases.
beforeEach(() => {
  vi.clearAllMocks();
});
