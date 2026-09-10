import {
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { PullRequestOperationError, type ThreadPullRequestKey } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";

export const listLinkedPullRequestThreads = Effect.fn("listLinkedPullRequestThreads")(
  function* (input: ThreadPullRequestKey) {
    const engine = yield* OrchestratorV2;
    const active = yield* engine.getShellSnapshot();
    const archived = yield* engine.getShellSnapshot({ location: "archive" });
    const threads = [...active.threads, ...archived.archivedThreads]
      .filter(
        (thread) =>
          thread.deletedAt === null &&
          visibleThreadPullRequests(thread.pullRequests).some((link) =>
            threadPullRequestKeysEqual(link, input),
          ),
      )
      .sort(
        (a, b) =>
          DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt) ||
          a.id.localeCompare(b.id),
      )
      .map((thread) => ({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        archivedAt: thread.archivedAt === null ? null : DateTime.formatIso(thread.archivedAt),
      }));
    return { threads };
  },
  Effect.mapError(
    (cause) =>
      new PullRequestOperationError({
        operation: "linkedThreads",
        detail: "Could not load linked threads.",
        cause,
      }),
  ),
);
