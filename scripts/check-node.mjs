#!/usr/bin/env node
/**
 * Refuse to run on a Node older than package.json's `engines.node`.
 *
 * WHY THIS GUARDS THE TEST SCRIPTS SPECIFICALLY
 *
 * Below the floor, jsdom 27's CJS→ESM chain can throw inside a vitest worker.
 * The interesting part is what that looks like: the files never execute, and
 * the run still reports success. A green suite over tests that did not run is
 * the single worst failure mode this repo has — it is how a settlement
 * function that raised on every call stayed green for a month, and how the
 * fix for it shipped twice without being exercised.
 *
 * `engines` alone does not prevent it. npm only warns, and only on install; it
 * has nothing to say when someone runs the suite two weeks later on whatever
 * Node their shell happens to resolve. So the floor is asserted at the moment
 * it matters, and asserted loudly.
 *
 * Refusing is the point. Passing a suite that silently skipped is worse than
 * not running one, because only one of those two gets believed.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** "22.12", ">=22.12", "^22.12.0" → [22, 12, 0]. */
function parse(version) {
  const parts = String(version)
    .replace(/^[^\d]*/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

let required;
try {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  required = pkg.engines?.node;
} catch (err) {
  console.error(`[check-node] could not read package.json: ${err.message}`);
  process.exit(1);
}

// No declared floor is not a failure — there is simply nothing to enforce.
if (!required) process.exit(0);

// Only the ">=" form is understood, which is the form this project declares.
// Anything else passes rather than being guessed at: a version range this
// script misreads would refuse a runtime that is actually fine, and a check
// that cries wolf gets deleted.
if (!/^>=/.test(String(required).trim())) process.exit(0);

if (compare(parse(process.version), parse(required)) < 0) {
  console.error(
    [
      "",
      `  Node ${process.version} is below this project's floor of ${required}.`,
      "",
      "  Refusing to run rather than running quietly wrong. Below the floor,",
      "  vitest workers can fail to load a test file and the run still reports",
      "  success — a green suite over tests that never executed.",
      "",
      `  Fix: nvm use  (see .nvmrc), or install Node ${parse(required).slice(0, 2).join(".")} or newer.`,
      "",
    ].join("\n")
  );
  process.exit(1);
}
