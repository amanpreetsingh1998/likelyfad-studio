import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CostDialog } from "@/components/CostDialog";
import { PredictedCostResult } from "@/utils/costCalculator";

// Mock the workflow store
const mockResetIncurredCost = vi.fn();
const mockUseWorkflowStore = vi.fn();

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector?: (state: unknown) => unknown) => {
    if (selector) {
      return mockUseWorkflowStore(selector);
    }
    return mockUseWorkflowStore((s: unknown) => s);
  },
}));

// Mock confirm
const mockConfirm = vi.fn(() => true);

describe("CostDialog", () => {
  beforeAll(() => {
    vi.stubGlobal("confirm", mockConfirm);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockReturnValue(true);
    mockUseWorkflowStore.mockImplementation((selector) => {
      const state = {
        resetIncurredCost: mockResetIncurredCost,
      };
      return selector(state);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper to create a PredictedCostResult with Gemini models only
   */
  const createGeminiOnlyCost = (overrides: Partial<PredictedCostResult> = {}): PredictedCostResult => ({
    totalCost: 0.463,
    breakdown: [
      {
        provider: "gemini",
        modelId: "nano-banana",
        modelName: "Nano Banana",
        count: 5,
        unitCost: 0.039,
        unit: "image",
        subtotal: 0.195,
      },
      {
        provider: "gemini",
        modelId: "nano-banana-pro",
        modelName: "Nano Banana Pro",
        count: 2,
        unitCost: 0.134,
        unit: "image",
        subtotal: 0.268,
      },
    ],
    nodeCount: 7,
    unknownPricingCount: 0,
    ...overrides,
  });

  /**
   * Helper to create a multi-provider PredictedCostResult with fal.ai and Replicate
   */
  const createMultiProviderCost = (): PredictedCostResult => ({
    totalCost: 0.55,
    breakdown: [
      {
        provider: "gemini",
        modelId: "nano-banana",
        modelName: "Nano Banana",
        count: 3,
        unitCost: 0.039,
        unit: "image",
        subtotal: 0.117,
      },
      {
        provider: "fal",
        modelId: "fal-ai/fast-sdxl",
        modelName: "Fast SDXL",
        count: 2,
        unitCost: 0.10,
        unit: "image",
        subtotal: 0.20,
      },
      {
        provider: "replicate",
        modelId: "stability-ai/sdxl",
        modelName: "Stability SDXL",
        count: 2,
        unitCost: null,
        unit: "image",
        subtotal: null,
      },
    ],
    nodeCount: 7,
    unknownPricingCount: 2,
  });

  /**
   * Helper to create external-only cost (no Gemini)
   */
  const createExternalOnlyCost = (): PredictedCostResult => ({
    totalCost: 0,
    breakdown: [
      {
        provider: "fal",
        modelId: "fal-ai/flux-dev",
        modelName: "FLUX.1 Dev",
        count: 2,
        unitCost: null,
        unit: "image",
        subtotal: null,
      },
      {
        provider: "replicate",
        modelId: "stability-ai/sdxl",
        modelName: "Stability SDXL",
        count: 1,
        unitCost: null,
        unit: "image",
        subtotal: null,
      },
    ],
    nodeCount: 3,
    unknownPricingCount: 3,
  });

  describe("Basic Rendering", () => {
    it("should render dialog with title", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText("Workflow Costs")).toBeInTheDocument();
    });

    it("should render close button", () => {
      const { container } = render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      const closeButton = container.querySelector("button");
      expect(closeButton).toBeInTheDocument();
    });

    it("should render the spend section", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText("Spent so far")).toBeInTheDocument();
    });
  });

  describe("Provider Groups", () => {
    it("should render the run estimate and group by provider", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText("One full run")).toBeInTheDocument();
      expect(screen.getByText("Gemini")).toBeInTheDocument();
    });

    it("should display the provider total alongside the run total", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      // Gemini is the only provider here, so its group total equals the run
      // total and the same figure is rendered twice, once in each place.
      expect(screen.getAllByText("$0.46")).toHaveLength(2);
    });

    it("should render per-model cost rows with counts", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText(/5x Nano Banana$/)).toBeInTheDocument();
      expect(screen.getByText(/2x Nano Banana Pro/)).toBeInTheDocument();
    });

    it("should display subtotal for each model type", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText("$0.20")).toBeInTheDocument(); // 0.195 rounded
      expect(screen.getByText("$0.27")).toBeInTheDocument(); // 0.268 rounded
    });

    it("should render Gemini provider icon", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText("G")).toBeInTheDocument();
    });

    it("should not show Gemini Cost section when no Gemini models", () => {
      render(
        <CostDialog
          predictedCost={createExternalOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.queryByText("Gemini Cost")).not.toBeInTheDocument();
    });
  });

  describe("External Providers Section", () => {
    it("should name each provider that appears in the breakdown", () => {
      render(
        <CostDialog
          predictedCost={createMultiProviderCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText("fal.ai")).toBeInTheDocument();
      expect(screen.getByText("Replicate")).toBeInTheDocument();
    });

    it("should show the node count in the run header", () => {
      render(
        <CostDialog
          predictedCost={createMultiProviderCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(
        screen.getByText(/7 nodes that spend API credits/)
      ).toBeInTheDocument();
    });

    it("should say node, singular, for a one-node workflow", () => {
      render(
        <CostDialog
          predictedCost={{
            totalCost: 0,
            breakdown: [{
              provider: "replicate",
              modelId: "stability-ai/sdxl",
              modelName: "Stability SDXL",
              count: 1,
              unitCost: null,
              unit: "image",
              subtotal: null,
            }],
            nodeCount: 1,
            unknownPricingCount: 1,
          }}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(
        screen.getByText(/1 node that spend API credits/)
      ).toBeInTheDocument();
    });

    it("should render provider icons for external providers", () => {
      render(
        <CostDialog
          predictedCost={createMultiProviderCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText("f")).toBeInTheDocument(); // fal.ai
      expect(screen.getByText("R")).toBeInTheDocument(); // Replicate
    });

    it("should show provider names", () => {
      render(
        <CostDialog
          predictedCost={createMultiProviderCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText("fal.ai")).toBeInTheDocument();
      expect(screen.getByText("Replicate")).toBeInTheDocument();
    });

    it("should show models grouped under their provider", () => {
      render(
        <CostDialog
          predictedCost={createMultiProviderCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText(/2x Fast SDXL/)).toBeInTheDocument();
      expect(screen.getByText(/2x Stability SDXL/)).toBeInTheDocument();
    });

    it("should offer a price lookup link for unpriced models", () => {
      render(
        <CostDialog
          predictedCost={createMultiProviderCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      const lookupLinks = screen.getAllByRole("link", {
        name: /Look up this model/i,
      });
      expect(lookupLinks.length).toBeGreaterThanOrEqual(1);
    });

    it("should link to correct fal.ai model page", () => {
      render(
        <CostDialog
          predictedCost={{
            totalCost: 0,
            breakdown: [{
              provider: "fal",
              modelId: "fal-ai/fast-sdxl",
              modelName: "Fast SDXL",
              count: 2,
              unitCost: null,
              unit: "image",
              subtotal: null,
            }],
            nodeCount: 2,
            unknownPricingCount: 2,
          }}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      const link = screen.getByRole("link", { name: /Look up this model/i });
      expect(link).toHaveAttribute("href", "https://fal.ai/models/fal-ai/fast-sdxl");
    });

    it("should link to correct Replicate model page", () => {
      render(
        <CostDialog
          predictedCost={createMultiProviderCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      const links = screen.getAllByRole("link", { name: /Look up this model/i });
      const replicateLink = links.find(link => link.getAttribute("href")?.includes("replicate.com"));
      expect(replicateLink).toHaveAttribute("href", "https://replicate.com/stability-ai/sdxl");
    });

    it("should strip version from Replicate model URL", () => {
      render(
        <CostDialog
          predictedCost={{
            totalCost: 0,
            breakdown: [{
              provider: "replicate",
              modelId: "stability-ai/sdxl:abc123",
              modelName: "Stability SDXL",
              count: 1,
              unitCost: null,
              unit: "image",
              subtotal: null,
            }],
            nodeCount: 1,
            unknownPricingCount: 1,
          }}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      const link = screen.getByRole("link", { name: /Look up this model/i });
      expect(link).toHaveAttribute("href", "https://replicate.com/stability-ai/sdxl");
    });

    it("should explain why some models have no price", () => {
      render(
        <CostDialog
          predictedCost={createMultiProviderCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(
        screen.getByText(/provider publishes no price/)
      ).toBeInTheDocument();
    });

    it("should not show External Providers section when no external models", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.queryByText("External Providers")).not.toBeInTheDocument();
    });
  });

  describe("Empty State", () => {
    it("should show empty state when no generation nodes exist", () => {
      render(
        <CostDialog
          predictedCost={{
            totalCost: 0,
            breakdown: [],
            nodeCount: 0,
            unknownPricingCount: 0,
          }}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(
        screen.getByText("No nodes in this workflow spend API credits")
      ).toBeInTheDocument();
    });
  });

  describe("Incurred Cost Section", () => {
    it("should display formatted incurred cost", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={2.50}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText("$2.50")).toBeInTheDocument();
    });

    it("should display $0.00 for zero incurred cost", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      // Find the incurred cost $0.00 (there may be multiple)
      const zeroValues = screen.getAllByText("$0.00");
      expect(zeroValues.length).toBeGreaterThanOrEqual(1);
    });

    it("should display description for incurred costs", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(
        screen.getByText(/Charged as each generation completes/)
      ).toBeInTheDocument();
    });
  });

  describe("Reset Costs Button", () => {
    it("should not show reset button when incurredCost is 0", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(screen.queryByText("Reset to $0.00")).not.toBeInTheDocument();
    });

    it("should show reset button when incurredCost is greater than 0", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={1.00}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText("Reset to $0.00")).toBeInTheDocument();
    });

    it("should show confirmation dialog when reset is clicked", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={1.00}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText("Reset to $0.00"));

      expect(mockConfirm).toHaveBeenCalledWith("Reset incurred cost to $0.00?");
    });

    it("should call resetIncurredCost when confirmed", () => {
      mockConfirm.mockReturnValue(true);

      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={1.00}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText("Reset to $0.00"));

      expect(mockResetIncurredCost).toHaveBeenCalled();
    });

    it("should not call resetIncurredCost when cancelled", () => {
      mockConfirm.mockReturnValue(false);

      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={1.00}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText("Reset to $0.00"));

      expect(mockResetIncurredCost).not.toHaveBeenCalled();
    });
  });

  describe("Close Behavior", () => {
    it("should call onClose when close button is clicked", () => {
      const onClose = vi.fn();

      const { container } = render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={onClose}
        />
      );

      const closeButton = container.querySelector("button");
      fireEvent.click(closeButton!);

      expect(onClose).toHaveBeenCalled();
    });

    it("should call onClose when Escape key is pressed", () => {
      const onClose = vi.fn();

      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={onClose}
        />
      );

      fireEvent.keyDown(window, { key: "Escape" });

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("Pricing Note", () => {
    it("should display the estimate caveat", () => {
      render(
        <CostDialog
          predictedCost={createGeminiOnlyCost()}
          incurredCost={0}
          onClose={vi.fn()}
        />
      );

      expect(
        screen.getByText(/Estimates assume one run per node/)
      ).toBeInTheDocument();
    });
  });
});
