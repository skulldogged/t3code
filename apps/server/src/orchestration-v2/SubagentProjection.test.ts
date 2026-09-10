import { assert, it } from "@effect/vitest";
import {
  type ModelSelection,
  NodeId,
  RunId,
  RunAttemptId,
  MessageId,
  EventId,
  TurnItemId,
  type OrchestrationV2Run,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  makeSubagentChildThread,
  delegatedTaskProgress,
  subagentResultForRun,
  restoreDelegatedCompletionMetadata,
  makeSubagentConversationArtifacts,
} from "./SubagentProjection.ts";

import { emptyProjection } from "./ProjectionStore.ts";

const parentThreadId = ThreadId.make("thread:subagent-snoozed-parent");
const childThreadId = ThreadId.make("thread:subagent-awake-child");
const parentProviderInstanceId = ProviderInstanceId.make("codex");
const childProviderInstanceId = ProviderInstanceId.make("claude");
const parentModelSelection = {
  instanceId: parentProviderInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;
const childModelSelection = {
  instanceId: childProviderInstanceId,
  model: "claude-opus-4-1",
} satisfies ModelSelection;
const parentCreatedAt = DateTime.makeUnsafe("2026-07-24T09:00:00.000Z");
const snoozedAt = DateTime.makeUnsafe("2026-07-24T09:05:00.000Z");
const snoozedUntil = DateTime.makeUnsafe("2026-07-25T09:00:00.000Z");
const childCreatedAt = DateTime.makeUnsafe("2026-07-24T09:10:00.000Z");

function makeParentThread(): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: parentThreadId,
    projectId: ProjectId.make("project:subagent-snooze"),
    title: "Snoozed parent",
    providerInstanceId: parentProviderInstanceId,
    modelSelection: parentModelSelection,
    runtimeMode: "full-access",
    interactionMode: "plan",
    branch: "feature/source",
    worktreePath: "/tmp/source-worktree",
    pullRequests: [],
    activeProviderThreadId: ProviderThreadId.make("provider-thread:subagent-snoozed-parent"),
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: parentThreadId,
    },
    forkedFrom: null,
    createdAt: parentCreatedAt,
    updatedAt: snoozedAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    snoozedUntil,
    snoozedAt,
    deletedAt: null,
    historyOrigin: "v1_import",
  };
}

it("keeps a subagent child awake when its parent thread is snoozed", () => {
  const parentThread = makeParentThread();
  const childProviderThreadId = ProviderThreadId.make("provider-thread:subagent-awake-child");
  const parentNodeId = NodeId.make("node:subagent-parent");
  const childThread = makeSubagentChildThread({
    parentThread,
    childThreadId,
    parentNodeId,
    activeProviderThreadId: childProviderThreadId,
    providerInstanceId: childProviderInstanceId,
    modelSelection: childModelSelection,
    title: "Awake child",
    now: childCreatedAt,
    createdBy: "agent",
    creationSource: "provider",
  });

  assert.isNull(childThread.snoozedUntil);
  assert.isNull(childThread.snoozedAt);
  assert.equal(childThread.projectId, parentThread.projectId);
  assert.equal(childThread.runtimeMode, parentThread.runtimeMode);
  assert.equal(childThread.interactionMode, parentThread.interactionMode);
  assert.equal(childThread.branch, parentThread.branch);
  assert.equal(childThread.worktreePath, parentThread.worktreePath);
  assert.equal(childThread.providerInstanceId, childProviderInstanceId);
  assert.deepEqual(childThread.modelSelection, childModelSelection);
  assert.equal(childThread.activeProviderThreadId, childProviderThreadId);
  assert.isUndefined(childThread.historyOrigin);
  assert.deepEqual(childThread.lineage, {
    parentThreadId,
    relationshipToParent: "subagent",
    rootThreadId: parentThreadId,
  });
  assert.deepEqual(childThread.forkedFrom, {
    type: "node",
    nodeId: parentNodeId,
  });
});

