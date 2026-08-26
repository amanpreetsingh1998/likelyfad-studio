// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import nodePath from "path";

/**
 * The route resolves every incoming path through node's `path`, so its idea of
 * "absolute", of the separator, and of what counts as inside the home directory
 * are all the host platform's. Hard-coding POSIX strings here made eight of
 * these tests assert Windows-illegal paths, and they had been failing on any
 * Windows checkout ever since.
 *
 * Building the fixtures through the same module keeps the subject under test
 * the route's logic rather than the separator it happened to be written on.
 */
const HOME = nodePath.resolve("/Users/testuser");
const HOME_FILE = nodePath.join(HOME, "file.glb");
const NESTED_DIR = nodePath.join(HOME, "generations");
const NESTED_FILE = nodePath.join(NESTED_DIR, "model.glb");
const MISSING_FILE = nodePath.join(HOME, "nonexistent.glb");
const OUTSIDE_HOME = nodePath.resolve("/etc/passwd");

// Use vi.hoisted so mock fns are available during vi.mock() hoisting
const { mockExecFileAsync, mockStat, mockPlatform, mockHomedir } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockStat: vi.fn(),
  mockPlatform: vi.fn(),
  mockHomedir: vi.fn(),
}));

vi.mock(import("child_process"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

vi.mock(import("util"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promisify: () => mockExecFileAsync,
  };
});

vi.mock(import("fs/promises"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    stat: (...args: unknown[]) => mockStat(...args),
  };
});

vi.mock(import("os"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual,
      platform: () => mockPlatform(),
      homedir: () => mockHomedir(),
    },
    platform: () => mockPlatform(),
    homedir: () => mockHomedir(),
  };
});

import { POST } from "../route";

// Helper to create mock NextRequest
function createMockRequest(
  body: unknown,
  headers?: Record<string, string>
): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers({ host: "localhost:3000", ...headers }),
  } as unknown as NextRequest;
}

describe("/api/open-file route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.mockReturnValue("darwin");
    mockHomedir.mockReturnValue(HOME);
  });

  describe("localhost guard", () => {
    it("should return 404 for non-localhost x-forwarded-for", async () => {
      const request = createMockRequest(
        { filePath: HOME_FILE },
        { "x-forwarded-for": "203.0.113.50", host: "localhost:3000" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Not found");
    });

    it("should return 404 for non-localhost host header", async () => {
      const request = createMockRequest(
        { filePath: HOME_FILE },
        { host: "example.com" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Not found");
    });

    it("should allow requests from 127.0.0.1 x-forwarded-for", async () => {
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const request = createMockRequest(
        { filePath: HOME_FILE },
        { "x-forwarded-for": "127.0.0.1", host: "localhost:3000" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("should allow requests from ::1 x-forwarded-for", async () => {
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const request = createMockRequest(
        { filePath: HOME_FILE },
        { "x-forwarded-for": "::1", host: "localhost:3000" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("should allow requests with localhost host header", async () => {
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const request = createMockRequest(
        { filePath: HOME_FILE },
        { host: "localhost:3000" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe("input validation", () => {
    it("should return 400 for missing filePath", async () => {
      const request = createMockRequest({});

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("File path is required");
    });

    it("should return 400 for empty filePath", async () => {
      const request = createMockRequest({ filePath: "" });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("File path is required");
    });

    it("should return 400 for non-string filePath", async () => {
      const request = createMockRequest({ filePath: 12345 });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("File path is required");
    });
  });

  describe("path restriction", () => {
    it("should return 403 for path outside home directory", async () => {
      const request = createMockRequest({ filePath: OUTSIDE_HOME });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Path is outside allowed directory");
    });
  });

  describe("file validation", () => {
    it("should return 400 when path is a directory", async () => {
      mockStat.mockResolvedValue({ isFile: () => false });

      const request = createMockRequest({
        filePath: NESTED_DIR,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Path is not a file");
    });

    it("should return 400 when file does not exist", async () => {
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const request = createMockRequest({
        filePath: MISSING_FILE,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("File does not exist");
    });
  });

  describe("platform commands", () => {
    it("should call 'open -R' on macOS", async () => {
      mockPlatform.mockReturnValue("darwin");
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const request = createMockRequest({
        filePath: NESTED_FILE,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledWith("open", ["-R", NESTED_FILE]);
    });

    it("should call 'xdg-open' with parent directory on Linux", async () => {
      mockPlatform.mockReturnValue("linux");
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const request = createMockRequest({
        filePath: NESTED_FILE,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledWith("xdg-open", [NESTED_DIR]);
    });

    it("should call 'explorer /select' on Windows", async () => {
      mockPlatform.mockReturnValue("win32");
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const request = createMockRequest({ filePath: NESTED_FILE });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledWith("explorer", [
        `/select,"${NESTED_FILE}"`,
      ]);
    });

    /**
     * explorer.exe exits non-zero even when it has opened the window, so the
     * route swallows a failure carrying an exit code on win32. That is the
     * branch every Windows user actually takes, and it had no test.
     */
    it("should treat a non-zero explorer exit as success on Windows", async () => {
      mockPlatform.mockReturnValue("win32");
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockRejectedValue(
        Object.assign(new Error("Command failed"), { code: 1 })
      );

      const request = createMockRequest({ filePath: NESTED_FILE });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    // ...but the swallow is narrow: a failure with no exit code is still a 500,
    // so a missing explorer.exe does not report success.
    it("should still fail on Windows when the error carries no exit code", async () => {
      mockPlatform.mockReturnValue("win32");
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockRejectedValue(new Error("spawn ENOENT"));

      const request = createMockRequest({ filePath: NESTED_FILE });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to open file location");
    });

    it("should return 500 when command execution fails", async () => {
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockRejectedValue(new Error("Command not found"));

      const request = createMockRequest({
        filePath: NESTED_FILE,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to open file location");
    });
  });
});
