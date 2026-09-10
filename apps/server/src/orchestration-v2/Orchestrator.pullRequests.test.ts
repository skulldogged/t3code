import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { OrchestratorV2 } from "./Orchestrator.ts";
import { makeLayer as makeProviderAdapterRegistryLayer } from "./ProviderAdapterRegistry.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./testkit/ProviderReplayHarness.ts";

const projectId = ProjectId.make("pull-request-project");
const threadId = ThreadId.make("pull-request-thread");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };

const createThread: OrchestrationV2Command = {
  type: "thread.create",
  createdBy: "user",
  creationSource: "web",
  commandId: CommandId.make("create-thread"),
  threadId,
  projectId,
  title: "Pull requests",
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
};

const link = (commandId: string, number: number, repository = "owner/repository") => ({
  type: "thread.pull-request.link" as const,
  commandId: CommandId.make(commandId),
  threadId,
  host: "github.com",
  repository,
  number,
  url: `https://github.com/${repository}/pull/${number}`,
  source: "manual" as const,
});

const unlink = (commandId: string, number: number, repository = "owner/repository") => ({
  type: "thread.pull-request.unlink" as const,
  commandId: CommandId.make(commandId),
  threadId,
  host: "github.com",
  repository,
  number,
});

const sync = (
  commandId: string,
  number: number,
  overrides: Partial<{
    readonly title: string;
    readonly syncedAt: string;
  }> = {},
) => ({
  type: "thread.pull-request-link.sync" as const,
  commandId: CommandId.make(commandId),
  threadId,
  host: "github.com",
  repository: "owner/repository",
  number,
  snapshot: {
    state: "open" as const,
    title: overrides.title ?? "Pull request",
    headBranch: "feature",
    baseBranch: "main",
    isDraft: false,
    updatedAt: "2026-09-01T00:00:00.000Z",
    syncedAt: overrides.syncedAt ?? "2026-09-01T00:00:00.000Z",
    closedAt: null,
    mergedAt: null,
  },
  stack: null,
});

const makeLayer = () =>
  makeOrchestratorV2ReplayLayerWithRegistry(
    { name: "orchestrator-pull-requests" },
    makeProviderAdapterRegistryLayer([]),
    { runEffectWorker: false },
  );

const withOrchestrator = <A, E>(effect: Effect.Effect<A, E, OrchestratorV2>) =>
  effect.pipe(Effect.provide(makeLayer()));

