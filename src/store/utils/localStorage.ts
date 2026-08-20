import {
  WorkflowSaveConfig,
  WorkflowCostData,
  RecentModel,
  NodeDefaultsConfig,
  GenerateImageNodeDefaults,
  GenerateVideoNodeDefaults,
  LLMNodeDefaults,
  CanvasNavigationSettings,
  defaultCanvasNavigationSettings,
} from "@/types";

// Storage keys
export const STORAGE_KEY = "likelyfad-studio-workflow-configs";
export const COST_DATA_STORAGE_KEY = "likelyfad-studio-workflow-costs";
export const GENERATE_IMAGE_DEFAULTS_KEY = "likelyfad-studio-nanoBanana-defaults";
/** Removed in the server-side-keys change; retained only so it can be purged. */
export const LEGACY_PROVIDER_SETTINGS_KEY = "likelyfad-studio-provider-settings";
export const RECENT_MODELS_KEY = "likelyfad-studio-recent-models";
export const NODE_DEFAULTS_KEY = "likelyfad-studio-node-defaults";
export const CANVAS_NAVIGATION_KEY = "likelyfad-studio-canvas-navigation";
export const LAST_PROJECT_BASE_DIR_KEY = "likelyfad-studio-last-project-dir";
export const WORKFLOWS_DIRECTORY_KEY = "likelyfad-studio-workflows-directory";
export const FTUX_COMPLETED_KEY = "likelyfad-studio-ftux-completed";

// Maximum recent models to store (show 4 in UI, keep 8 for persistence)
export const MAX_RECENT_MODELS = 8;

// GenerateImage defaults interface
export interface GenerateImageDefaults {
  aspectRatio: string;
  resolution: string;
  model: string;
  useGoogleSearch: boolean;
  useImageSearch: boolean;
}

const DEFAULT_GENERATE_IMAGE_SETTINGS: GenerateImageDefaults = {
  aspectRatio: "1:1",
  resolution: "1K",
  model: "nano-banana-pro",
  useGoogleSearch: false,
  useImageSearch: false,
};

// Workflow configs helpers
export const loadSaveConfigs = (): Record<string, WorkflowSaveConfig> => {
  if (typeof window === "undefined") return {};
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : {};
};

export const saveSaveConfig = (config: WorkflowSaveConfig): void => {
  if (typeof window === "undefined") return;
  const configs = loadSaveConfigs();
  configs[config.workflowId] = config;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
};

// Cost data helpers
export const loadWorkflowCostData = (workflowId: string): WorkflowCostData | null => {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(COST_DATA_STORAGE_KEY);
  if (!stored) return null;
  try {
    const allCosts: Record<string, WorkflowCostData> = JSON.parse(stored);
    return allCosts[workflowId] || null;
  } catch {
    return null;
  }
};

export const saveWorkflowCostData = (data: WorkflowCostData): void => {
  if (typeof window === "undefined") return;
  const stored = localStorage.getItem(COST_DATA_STORAGE_KEY);
  let allCosts: Record<string, WorkflowCostData> = {};
  if (stored) {
    try {
      allCosts = JSON.parse(stored);
    } catch {
      allCosts = {};
    }
  }
  allCosts[data.workflowId] = data;
  localStorage.setItem(COST_DATA_STORAGE_KEY, JSON.stringify(allCosts));
};

// GenerateImage defaults helpers
export const loadGenerateImageDefaults = (): GenerateImageDefaults => {
  if (typeof window === "undefined") {
    return DEFAULT_GENERATE_IMAGE_SETTINGS;
  }
  const stored = localStorage.getItem(GENERATE_IMAGE_DEFAULTS_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return DEFAULT_GENERATE_IMAGE_SETTINGS;
    }
  }
  return DEFAULT_GENERATE_IMAGE_SETTINGS;
};