function taskFixture() {
  const projection = emptyProjection({
    type: "thread.created",
    id: EventId.make("task-fixture"),
    threadId: parentThreadId,
    occurredAt: parentCreatedAt,
    payload: makeParentThread(),
  });
  const run: OrchestrationV2Run = {
    id: RunId.make("initial"),
    threadId: parentThreadId,
    ordinal: 1,
    providerInstanceId: parentProviderInstanceId,
    modelSelection: parentModelSelection,
    providerThreadId: null,
    userMessageId: MessageId.make("prompt"),
    rootNodeId: NodeId.make("root"),
    activeAttemptId: RunAttemptId.make("attempt"),
    status: "completed",
    requestedAt: parentCreatedAt,
    startedAt: parentCreatedAt,
    completedAt: childCreatedAt,
    checkpointId: null,
    contextHandoffId: null,
  };
  return { projection: { ...projection, runs: [run] }, run };
}

it("waits for nested work and retains the report across monitor acknowledgements", () => {
  const { projection, run } = taskFixture();
  assert.equal(
    delegatedTaskProgress({ ...projection, subagents: [{ status: "running" }] }).state,
    "waiting_for_children",
  );
  assert.equal(
    delegatedTaskProgress({ ...projection, subagents: [{ status: "completed" }] }).state,
    "result_available",
  );
  assert.equal(
    delegatedTaskProgress({
      ...projection,
      providerThreads: [{ pendingBackgroundTasks: [{ taskId: "background-audit" }] }],
    }).state,
    "waiting_for_children",
  );
  const pending = {
    ...run,
    id: RunId.make("followup"),
    ordinal: 2,
    status: "queued" as const,
    startedAt: null,
  };
  assert.equal(delegatedTaskProgress({ ...projection, runs: [run, pending] }).state, "working");
  const report = { ...pending, status: "completed" as const, startedAt: parentCreatedAt };
  const monitor = { ...report, id: RunId.make("monitor"), ordinal: 3 };
  const artifacts = makeSubagentConversationArtifacts({
    messageId: MessageId.make("monitor-message"),
    turnItemId: TurnItemId.make("monitor-item"),
    threadId: parentThreadId,
    rootNodeId: NodeId.make("root"),
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    role: "user",
    text: "Monitor update",
    ordinal: 3,
    now: childCreatedAt,
  });
  const progress = delegatedTaskProgress({
    ...projection,
    runs: [run, report, monitor],
    messages: [
      {
        ...artifacts.message,
        runId: monitor.id,
        notification: {
          source: { kind: "monitor" },
          outcome: "updated",
          summary: "Monitor update",
        },
      },
    ],
  });
  assert.equal(progress.state, "result_available");
  assert.equal(progress.resultRun?.id, report.id);
});

it("exposes the provider failure rather than a progress message from the failed run", () => {
  const { projection, run } = taskFixture();
  const failedRun = { ...run, status: "failed" as const };
  const artifacts = makeSubagentConversationArtifacts({
    messageId: MessageId.make("progress"),
    turnItemId: TurnItemId.make("error"),
    threadId: parentThreadId,
    rootNodeId: NodeId.make("root"),
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    role: "assistant",
    text: "Starting the audit.",
    ordinal: 1,
    now: childCreatedAt,
  });
  if (artifacts.turnItem.type !== "assistant_message") throw new Error("Expected assistant item");
  const failure = {
    class: "unknown" as const,
    message: "You've hit your usage limit. Try again Sep 14 at 7:20 PM.",
    code: null,
    retryable: false,
  };
  const result = subagentResultForRun(
    {
      ...projection,
      messages: [{ ...artifacts.message, runId: run.id }],
      turnItems: [{ ...artifacts.turnItem, type: "error", runId: run.id, failure }],
    },
    failedRun,
  );
  assert.equal(result.text, failure.message);
  assert.equal(result.turnItemId, artifacts.turnItem.id);
  assert.isNull(result.messageId);
});