describe("OrchestratorV2 pull request commands", () => {
  it.effect("persists multiple links and rejects a case-insensitive duplicate", () =>
    withOrchestrator(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorV2;
        yield* orchestrator.dispatch(createThread);
        yield* orchestrator.dispatch(link("link-one", 1));
        yield* orchestrator.dispatch(link("link-two", 2));
        const error = yield* Effect.flip(
          orchestrator.dispatch(link("duplicate", 1, "OWNER/REPOSITORY")),
        );
        assert.strictEqual(
          error._tag === "OrchestratorDispatchError" ? error.reason : undefined,
          "pull-request-already-linked",
        );
        const snapshot = yield* orchestrator.getShellSnapshot();
        assert.deepStrictEqual(
          snapshot.threads[0]?.pullRequests.map((entry) => entry.number),
          [1, 2],
        );
      }),
    ),
  );

  it.effect("removes a normal link and leaves a stack link dismissed across reads", () =>
    withOrchestrator(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorV2;
        yield* orchestrator.dispatch(createThread);
        yield* orchestrator.dispatch(link("link-normal", 1));
        yield* orchestrator.dispatch(link("link-stack", 2, "owner/repository"));
        const before = yield* orchestrator.getShellSnapshot();
        const stackLink = {
          ...before.threads[0]!.pullRequests.find((entry) => entry.number === 2)!,
          source: "stack" as const,
        };
        yield* orchestrator.dispatch({
          ...sync("sync-stack", 2),
          stack: {
            kind: "native" as const,
            id: "stack",
            number: 2,
            url: stackLink.url,
            base: "main",
            layers: [{ number: 2, headBranch: "feature", state: "open" as const }],
          },
        });
        yield* orchestrator.dispatch(unlink("unlink-normal", 1));
        yield* orchestrator.dispatch(unlink("unlink-stack", 2));
        const after = yield* orchestrator.getShellSnapshot();
        assert.deepStrictEqual(
          after.threads[0]?.pullRequests.map((entry) => entry.source),
          ["stack-dismissed"],
        );
      }),
    ),
  );

  it.effect("synces an existing link without changing its thread timestamp", () =>
    withOrchestrator(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorV2;
        yield* orchestrator.dispatch(createThread);
        yield* orchestrator.dispatch(link("link", 3));
        const linked = yield* orchestrator.getShellSnapshot();
        yield* orchestrator.dispatch(sync("sync", 3));
        const first = yield* orchestrator.getShellSnapshot();
        assert.strictEqual(
          first.threads[0] === undefined
            ? undefined
            : DateTime.formatIso(first.threads[0].updatedAt),
          linked.threads[0] === undefined
            ? undefined
            : DateTime.formatIso(linked.threads[0].updatedAt),
        );
        assert.strictEqual(first.threads[0]?.pullRequests[0]?.snapshot?.title, "Pull request");
        // Missing links are an idempotent sync no-op, re-emitted as an unchanged
        // event so the command still produces a durable receipt.
        const missing = yield* orchestrator.dispatch(sync("sync-missing", 99));
        assert.lengthOf(missing.storedEvents, 1);
      }),
    ),
  );

  it.effect("ignores stale syncs and dismissed links without emitting events", () =>
    withOrchestrator(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorV2;
        yield* orchestrator.dispatch(createThread);
        yield* orchestrator.dispatch(link("link", 4));
        yield* orchestrator.dispatch({
          ...sync("sync-new", 4, { title: "New", syncedAt: "2026-09-02T00:00:00.000Z" }),
          stack: {
            kind: "native" as const,
            id: "stack",
            number: 4,
            url: "https://github.com/owner/repository/stack/4",
            base: "main",
            layers: [{ number: 4, headBranch: "feature", state: "open" as const }],
          },
        });
        const before = yield* orchestrator.getShellSnapshot();
        const stale = yield* orchestrator.dispatch(
          sync("sync-stale", 4, { title: "Old", syncedAt: "2026-09-01T00:00:00.000Z" }),
        );
        // Stale host data is acknowledged by re-emitting the unchanged link.
        assert.lengthOf(stale.storedEvents, 1);
        const after = yield* orchestrator.getShellSnapshot();
        assert.strictEqual(after.threads[0]?.pullRequests[0]?.snapshot?.title, "New");
        assert.strictEqual(
          after.threads[0] === undefined
            ? undefined
            : DateTime.formatIso(after.threads[0].updatedAt),
          before.threads[0] === undefined
            ? undefined
            : DateTime.formatIso(before.threads[0].updatedAt),
        );
        yield* orchestrator.dispatch(unlink("dismiss", 4));
        const dismissed = yield* orchestrator.dispatch(sync("sync-dismissed", 4));
        // A dismissed stack tombstone remains hidden and is acknowledged unchanged.
        assert.lengthOf(dismissed.storedEvents, 1);
        const final = yield* orchestrator.getShellSnapshot();
        assert.deepStrictEqual(
          final.threads[0]?.pullRequests.map((entry) => entry.source),
          ["stack-dismissed"],
        );
      }),
    ),
  );

  it.effect("normalizes a legacy single linked PR and keeps it removed after a fresh read", () =>
    withOrchestrator(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorV2;
        yield* orchestrator.dispatch(createThread);
        yield* orchestrator.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("legacy-link"),
          threadId,
          linkedPullRequest: {
            projectId,
            repository: "owner/repository",
            number: 9,
            url: "https://github.com/owner/repository/pull/9",
          },
        });
        const legacy = yield* orchestrator.getThreadShell(threadId);
        assert.deepStrictEqual(
          legacy?.pullRequests.map((entry) => entry.number),
          [9],
        );
        yield* orchestrator.dispatch(unlink("legacy-unlink", 9));
        const reloaded = yield* orchestrator.getThreadShell(threadId);
        assert.deepStrictEqual(reloaded?.pullRequests, []);
        assert.strictEqual(reloaded?.linkedPullRequest, null);
      }),
    ),
  );
});
