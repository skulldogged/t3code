import { describe, expect, it } from "vite-plus/test";

import { formatDuration, deriveActiveWorkStartedAt } from "./orchestrationTiming.ts";

describe("formatDuration", () => {
  it.each([
    [0, "1ms"],
    [250, "250ms"],
    [1_500, "1.5s"],
    [9_950, "10s"],
    [22_000, "22s"],
    [60_000, "1m"],
    [65_000, "1m 5s"],
    [119_500, "2m"],
    [3_599_499, "59m 59s"],
    [3_599_500, "1h"],
    [3_600_000, "1h"],
    [3_601_000, "1h 1s"],
    [3_660_000, "1h 1m"],
    [3_661_000, "1h 1m 1s"],
    [7_199_500, "2h"],
    [25_190_000, "6h 59m 50s"],
    [90_061_000, "25h 1m 1s"],
  ])("formats %d ms as %s", (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });

  it.each([-1, NaN, Infinity, -Infinity])("handles invalid durations: %s", (durationMs) => {
    expect(formatDuration(durationMs)).toBe("0ms");
  });
});

describe("deriveActiveWorkStartedAt", () => {
  it.each([null, "2026-09-06T23:34:00.000Z"])(
    "does not time a superseded run when the active run differs",
    (sendStartedAt) => {
      expect(
        deriveActiveWorkStartedAt(
          {
            runId: "old",
            requestedAt: "2026-09-06T23:33:00.000Z",
            startedAt: null,
            completedAt: null,
          },
          { orchestrationStatus: "running", activeRunId: "new" },
          sendStartedAt,
        ),
      ).toBe(sendStartedAt);
    },
  );

  it("stops timing a run that failed before its provider started", () => {
    expect(
      deriveActiveWorkStartedAt(
        {
          runId: "run-1",
          requestedAt: "2026-09-06T23:33:00.000Z",
          startedAt: null,
          completedAt: "2026-09-06T23:33:05.000Z",
        },
        { orchestrationStatus: "failed", activeRunId: null },
        null,
      ),
    ).toBeNull();
  });
  // The gap this closes. The projector records requestedAt before provider
  // startup, so during spin-up the run has no startedAt and the runtime is
  // "starting". Returning
  // null there blinks the working indicator out between "Setting up
  // worktree..." and "Working for 0s".
  it("counts from requestedAt while the provider is still starting", () => {
    expect(
      deriveActiveWorkStartedAt(
        {
          runId: "run-1",
          requestedAt: "2026-09-06T23:33:00.000Z",
          startedAt: null,
          completedAt: null,
        },
        { orchestrationStatus: "starting", activeRunId: null },
        null,
      ),
    ).toBe("2026-09-06T23:33:00.000Z");
  });

  it("prefers the run's own startedAt once the provider reports it", () => {
    expect(
      deriveActiveWorkStartedAt(
        {
          runId: "run-1",
          requestedAt: "2026-09-06T23:33:00.000Z",
          startedAt: "2026-09-06T23:33:05.000Z",
          completedAt: null,
        },
        { orchestrationStatus: "running", activeRunId: "run-1" },
        null,
      ),
    ).toBe("2026-09-06T23:33:05.000Z");
  });

  // requestedAt must not leak past the end of the work.
  it("stops counting once the run has settled", () => {
    expect(
      deriveActiveWorkStartedAt(
        {
          runId: "run-1",
          requestedAt: "2026-09-06T23:33:00.000Z",
          startedAt: "2026-09-06T23:33:05.000Z",
          completedAt: "2026-09-06T23:33:09.000Z",
        },
        { orchestrationStatus: "idle", activeRunId: null },
        null,
      ),
    ).toBeNull();
  });

  // A runtime restarting with no new run must not resurrect the old one.
  it("does not count a settled run while the runtime is starting again", () => {
    expect(
      deriveActiveWorkStartedAt(
        {
          runId: "run-1",
          requestedAt: "2026-09-06T23:33:00.000Z",
          startedAt: "2026-09-06T23:33:05.000Z",
          completedAt: "2026-09-06T23:33:09.000Z",
        },
        { orchestrationStatus: "starting", activeRunId: null },
        null,
      ),
    ).toBeNull();
  });

  it("falls back to the caller's send timestamp when there is no run yet", () => {
    expect(deriveActiveWorkStartedAt(null, null, "2026-09-06T23:33:00.000Z")).toBe(
      "2026-09-06T23:33:00.000Z",
    );
  });
});
