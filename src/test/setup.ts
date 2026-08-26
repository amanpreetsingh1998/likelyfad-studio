import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Mock ResizeObserver for React Flow tests
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

global.ResizeObserver = ResizeObserverMock;

// Mock DOMMatrixReadOnly for React Flow
class DOMMatrixReadOnlyMock {
  m22: number = 1;
  constructor() {
    this.m22 = 1;
  }
}

global.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly;

// Cleanup after each test to ensure DOM is reset
afterEach(() => {
  cleanup();
});

// The local-filesystem routes (workflow, save-generation, open-file and the
// rest) are gated by requireLocal(), which is opt-in so that a hosted
// deployment cannot reach them — see src/lib/local/guard.ts.
//
// Their suites test what those routes do with a path, not whether the gate
// works, so the suite opts in the same way a local desktop run does. The gate
// has its own test: src/lib/local/__tests__/guard.test.ts.
process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES = "1";