function resultArtifacts(id: string, ordinal: number, text: string) {
  const runId = RunId.make("run:result");
  const artifacts = makeSubagentConversationArtifacts({
    messageId: MessageId.make(id),
    turnItemId: TurnItemId.make(`item:${id}`),
    threadId: childThreadId,
    rootNodeId: NodeId.make("node:result"),
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    role: "assistant",
    text,
    ordinal,
    now: childCreatedAt,
  });
  return {
    message: { ...artifacts.message, runId },
    turnItem: { ...artifacts.turnItem, runId },
  };
}

it("restores older completion turn items from message metadata without changing stored text", () => {
  const artifacts = makeSubagentConversationArtifacts({
    messageId: MessageId.make("old-completion"),
    turnItemId: TurnItemId.make("old-completion-item"),
    threadId: childThreadId,
    rootNodeId: NodeId.make("node:result"),
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    role: "user",
    text: "Original continuation with internal task IDs",
    ordinal: 1,
    now: childCreatedAt,
  });
  const delegatedCompletion = {
    parentRunId: RunId.make("parent-run"),
    generation: 1,
    taskIds: [NodeId.make("completed-task")],
  };
  const restored = restoreDelegatedCompletionMetadata({
    messages: [{ ...artifacts.message, role: "user", delegatedCompletion }],
    turnItems: [artifacts.turnItem],
  });
  const expected = { ...artifacts.turnItem, delegatedCompletion };
  assert.deepEqual(restored[0], expected);
  assert.equal(restored[0]?.type === "user_message" && restored[0].text, artifacts.message.text);
  assert.equal("delegatedCompletion" in artifacts.turnItem, false);
});

it("returns the final report when provider settlement gives all messages equal timestamps", () => {
  const opening = resultArtifacts("opening", 1, "I will investigate.");
  const report = resultArtifacts("report", 5, "Verified final report.");
  const empty = resultArtifacts("empty", 6, "  ");
  const other = resultArtifacts("other", 7, "Another run.");
  const result = subagentResultForRun(
    {
      messages: [
        opening.message,
        report.message,
        empty.message,
        { ...other.message, runId: RunId.make("run:other") },
      ],
      turnItems: [
        report.turnItem,
        opening.turnItem,
        empty.turnItem,
        { ...other.turnItem, runId: RunId.make("run:other") },
      ],
    },
    { id: RunId.make("run:result"), status: "completed" },
  );
  assert.deepEqual(result, {
    text: report.message.text,
    messageId: report.message.id,
    turnItemId: report.turnItem.id,
  });
});

it("uses the final turn item when its conversation message is unavailable", () => {
  const opening = resultArtifacts("opening", 1, "I will investigate.");
  const report = resultArtifacts("report", 5, "Verified final report.");
  const result = subagentResultForRun(
    { messages: [opening.message], turnItems: [opening.turnItem, report.turnItem] },
    { id: RunId.make("run:result"), status: "completed" },
  );
  assert.deepEqual(result, {
    text: report.message.text,
    messageId: report.message.id,
    turnItemId: report.turnItem.id,
  });
});

it("falls back to message creation order when turn items are unavailable", () => {
  const opening = resultArtifacts("opening", 1, "I will investigate.");
  const report = resultArtifacts("report", 5, "Verified final report.");
  const result = subagentResultForRun(
    {
      messages: [
        { ...opening.message, updatedAt: DateTime.makeUnsafe("2026-07-24T10:10:00.000Z") },
        { ...report.message, createdAt: DateTime.makeUnsafe("2026-07-24T10:00:00.000Z") },
      ],
      turnItems: [],
    },
    { id: RunId.make("run:result"), status: "completed" },
  );
  assert.deepEqual(result, {
    text: report.message.text,
    messageId: report.message.id,
    turnItemId: null,
  });
});

it("keeps an unsuccessful child's status when there is no result", () => {
  assert.deepEqual(
    subagentResultForRun(
      { messages: [], turnItems: [] },
      { id: RunId.make("run:result"), status: "failed" },
    ),
    { text: "Child task ended with status failed.", messageId: null, turnItemId: null },
  );
});
