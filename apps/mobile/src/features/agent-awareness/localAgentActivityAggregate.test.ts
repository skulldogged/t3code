import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  EnvironmentId,
  ProjectId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  buildLocalAgentActivityAggregate,
  buildLocalAgentAwarenessStates,
} from "./localAgentActivityAggregate";
import { makeRawThreadShell } from "../../test-fixtures";

function makeProject(
  input: Partial<EnvironmentProject> & Pick<EnvironmentProject, "environmentId" | "id" | "title">,
): EnvironmentProject {
  return {
    workspaceRoot: `/workspaces/${input.id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...input,
  };
}

function makeThread(
  input: Partial<OrchestrationV2ThreadShell> &
    Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId" | "title">,
): EnvironmentThreadShell {
  return presentThreadShell(input.environmentId, makeRawThreadShell(input));
}

describe("buildLocalAgentActivityAggregate", () => {
  it("clears completed work and reflects a new V2 run or input request", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const project = makeProject({
      environmentId,
      id: ProjectId.make("project-1"),
      title: "T3 Code",
    });
    const input = (updates: Partial<OrchestrationV2ThreadShell>) => ({
      projects: [project],
      threads: [
        makeThread({
          environmentId,
          id: ThreadId.make("thread-1"),
          projectId: project.id,
          title: "Task",
          ...updates,
        }),
      ],
    });
    expect(buildLocalAgentActivityAggregate(input({ status: "running" }))?.activeCount).toBe(1);
    expect(buildLocalAgentAwarenessStates(input({ status: "completed" }))[0]?.phase).toBe(
      "completed",
    );
    expect(buildLocalAgentActivityAggregate(input({ status: "completed" }))).toBeNull();
    expect(buildLocalAgentAwarenessStates(input({ status: "starting" }))[0]?.phase).toBe(
      "starting",
    );
    expect(
      buildLocalAgentActivityAggregate(
        input({
          status: "waiting",
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("input-1"),
            kind: "user_input",
            createdAt: DateTime.makeUnsafe("2026-06-29T11:00:00.000Z"),
          },
        }),
      )?.activities[0]?.phase,
    ).toBe("waiting_for_input");
    expect(
      buildLocalAgentActivityAggregate(
        input({ status: "running", archivedAt: DateTime.makeUnsafe("2026-06-29T11:00:00.000Z") }),
      ),
    ).toBeNull();
    expect(
      buildLocalAgentActivityAggregate(
        input({ status: "running", deletedAt: DateTime.makeUnsafe("2026-06-29T11:00:00.000Z") }),
      ),
    ).toBeNull();
  });

  it("returns null when no threads are actively working", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const project = makeProject({
      environmentId,
      id: ProjectId.make("project-1"),
      title: "T3 Code",
    });
    const aggregate = buildLocalAgentActivityAggregate({
      projects: [project],
      threads: [
        makeThread({
          environmentId,
          id: ThreadId.make("thread-1"),
          projectId: project.id,
          title: "Idle thread",
        }),
      ],
    });
    expect(aggregate).toBeNull();
  });

  it("aggregates running and approval threads with newest activity first", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const project = makeProject({
      environmentId,
      id: ProjectId.make("project-1"),
      title: "T3 Code",
    });
    const aggregate = buildLocalAgentActivityAggregate({
      projects: [project],
      threads: [
        makeThread({
          environmentId,
          id: ThreadId.make("thread-running"),
          projectId: project.id,
          title: "Running thread",
          updatedAt: DateTime.makeUnsafe("2026-06-29T10:00:00.000Z"),
          status: "running",
        }),
        makeThread({
          environmentId,
          id: ThreadId.make("thread-approval"),
          projectId: project.id,
          title: "Approval thread",
          updatedAt: DateTime.makeUnsafe("2026-06-29T11:00:00.000Z"),
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("approval-1"),
            kind: "command",
            createdAt: DateTime.makeUnsafe("2026-06-29T11:00:00.000Z"),
          },
        }),
      ],
    });

    expect(aggregate).toEqual({
      title: "T3 Code",
      subtitle: "Agent work in progress",
      activeCount: 2,
      updatedAt: "2026-06-29T11:00:00.000Z",
      activities: [
        expect.objectContaining({
          threadId: ThreadId.make("thread-approval"),
          phase: "waiting_for_approval",
          status: "Approval",
        }),
        expect.objectContaining({
          threadId: ThreadId.make("thread-running"),
          phase: "running",
          status: "Working",
        }),
      ],
    });
  });
});
