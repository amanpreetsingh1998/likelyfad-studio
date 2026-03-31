import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickstartInitialView } from "@/components/quickstart/QuickstartInitialView";

describe("QuickstartInitialView", () => {
  const mockOnNewProject = vi.fn();
  const mockOnSelectTemplates = vi.fn();
  const mockOnSelectVibe = vi.fn();
  const mockOnSelectLoad = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic Rendering", () => {
    it("should render the Likelyfad Studio title and logo", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      expect(screen.getByText("Likelyfad Studio")).toBeInTheDocument();
      expect(screen.getAllByAltText("").length).toBeGreaterThan(0); // Logo images
    });

    it("should render the description text", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      expect(
        screen.getByText(/AI-powered creative production workflows/i)
      ).toBeInTheDocument();
    });

    it("should render all four option buttons", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      expect(screen.getByText("New project")).toBeInTheDocument();
      expect(screen.getByText("Load workflow")).toBeInTheDocument();
      expect(screen.getByText("Templates")).toBeInTheDocument();
      expect(screen.getByText("Prompt a workflow")).toBeInTheDocument();
    });

    it("should render option descriptions", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      expect(screen.getByText("Start a new workflow")).toBeInTheDocument();
      expect(screen.getByText("Open existing file")).toBeInTheDocument();
      expect(screen.getByText("Pre-built workflows")).toBeInTheDocument();
      expect(screen.getByText("Prompt a workflow")).toBeInTheDocument();
    });
  });

  describe("New Project Option", () => {
    it("should call onNewProject when clicked", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      fireEvent.click(screen.getByText("New project"));

      expect(mockOnNewProject).toHaveBeenCalledTimes(1);
    });

    it("should display correct description for new project", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      expect(screen.getByText("Start a new workflow")).toBeInTheDocument();
    });
  });

  describe("Load Workflow Option", () => {
    it("should call onSelectLoad when clicked", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      fireEvent.click(screen.getByText("Load workflow"));

      expect(mockOnSelectLoad).toHaveBeenCalledTimes(1);
    });
  });

  describe("Templates Option", () => {
    it("should call onSelectTemplates when clicked", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      fireEvent.click(screen.getByText("Templates"));

      expect(mockOnSelectTemplates).toHaveBeenCalledTimes(1);
    });
  });

  describe("Prompt a Workflow Option", () => {
    it("should call onSelectVibe when clicked", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      fireEvent.click(screen.getByText("Prompt a workflow"));

      expect(mockOnSelectVibe).toHaveBeenCalledTimes(1);
    });

    it("should display Beta badge on prompt option", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      expect(screen.getByText("Beta")).toBeInTheDocument();
    });
  });

  describe("External Links", () => {
    it("should render X/Twitter link with correct URL", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      const twitterLink = screen.getByText("X / Twitter").closest("a");
      expect(twitterLink).toHaveAttribute("href", "https://x.com/amanxdesign");
      expect(twitterLink).toHaveAttribute("target", "_blank");
      expect(twitterLink).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("should render Instagram link with correct URL", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      const instagramLink = screen.getByText("Instagram").closest("a");
      expect(instagramLink).toHaveAttribute("href", "https://www.instagram.com/");
      expect(instagramLink).toHaveAttribute("target", "_blank");
      expect(instagramLink).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  describe("Accessibility", () => {
    it("should have all buttons as interactive button elements", () => {
      render(
        <QuickstartInitialView
          onNewProject={mockOnNewProject}
          onSelectTemplates={mockOnSelectTemplates}
          onSelectVibe={mockOnSelectVibe}
          onSelectLoad={mockOnSelectLoad}
        />
      );

      const buttons = screen.getAllByRole("button");
      // Should have 4 option buttons
      expect(buttons.length).toBe(4);
    });
  });
});
