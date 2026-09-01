/**
 * A stale run id is worse than no run id: it tags a charge to a run that has
 * already been billed, so nothing settles it except the maintenance sweep and
 * the history page shows a cost for work the run never did. Most of these
 * tests are about the id being absent when it should be.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getActiveRunId, setActiveRunId, withRunId } from "../activeRun";

const RUN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  setActiveRunId(null);
});

describe("activeRun", () => {
  it("starts with no run", () => {
    expect(getActiveRunId()).toBeNull();
  });

  it("remembers the run the server minted", () => {
    setActiveRunId(RUN);
    expect(getActiveRunId()).toBe(RUN);
  });

  it("clears back to null", () => {
    setActiveRunId(RUN);
    setActiveRunId(null);
    expect(getActiveRunId()).toBeNull();
  });
});

describe("withRunId", () => {
  it("attaches the run to a generation body", () => {
    setActiveRunId(RUN);
    expect(withRunId({ prompt: "a cat" })).toEqual({
      prompt: "a cat",
      runId: RUN,
    });
  });

  // Outside a workflow — a single node regenerated from the canvas — the body
  // must go out untagged so its charge settles through the user-wide path.
  it("leaves the body untouched when no run is active", () => {
    const payload = { prompt: "a cat" };
    expect(withRunId(payload)).toEqual({ prompt: "a cat" });
    expect(withRunId(payload)).not.toHaveProperty("runId");
  });

  it("does not mutate the payload it was given", () => {
    setActiveRunId(RUN);
    const payload = { prompt: "a cat" };
    withRunId(payload);
    expect(payload).not.toHaveProperty("runId");
  });

  // The id is a grouping key. It must never be able to carry a price.
  it("cannot be talked into overriding the run id from the payload", () => {
    setActiveRunId(RUN);
    const result = withRunId({ runId: "someone-elses-run" }) as Record<
      string,
      unknown
    >;
    expect(result.runId).toBe(RUN);
  });

  it("stops tagging as soon as the run is cleared", () => {
    setActiveRunId(RUN);
    expect(withRunId({})).toHaveProperty("runId");
    setActiveRunId(null);
    expect(withRunId({})).not.toHaveProperty("runId");
  });
});
