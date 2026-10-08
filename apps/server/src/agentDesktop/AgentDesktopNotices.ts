/**
 * Tells threads when the user hands a desktop back, so an agent that asked for
 * help, or found its input refused, carries on without polling.
 *
 * @module AgentDesktopNotices
 */
import { CommandId, MessageId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as AgentDesktopService from "./AgentDesktopService.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const desktops = yield* AgentDesktopService.AgentDesktopService;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    yield* desktops.handBacks.pipe(
      Stream.runForEach((handBack) =>
        Effect.forEach(
          handBack.threadIds,
          (threadId) =>
            Effect.gen(function* () {
              const shell = yield* threads.getThreadShell(threadId);
              if (shell === null) return;
              const now = yield* Clock.currentTimeMillis;
              const id = `notice:agent-desktop:${handBack.desktopId}:${threadId}:${now}`;
              yield* threads.sendToThread({
                projectId: shell.projectId,
                commandId: CommandId.make(id),
                threadId,
                messageId: MessageId.make(id),
                text: `The user handed desktop ${handBack.title} (${handBack.desktopId}) back to you. Take a fresh screenshot before acting: they may have changed what's on screen.`,
                attachments: [],
                mode: "queue",
                createdBy: "agent",
                creationSource: "server",
                notification: {
                  source: { kind: "command" },
                  outcome: "updated",
                  summary: `Desktop ${handBack.title} handed back`,
                },
              });
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("couldn't post a desktop hand-back notice", { cause }),
              ),
            ),
          { discard: true },
        ),
      ),
      Effect.forkScoped,
    );
  }),
);
