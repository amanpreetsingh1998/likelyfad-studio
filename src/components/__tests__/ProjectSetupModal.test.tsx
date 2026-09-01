import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectSetupModal } from "@/components/ProjectSetupModal";

// Mock the workflow store
const mockSetUseExternalImageStorage = vi.fn();
const mockUpdateProviderApiKey = vi.fn();
const mockToggleProvider = vi.fn();
const mockUseWorkflowStore = vi.fn();

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector?: (state: unknown) => unknown) => {
    if (selector) {
      return mockUseWorkflowStore(selector);
    }
    return mockUseWorkflowStore((s: unknown) => s);
  },
  generateWorkflowId: () => "mock-workflow-id",
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock confirm
const mockConfirm = vi.fn(() => true);
global.confirm = mockConfirm;

// Ensure localStorage is always available in this test environment
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(() => null),
  length: 0,
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

// Default store state factory
const createDefaultState = (overrides = {}) => ({
  workflowName: "",
  workflowId: "",
  saveDirectoryPath: "",
  useExternalImageStorage: true,
  setUseExternalImageStorage: mockSetUseExternalImageStorage,
  ...overrides,
});

describe("ProjectSetupModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for env-status API (called on modal open)
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/env-status") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ gemini: false, openai: false, replicate: false, fal: false }),
        });
      }
      // Default success response for other APIs
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });
    mockUseWorkflowStore.mockImplementation((selector) => {
      return selector(createDefaultState());
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Visibility", () => {
    it("should not render when isOpen is false", () => {
      render(
        <ProjectSetupModal
          isOpen={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="new"
        />
      );

      expect(screen.queryByText("New Project")).not.toBeInTheDocument();
      expect(screen.queryByText("Project Settings")).not.toBeInTheDocument();
    });

    it("should render with 'New Project' title when mode is 'new'", () => {
      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="new"
        />
      );

      expect(screen.getByText("New Project")).toBeInTheDocument();
    });

    it("should render with 'Project Settings' title when mode is 'settings'", () => {
      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="settings"
        />
      );

      expect(screen.getByText("Project Settings")).toBeInTheDocument();
    });
  });

  describe("Tab Navigation", () => {
    it("should render the Project tab", () => {
      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="new"
        />
      );

      expect(screen.getByText("Project")).toBeInTheDocument();
    });

    it("should start on Project tab in new mode", () => {
      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="new"
        />
      );

      // Project tab should show project name input
      expect(screen.getByPlaceholderText("my-project")).toBeInTheDocument();
    });
  });

  describe("Project Tab - New Mode", () => {
    it("should render empty form for new project", () => {
      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="new"
        />
      );

      const nameInput = screen.getByPlaceholderText("my-project") as HTMLInputElement;

      expect(nameInput.value).toBe("");
    });

    it("should render Create button in new mode", () => {
      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="new"
        />
      );

      expect(screen.getByText("Create")).toBeInTheDocument();
    });

    it("should render the project name input", () => {
      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="new"
        />
      );

      expect(screen.getByText("Project Name")).toBeInTheDocument();
    });

    it("should render embed images checkbox", () => {
      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="new"
        />
      );

      expect(screen.getByText("Embed images as base64")).toBeInTheDocument();
    });
  });

  describe("Project Tab - Settings Mode", () => {
    it("should pre-fill form with existing values in settings mode", () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          workflowName: "My Existing Project",
          saveDirectoryPath: "/path/to/project",
          useExternalImageStorage: false,
        }));
      });

      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="settings"
        />
      );

      const nameInput = screen.getByPlaceholderText("my-project") as HTMLInputElement;

      expect(nameInput.value).toBe("My Existing Project");
    });

    it("should render Save button in settings mode", () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          workflowName: "My Project",
          saveDirectoryPath: "/path/to/project",
        }));
      });

      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="settings"
        />
      );

      expect(screen.getByText("Save")).toBeInTheDocument();
    });
  });

  describe("Form Validation", () => {
    it("should show error when project name is empty", async () => {
      const onSave = vi.fn();

      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSave}
          mode="new"
        />
      );

      // Click Create
      fireEvent.click(screen.getByText("Create"));

      await waitFor(() => {
        expect(screen.getByText("Project name is required")).toBeInTheDocument();
      });
      expect(onSave).not.toHaveBeenCalled();
    });

  });

  describe("Save Behavior", () => {
    it("should call onSave with project details when form is valid", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === "/api/env-status") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ gemini: false, openai: false, replicate: false, fal: false }),
          });
        }
        if (url.startsWith("/api/workflow")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ exists: true, isDirectory: true }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      });

      const onSave = vi.fn();

      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSave}
          mode="new"
        />
      );

      // Fill the project name
      fireEvent.change(screen.getByPlaceholderText("my-project"), {
        target: { value: "My New Project" },
      });

      // Click Create
      fireEvent.click(screen.getByText("Create"));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          "mock-workflow-id",
          "My New Project",
          // With the directory field gone, a new project is a cloud project and
        // carries the "cloud:<projectId>" sentinel as its save path.
        "cloud:mock-workflow-id"
        );
      });
    });

    it("should update external storage setting when saved", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === "/api/env-status") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ gemini: false, openai: false, replicate: false, fal: false }),
          });
        }
        if (url.startsWith("/api/workflow")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ exists: true, isDirectory: true }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      });

      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="new"
        />
      );

      // Fill fields
      fireEvent.change(screen.getByPlaceholderText("my-project"), {
        target: { value: "My Project" },
      });

      // Toggle the embed switch (click it to enable embed/disable external)
      const embedSwitch = screen.getByRole("switch", { name: /embed images as base64/i });
      fireEvent.click(embedSwitch);

      // Click Create
      fireEvent.click(screen.getByText("Create"));

      await waitFor(() => {
        expect(mockSetUseExternalImageStorage).toHaveBeenCalledWith(false);
      });
    });
  });

  describe("Cancel Button", () => {
    it("should call onClose when Cancel is clicked", () => {
      const onClose = vi.fn();

      render(
        <ProjectSetupModal
          isOpen={true}
          onClose={onClose}
          onSave={vi.fn()}
          mode="new"
        />
      );

      fireEvent.click(screen.getByText("Cancel"));

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("Keyboard Shortcuts", () => {
    it("should close modal when Escape is pressed", () => {
      const onClose = vi.fn();

      const { container } = render(
        <ProjectSetupModal
          isOpen={true}
          onClose={onClose}
          onSave={vi.fn()}
          mode="new"
        />
      );

      const modalDiv = container.querySelector(".bg-neutral-800");
      fireEvent.keyDown(modalDiv!, { key: "Escape" });

      expect(onClose).toHaveBeenCalled();
    });

    it("should submit form when Enter is pressed", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === "/api/env-status") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ gemini: false, openai: false, replicate: false, fal: false }),
          });
        }
        if (url.startsWith("/api/workflow")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ exists: true, isDirectory: true }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      });

      const onSave = vi.fn();

      const { container } = render(
        <ProjectSetupModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSave}
          mode="new"
        />
      );

      // Fill fields
      fireEvent.change(screen.getByPlaceholderText("my-project"), {
        target: { value: "My Project" },
      });

      const modalDiv = container.querySelector(".bg-neutral-800");
      fireEvent.keyDown(modalDiv!, { key: "Enter" });

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });
    });
  });

});
