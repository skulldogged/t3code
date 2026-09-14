import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  RuntimeRequestId,
} from "@t3tools/contracts";
import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { makeRawThreadShell } from "../../test-fixtures";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { connectedWidgetActivities, mergeWidgetActivities } from "./widgetSnapshot";

const environmentId = EnvironmentId.make("direct");
const projectId = ProjectId.make("project");
const now = "2026-09-06T12:00:00.000Z";
const timestamp = DateTime.makeUnsafe(now);
const approval = {
  id: RuntimeRequestId.make("approval"),
  kind: "command" as const,
  createdAt: timestamp,
};
const input = {
  id: RuntimeRequestId.make("input"),
  kind: "user_input" as const,
  createdAt: timestamp,
};
const thread = makeRawThreadShell({
  id: ThreadId.make("thread"),
  projectId,
  title: "Fix widget",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6" },
  status: "running",
  createdAt: timestamp,
  updatedAt: timestamp,
});
function connected(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  status: EnvironmentShellState["status"] = "live",
) {
  return connectedWidgetActivities(
    new Map([
      [
        environmentId,
        {
          status,
          error: Option.none(),
          snapshot: Option.some({
            schemaVersion: 1,
            snapshotSequence: 1,
            archivedThreads: [],
            updatedAt: timestamp,
            threads,
            projects: [
              {
                id: projectId,
                title: "T3",
                workspaceRoot: "/t3",
                defaultModelSelection: null,
                scripts: [],
                createdAt: now,
                updatedAt: now,
              },
            ],
          }),
        },
      ],
    ]),
  );
}

describe("connected widget activity", () => {
  it("shows direct activity without a relay account, including approval and input transitions", () => {
    for (const [overrides, phase] of [
      [{}, "running"],
      [{ pendingRuntimeRequest: approval }, "waiting_for_approval"],
      [{ pendingRuntimeRequest: input }, "waiting_for_input"],
    ] as const) {
      expect(mergeWidgetActivities({}, connected([{ ...thread, ...overrides }]))).toMatchObject({
        activeCount: 1,
        activities: [{ threadTitle: "Fix widget", phase, deepLink: "/threads/direct/thread" }],
      });
    }
  });

  it("clears completed, archived, deleted, and removed threads even when relay data still says running", () => {
    const relay = mergeWidgetActivities({}, connected([thread]));
    for (const threads of [
      [
        {
          ...thread,
          status: "completed" as const,
        },
      ],
      [{ ...thread, archivedAt: timestamp }],
      [{ ...thread, deletedAt: timestamp }],
      [],
    ]) {
      expect(mergeWidgetActivities(relay, connected(threads))).toEqual({});
    }
  });

  it("retains a running V2 activity when a newer queued run was cancelled", () => {
    expect(
      mergeWidgetActivities(
        {},
        connected([{ ...thread, status: "cancelled", activityRunStatus: "running" }]),
      ),
    ).toMatchObject({
      activeCount: 1,
      activities: [{ phase: "running" }],
    });
  });

  it("marks cached activity delayed and restores it on reconnect", () => {
    expect(mergeWidgetActivities({}, connected([thread], "cached"))).toMatchObject({
      activeCount: 0,
      activities: [{ phase: "stale", status: "Update delayed" }],
    });
    expect(mergeWidgetActivities({}, connected([thread]))).toMatchObject({
      activeCount: 1,
      activities: [{ phase: "running" }],
    });
    expect(mergeWidgetActivities({}, new Map())).toEqual({});
  });

  it("does not invent a combined count when relay rows are truncated", () => {
    const relay = mergeWidgetActivities({}, connected([thread]));
    const merged = mergeWidgetActivities({ ...relay, activeCount: 5 }, connected([thread]));
    expect(merged.activities).toHaveLength(1);
    expect(merged.activeCount).toBeNull();
  });

  it("preserves unknown activity when all five displayed relay rows are locally removed", () => {
    const row = mergeWidgetActivities({}, connected([thread])).activities![0]!;
    const relay = {
      activeCount: 6,
      updatedAt: now,
      activities: Array.from({ length: 5 }, (_, index) => ({
        ...row,
        threadId: `thread-${index}`,
      })),
    };
    expect(mergeWidgetActivities(relay, connected([]))).toMatchObject({
      activities: [],
      activeCount: null,
      updatedAt: now,
    });
    expect(mergeWidgetActivities({ ...relay, activeCount: 5 }, connected([]))).toEqual({});
  });

  it("deduplicates connected environments while retaining other relay environments", () => {
    const relay = mergeWidgetActivities({}, connected([thread]));
    const row = relay.activities![0]!;
    const merged = mergeWidgetActivities(
      { ...relay, activities: [row, { ...row, environmentId: "remote" }] },
      connected([{ ...thread, pendingRuntimeRequest: approval }]),
    );
    expect(merged.activeCount).toBe(2);
    expect(merged.activities).toEqual([
      { ...row, environmentId: "remote" },
      { ...row, phase: "waiting_for_approval", status: "Approval needed" },
    ]);
  });
});
