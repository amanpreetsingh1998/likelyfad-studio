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
 *
 * That same Node version boundary bites a second time, one layer down, and the
 * second bite is quieter. jsdom 27 pulls html-encoding-sniffer@6, which is
 * CommonJS and require()s @exodus/bytes, which is ESM. Below Node 22.12 that
 * throws ERR_REQUIRE_ESM inside the test worker -- and vitest reports the
 * affected files as "no tests" with the error filed under "Unhandled Errors",
 * rather than as failures. The files do not break the run. They leave it.
 *
 * That is how src/lib/admin/__tests__/guard.test.ts -- the admin gate's own
 * test, the gate being the only thing between a signed-in user and every other
 * user's data -- stopped running without turning anything red. It cost 21 of
 * 59 tests in src/lib/admin alone.
 *
 * package.json already passes --experimental-require-module to the vitest
 * process, which is why this was invisible from the npm scripts too: the main
 * process is fine, and pool workers are spawned fresh without it.
 * poolOptions.{forks,threads}.execArgv does not reach them either -- measured,
 * not assumed. NODE_OPTIONS does, because workers inherit the environment, so
 * setting it here (before any pool starts) is what actually closes the hole,
 * on every platform and without a cross-env dependency.
 *
 * The real fix is Node >= 22.12, where require(esm) needs no flag; engines in
 * package.json says so. This keeps the suite honest until everyone is there.
 */

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";
import { fileURLToPath } from "url";

// __dirname does not exist in ESM.
const dirname = path.dirname(fileURLToPath(import.meta.url));

// See the header. Must run before the pool spawns, which config evaluation does.
// Appended rather than assigned so an existing NODE_OPTIONS is not discarded,
// and skipped when already present so repeated evaluation cannot stack copies.
for (const flag of [
  "--experimental-require-module",
  "--disable-warning=ExperimentalWarning",
]) {
  const existing = process.env.NODE_OPTIONS ?? "";
  if (!existing.includes(flag)) {
    process.env.NODE_OPTIONS = existing ? `${existing} ${flag}` : flag;
  }
}

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
