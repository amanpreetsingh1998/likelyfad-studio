/**
 * Must stay a .mts file.
 *
 * package.json has no "type": "module", so a plain vitest.config.ts is loaded
 * as CommonJS — which sends vitest through its config.cjs entry, which
 * require()s vite. Vite 7 is ESM-only, and Node only allows require(esm)
 * unflagged from 22.12. On anything earlier that combination fails before a
 * single test runs:
 *
 *   Error [ERR_REQUIRE_ESM]: require() of ES Module vite/dist/node/index.js
 *   from vitest/dist/config.cjs not supported
 *
 * The .mts extension makes this file ESM regardless of package.json, so the
 * ESM entry is used and vite is imported rather than required. Renaming it
 * back to .ts brings the failure back.
 */

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";
import { fileURLToPath } from "url";

// __dirname does not exist in ESM.
const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/lib/**", "src/components/**", "src/store/**"],
      exclude: ["node_modules", "src/__tests__"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
});
