import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import nodePath from "path";

/**
 * validateWorkflowPath() resolves through node's `path` and requires the result
 * to equal the input. On Windows path.resolve("/test/dir") is "C:\test\dir",
 * so every POSIX literal in this file was rejected as a traversal attempt and
 * eleven tests failed on any Windows checkout. Fixtures are resolved the same
 * way the validator resolves them, so they are genuinely non-traversing paths
 * on whichever platform is running.
 */
const DIR = nodePath.resolve("/test/dir");
const NEW_DIR = nodePath.resolve("/nonexistent/dir");
const FILE_PATH = nodePath.resolve("/test/file.txt");
const MISSING_PATH = nodePath.resolve("/nonexistent");

/**
 * The validator's blocklist (/etc, /usr, /System, ...) is POSIX-only; it names
 * no Windows directory, so nothing is blocked there. This test asserts the
 * blocklist works where it exists rather than asserting a guarantee Windows
 * does not currently have.
 */
const itPosix = process.platform === "win32" ? it.skip : it;

// Mock fs/promises before importing the route
const mockStat = vi.fn();
const mockMkdir = vi.fn();
const mockWriteFile = vi.fn();

vi.mock("fs/promises", () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

// Mock logger to avoid console noise during tests
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { POST, GET } from "../route";

// Helper to create mock NextRequest for POST
function createMockPostRequest(body: unknown): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

// Helper to create mock NextRequest for GET
function createMockGetRequest(params: Record<string, string>): NextRequest {
  return {
    nextUrl: {
      searchParams: new URLSearchParams(params),
    },
  } as unknown as NextRequest;
}

describe("/api/workflow route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("POST - Save workflow", () => {
    it("should save workflow successfully", async () => {
      const mockWorkflow = {
        nodes: [{ id: "node1", type: "prompt" }],
        edges: [],
      };

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: DIR,
        filename: "my-workflow",
        workflow: mockWorkflow,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.filePath).toBe(nodePath.join(DIR, "my-workflow.json"));
      expect(mockWriteFile).toHaveBeenCalledWith(
        nodePath.join(DIR, "my-workflow.json"),
        JSON.stringify(mockWorkflow, null, 2),
        "utf-8"
      );
    });

    it("should sanitize filename with special characters", async () => {
      const mockWorkflow = { nodes: [], edges: [] };

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: DIR,
        filename: "my workflow!@#$%",
        workflow: mockWorkflow,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.filePath).toBe(nodePath.join(DIR, "my_workflow_____.json"));
    });

    it("should create inputs and generations subfolders", async () => {
      const mockWorkflow = { nodes: [], edges: [] };

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: DIR,
        filename: "workflow",
        workflow: mockWorkflow,
      });

      await POST(request);

      expect(mockMkdir).toHaveBeenCalledWith(nodePath.join(DIR, "inputs"), { recursive: true });
      expect(mockMkdir).toHaveBeenCalledWith(nodePath.join(DIR, "generations"), { recursive: true });
    });

    it("should reject missing directoryPath", async () => {
      const request = createMockPostRequest({
        filename: "workflow",
        workflow: { nodes: [], edges: [] },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Missing required fields");
    });

    it("should reject missing filename", async () => {
      const request = createMockPostRequest({
        directoryPath: DIR,
        workflow: { nodes: [], edges: [] },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Missing required fields");
    });

    it("should reject missing workflow", async () => {
      const request = createMockPostRequest({
        directoryPath: DIR,
        filename: "workflow",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Missing required fields");
    });

    it("should reject non-directory path", async () => {
      mockStat.mockResolvedValue({
        isDirectory: () => false,
      });

      const request = createMockPostRequest({
        directoryPath: FILE_PATH,
        filename: "workflow",
        workflow: { nodes: [], edges: [] },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Path is not a directory");
    });

    it("should create non-existent directory and continue saving", async () => {
      const mockWorkflow = { nodes: [], edges: [] };
      mockStat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: NEW_DIR,
        filename: "workflow",
        workflow: mockWorkflow,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(mockMkdir).toHaveBeenCalledWith(NEW_DIR, { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        nodePath.join(NEW_DIR, "workflow.json"),
        JSON.stringify(mockWorkflow, null, 2),
        "utf-8"
      );
    });

    it("should continue saving even if subfolder creation fails", async () => {
      const mockWorkflow = { nodes: [], edges: [] };

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockMkdir.mockRejectedValue(new Error("Permission denied"));
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: DIR,
        filename: "workflow",
        workflow: mockWorkflow,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.filePath).toBe(nodePath.join(DIR, "workflow.json"));
    });

    it("should return 500 on write failure", async () => {
      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockRejectedValue(new Error("Disk full"));

      const request = createMockPostRequest({
        directoryPath: DIR,
        filename: "workflow",
        workflow: { nodes: [], edges: [] },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Disk full");
    });

    it("should reject path traversal attempts", async () => {
      const request = createMockPostRequest({
        directoryPath: "/test/../etc/passwd",
        filename: "workflow",
        workflow: { nodes: [], edges: [] },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Path contains traversal sequences");
    });

    it("should reject non-absolute paths", async () => {
      const request = createMockPostRequest({
        directoryPath: "relative/path",
        filename: "workflow",
        workflow: { nodes: [], edges: [] },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Path must be absolute");
    });

    itPosix("should reject dangerous system paths", async () => {
      const request = createMockPostRequest({
        directoryPath: "/etc/workflows",
        filename: "workflow",
        workflow: { nodes: [], edges: [] },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Access to /etc is not allowed");
    });
  });

  describe("GET - Validate directory", () => {
    it("should return exists: true for existing directory", async () => {
      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });

      const request = createMockGetRequest({ path: DIR });
      const response = await GET(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.exists).toBe(true);
      expect(data.isDirectory).toBe(true);
    });

    it("should return isDirectory: false for file path", async () => {
      mockStat.mockResolvedValue({
        isDirectory: () => false,
      });

      const request = createMockGetRequest({ path: FILE_PATH });
      const response = await GET(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.exists).toBe(true);
      expect(data.isDirectory).toBe(false);
    });

    it("should return exists: false for non-existent path", async () => {
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const request = createMockGetRequest({ path: MISSING_PATH });
      const response = await GET(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.exists).toBe(false);
      expect(data.isDirectory).toBe(false);
    });

    it("should reject missing path parameter", async () => {
      const request = createMockGetRequest({});
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Path parameter required");
    });

    it("should reject path traversal attempts in GET", async () => {
      const request = createMockGetRequest({ path: "/test/../etc" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Path contains traversal sequences");
    });

    it("should reject non-absolute paths in GET", async () => {
      const request = createMockGetRequest({ path: "relative/path" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Path must be absolute");
    });
  });
});
