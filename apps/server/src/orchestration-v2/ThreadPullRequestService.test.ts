import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { GitManager, type GitBranchPullRequest } from "../git/GitManager.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { PullRequestService } from "../pullRequest/PullRequestService.ts";
import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";
import { ServerActivation } from "../serverActivation.ts";
import { OrchestratorV2 } from "./Orchestrator.ts";
import * as ThreadPullRequestService from "./ThreadPullRequestService.ts";

const NOW = DateTime.makeUnsafe("2026-09-01T12:00:00.000Z");
const projectId = ProjectId.make("project:branch-pr");
const repository = "owner/repository";
const repositoryKey = `github.com/${repository}`;

const project = {
  id: projectId,
  title: "Project",
  workspaceRoot: "/workspace/project",
  repositoryIdentity: {
    canonicalKey: repositoryKey,
    displayName: repository,
    rootPath: "/workspace/project",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: `git@github.com:${repository}.git`,
    },
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
} satisfies OrchestrationProjectShell;

function thread(id: string): OrchestrationV2ThreadShell {
  const threadId = ThreadId.make(id);
  return {
    id: threadId,
    projectId,
    title: id,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feature",
    worktreePath: null,
    linkedPullRequest: null,
    branchPullRequest: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    activeRunId: null,
    activityRunStatus: null,
    status: "idle",
    lastError: null,
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    lastVisitedAt: null,
    titleRegeneration: null,
    deletedAt: null,
  };
}

function detectedPullRequest(): GitBranchPullRequest {
  return {
    number: 42,
    title: "Branch pull request",
    url: `https://github.com/${repository}/pull/42`,
    baseRef: "main",
    headRef: "feature",
    repositoryKey,
    state: "open",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };
}

describe("ThreadPullRequestServiceV2", () => {
  it.effect("discovers and persists a saved branch pull request without a client", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const activation = yield* Deferred.make<void>();
        const snapshotRead = yield* Queue.unbounded<void>();
        const commands = yield* Ref.make<
          ReadonlyArray<Extract<OrchestrationV2Command, { type: "thread.pull-request.sync" }>>
        >([]);
        const branchCalls = yield* Ref.make<ReadonlyArray<{ refresh: boolean }>>([]);
        let uuid = 0;
        const branchPullRequest: GitManager["Service"]["branchPullRequest"] = (_input, options) =>
          Ref.update(branchCalls, (calls) => [
            ...calls,
            { refresh: options?.refresh === true },
          ]).pipe(Effect.as(detectedPullRequest()));
        const dependencies = Layer.mergeAll(
          Layer.mock(OrchestratorV2)({
            getShellSnapshot: () =>
              Queue.offer(snapshotRead, undefined).pipe(
                Effect.as({
                  schemaVersion: 1,
                  snapshotSequence: 1,
                  threads: [thread("thread:branch-pr")],
                  archivedThreads: [],
                }),
              ),
            dispatch: (command) => {
              if (command.type !== "thread.pull-request.sync") {
                return Effect.die(`Unexpected command ${command.type}`);
              }
              return Ref.update(commands, (recorded) => [...recorded, command]).pipe(
                Effect.as({ sequence: 1, storedEvents: [] }),
              );
            },
            streamDomainEvents: Stream.never,
          }),
          Layer.mock(ProjectionSnapshotQuery)({
            getProjectShellsWithoutEnrichment: () => Effect.succeed([project]),
          }),
          Layer.mock(GitManager)({ branchPullRequest }),
          Layer.mock(PullRequestService)({
            summary: () => Effect.die("No existing pull request needs a summary"),
          }),
          Layer.mock(RepositoryIdentityResolver)({
            resolve: () => Effect.succeed(project.repositoryIdentity),
          }),
          Layer.succeed(ServerActivation, Deferred.await(activation)),
          Layer.succeed(
            Crypto.Crypto,
            Crypto.make({
              randomBytes: (size) => new Uint8Array(size).fill(++uuid),
              digest: (_algorithm, data) => Effect.succeed(data),
            }),
          ),
          FileSystem.layerNoop({ exists: () => Effect.succeed(false) }),
        );

        yield* Effect.gen(function* () {
          const service = yield* ThreadPullRequestService.ThreadPullRequestServiceV2;
          yield* service.start();
          yield* Deferred.succeed(activation, undefined);
          yield* Queue.take(snapshotRead);
          yield* service.drain;

          expect(yield* Ref.get(branchCalls)).toEqual([{ refresh: false }, { refresh: false }]);
          const [command] = yield* Ref.get(commands);
          expect(command).toMatchObject({
            type: "thread.pull-request.sync",
            threadId: "thread:branch-pr",
            projectId,
            snapshotAt: NOW,
            expected: {
              branch: "feature",
              worktreePath: null,
              linkedPullRequest: null,
              branchPullRequest: null,
            },
            branchPullRequest: {
              projectId,
              repository,
              number: 42,
              url: `https://github.com/${repository}/pull/42`,
            },
          });
        }).pipe(Effect.provide(ThreadPullRequestService.layer.pipe(Layer.provide(dependencies))));
      }),
    ),
  );
});
