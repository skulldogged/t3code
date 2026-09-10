import { assert, expect, it } from "@effect/vitest";
import {
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ThreadShellSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { listLinkedPullRequestThreads } from "./linkedThreads.ts";

const createdAt = DateTime.makeUnsafe("2026-09-01T00:00:00.000Z");
const archivedAt = DateTime.makeUnsafe("2026-09-03T00:00:00.000Z");

function makeThread(input: {
  readonly id: string;
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly source: "manual" | "created" | "stack-dismissed";
  readonly archived?: boolean;
  readonly deleted?: boolean;
}): OrchestrationV2ThreadShell {
  return {
    id: input.id,
    projectId: "project-1",
    title: input.id,
    pullRequests: [
      {
        host: input.host,
        repository: input.repository,
        number: input.number,
        url: "https://github.com/acme/web/pull/7",
        source: input.source,
        linkedAt: "2026-09-01T00:00:00.000Z",
        snapshot: null,
        stack: null,
      },
    ],
    updatedAt: input.archived ? archivedAt : createdAt,
    archivedAt: input.archived ? archivedAt : null,
    deletedAt: input.deleted ? archivedAt : null,
  } as unknown as OrchestrationV2ThreadShell;
}

function makeSnapshot(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
): OrchestrationV2ThreadShellSnapshot {
  return {
    schemaVersion: 1,
    snapshotSequence: 1,
    threads: threads.filter((thread) => thread.archivedAt === null),
    archivedThreads: threads.filter((thread) => thread.archivedAt !== null),
  };
}

it.effect(
  "finds active and archived threads for exactly one pull request, excluding deleted and dismissed links",
  () => {
    const snapshot = makeSnapshot([
      makeThread({
        id: "azure",
        host: "dev.azure.com",
        repository: "org/project/_git/web",
        number: 7,
        source: "manual",
      }),
      makeThread({
        id: "other-org",
        host: "dev.azure.com",
        repository: "other/project/_git/web",
        number: 7,
        source: "manual",
      }),
      makeThread({
        id: "active",
        host: "github.com",
        repository: "acme/web",
        number: 7,
        source: "manual",
      }),
      makeThread({
        id: "archived",
        host: "github.com",
        repository: "acme/web",
        number: 7,
        source: "created",
        archived: true,
      }),
      makeThread({
        id: "deleted",
        host: "github.com",
        repository: "acme/web",
        number: 7,
        source: "manual",
        deleted: true,
      }),
      makeThread({
        id: "dismissed",
        host: "github.com",
        repository: "acme/web",
        number: 7,
        source: "stack-dismissed",
      }),
      makeThread({
        id: "other-host",
        host: "github.example.com",
        repository: "acme/web",
        number: 7,
        source: "manual",
      }),
      makeThread({
        id: "other-repository",
        host: "github.com",
        repository: "acme/api",
        number: 7,
        source: "manual",
      }),
      makeThread({
        id: "other-number",
        host: "github.com",
        repository: "acme/web",
        number: 8,
        source: "manual",
      }),
    ]);
    const layer = Layer.mock(OrchestratorV2)({
      getShellSnapshot: (options) =>
        Effect.succeed(
          options?.location === "archive"
            ? { ...snapshot, threads: [] }
            : { ...snapshot, archivedThreads: [] },
        ),
    });
    return Effect.gen(function* () {
      expect(
        (yield* listLinkedPullRequestThreads({
          host: "org.visualstudio.com",
          repository: "project/_git/web",
          number: 7,
        })).threads.map((thread) => thread.id),
      ).toEqual(["azure"]);
      expect(
        yield* listLinkedPullRequestThreads({
          host: "GitHub.Com",
          repository: "ACME/WEB",
          number: 7,
        }),
      ).toEqual({
        threads: [
          {
            id: "archived",
            projectId: "project-1",
            title: "archived",
            archivedAt: "2026-09-03T00:00:00.000Z",
          },
          { id: "active", projectId: "project-1", title: "active", archivedAt: null },
        ],
      });
      assert.deepStrictEqual(
        yield* listLinkedPullRequestThreads({
          host: "github.com",
          repository: "acme/web",
          number: 99,
        }),
        { threads: [] },
      );
    }).pipe(Effect.provide(layer));
  },
);