export const saveGenerateImageDefaults = (settings: Partial<GenerateImageDefaults>): void => {
  if (typeof window === "undefined") return;
  const current = loadGenerateImageDefaults();
  const updated = { ...current, ...settings };
  localStorage.setItem(GENERATE_IMAGE_DEFAULTS_KEY, JSON.stringify(updated));
};

/**
 * Drop the old per-user API keys from the browser.
 *
 * Keys are server-side only now. Anyone who used the app before this change
 * still has their pasted keys sitting in localStorage, where they are no
 * longer read but are still readable — by an extension, by anything with a
 * foothold on the page. Deleting them is the point; it is not housekeeping.
 */
export const purgeLegacyProviderSettings = (): void => {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_PROVIDER_SETTINGS_KEY);
  } catch {
    // Private mode or a locked store — nothing to do but leave it.
  }
};

// Recent models helpers
export const getRecentModels = (): RecentModel[] => {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(RECENT_MODELS_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as RecentModel[];
    } catch {
      return [];
    }
  }
  return [];
};

export const saveRecentModels = (models: RecentModel[]): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(models));
};

// Node defaults helpers
export const loadNodeDefaults = (): NodeDefaultsConfig => {
  if (typeof window === "undefined") return {};
  const stored = localStorage.getItem(NODE_DEFAULTS_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as NodeDefaultsConfig;
    } catch {
      return {};
    }
  }
  return {};
};

export const saveNodeDefaults = (config: NodeDefaultsConfig): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem(NODE_DEFAULTS_KEY, JSON.stringify(config));
};

export const getGenerateImageDefaults = (): GenerateImageNodeDefaults | undefined => {
  const config = loadNodeDefaults();
  return config.generateImage;
};

export const getGenerateVideoDefaults = (): GenerateVideoNodeDefaults | undefined => {
  const config = loadNodeDefaults();
  return config.generateVideo;
};

export const getLLMDefaults = (): LLMNodeDefaults | undefined => {
  const config = loadNodeDefaults();
  return config.llm;
};

// Canvas navigation settings helpers
export const getCanvasNavigationSettings = (): CanvasNavigationSettings => {
  if (typeof window === "undefined") return defaultCanvasNavigationSettings;
  const stored = localStorage.getItem(CANVAS_NAVIGATION_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as CanvasNavigationSettings;
    } catch {
      return defaultCanvasNavigationSettings;
    }
  }
  return defaultCanvasNavigationSettings;
};

export const saveCanvasNavigationSettings = (settings: CanvasNavigationSettings): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem(CANVAS_NAVIGATION_KEY, JSON.stringify(settings));
};

// Last project base directory helpers
export const getLastProjectBaseDir = (): string | null => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LAST_PROJECT_BASE_DIR_KEY);
};

export const setLastProjectBaseDir = (dir: string): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem(LAST_PROJECT_BASE_DIR_KEY, dir);
};

// Workflows directory helpers
export const getWorkflowsDirectory = (): string | null => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(WORKFLOWS_DIRECTORY_KEY);
};

export const setWorkflowsDirectory = (path: string): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem(WORKFLOWS_DIRECTORY_KEY, path);
};

// Workflow ID generator
export const generateWorkflowId = (): string =>
  `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// FTUX (First-Time User Experience) helpers
export const getFTUXCompleted = (): boolean => {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(FTUX_COMPLETED_KEY);
  return stored === "true";
};

export const setFTUXCompleted = (completed: boolean): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem(FTUX_COMPLETED_KEY, completed ? "true" : "false");
};

/**
 * @deprecated Backward-compatible alias. Use `GenerateImageDefaults` instead.
 */
export type NanoBananaDefaults = GenerateImageDefaults;

/**
 * @deprecated Backward-compatible alias. Use `loadGenerateImageDefaults` instead.
 */
export const loadNanoBananaDefaults = loadGenerateImageDefaults;

/**
 * @deprecated Backward-compatible alias. Use `saveGenerateImageDefaults` instead.
 */
export const saveNanoBananaDefaults = saveGenerateImageDefaults;
