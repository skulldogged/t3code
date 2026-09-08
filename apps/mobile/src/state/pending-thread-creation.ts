import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import {
  presentThreadShell,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { DEFAULT_PROVIDER_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { Atom } from "effect/unstable/reactivity";

import type { ThreadFeedEntry } from "../lib/threadActivity";
import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import type { QueuedThreadMessage } from "./thread-outbox-model";

/**
 * A new task navigates to its thread screen the moment it is queued, before the
 * server has created the thread. Until the shell arrives the screen renders a
 * stand-in built from the queued creation. The outcome recorded by the outbox
 * drain covers the two windows that stand-in cannot: the gap between delivery
 * and the first run (keep showing setup) and a rejected creation
 * (the drain restored the content into the project draft; offer to reopen it).
 */
export type PendingThreadCreationOutcome =
  | { readonly kind: "delivered"; readonly message: QueuedThreadMessage }
  | { readonly kind: "failed"; readonly message: QueuedThreadMessage; readonly reason: string };

export type PendingThreadCreation = {
  readonly message: QueuedThreadMessage;
  readonly outcome: PendingThreadCreationOutcome | null;
};

const TERMINAL_STARTUP_STATUSES = new Set(["failed", "cancelled", "interrupted", "rolled_back"]);

/** Keep the screen's creation state until its V2 projection can take over. */
export function resolvePendingThreadCreation(input: {
  readonly threadKey: string | null;
  readonly pending: PendingThreadCreation | null;
  readonly previous: PendingThreadCreation | null;
  readonly detail: {
    readonly messages: ReadonlyArray<{ readonly id: string }>;
    readonly latestRun: { readonly runId: string; readonly status: string } | null;
    readonly runtime: { readonly status: string } | null;
  } | null;
}): PendingThreadCreation | null {
  const creation = input.pending ?? input.previous;
  if (
    creation === null ||
    scopedThreadKey(creation.message.environmentId, creation.message.threadId) !== input.threadKey
  ) {
    return null;
  }
  if (creation.outcome?.kind === "failed") return creation;
  const detail = input.detail;
  if (detail?.runtime && TERMINAL_STARTUP_STATUSES.has(detail.runtime.status)) {
    return null;
  }
  // Message delivery and run startup are separate events. The prompt alone
  // cannot replace the preparing pill; wait for the run's timing too. Retain
  // the local creation if the outbox has already collected its shell outcome.
  if (
    detail !== null &&
    detail.latestRun !== null &&
    !isPendingThreadCreationVisible({
      creationMessageId: creation.message.messageId,
      loadedMessageIds: detail.messages.map((message) => message.id),
    })
  ) {
    return null;
  }
  return creation;
}

export const pendingThreadCreationOutcomesAtom = Atom.make<
  Readonly<Record<string, PendingThreadCreationOutcome>>
>({}).pipe(Atom.keepAlive, Atom.withLabel("mobile:pending-thread-creation:outcomes"));

export function recordPendingThreadCreationOutcome(outcome: PendingThreadCreationOutcome): void {
  const key = scopedThreadKey(outcome.message.environmentId, outcome.message.threadId);
  appAtomRegistry.set(pendingThreadCreationOutcomesAtom, {
    ...appAtomRegistry.get(pendingThreadCreationOutcomesAtom),
    [key]: outcome,
  });
}

export function clearPendingThreadCreationOutcome(threadKey: string): void {
  const current = appAtomRegistry.get(pendingThreadCreationOutcomesAtom);
  if (!current[threadKey]) {
    return;
  }
  const next = { ...current };
  delete next[threadKey];
  appAtomRegistry.set(pendingThreadCreationOutcomesAtom, next);
}

/**
 * Whether the queued prompt still has to stand in for the real message.
 *
 * The server creates the thread, then builds the worktree, and only then
 * starts the run, so the thread shell and an empty projection arrive seconds
 * ahead of the prompt. The queued message id is reused as the delivered
 * message id, so its presence is the exact signal.
 */
export function isPendingThreadCreationVisible(input: {
  readonly creationMessageId: string;
  /** Null while no projection has loaded; empty during a worktree checkout. */
  readonly loadedMessageIds: ReadonlyArray<string> | null;
}): boolean {
  return !input.loadedMessageIds?.includes(input.creationMessageId);
}

export function pendingThreadCreationMessage(
  message: QueuedThreadMessage,
): Extract<ThreadFeedEntry, { readonly type: "message" }> {
  return {
    type: "message",
    id: message.messageId,
    createdAt: message.createdAt,
    message: {
      id: message.messageId,
      role: "user",
      text: message.text,
      // Deliberately no attachments. Their ids are local draft ids the server
      // cannot resolve, so rows would spin until the real message arrives.
      attachments: [],
      runId: null,
      streaming: false,
      inputIntent: "turn_start",
      createdBy: "user",
      creationSource: "mobile",
      visibility: "synthetic",
      sourceThreadId: message.threadId,
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
    },
  };
}

/** Thread shell shaped from a queued creation before the server projects it. */
export function pendingThreadCreationShell(
  message: QueuedThreadMessage,
): EnvironmentThreadShell | null {
  const creation = message.creation;
  const modelSelection = message.modelSelection;
  if (!creation || !modelSelection) {
    return null;
  }
  const createdAt = DateTime.makeUnsafe(message.createdAt);
  return presentThreadShell(message.environmentId, {
    id: message.threadId,
    projectId: creation.projectId,
    title: deriveThreadTitleSeed({ text: message.text, attachments: message.attachments }),
    providerInstanceId: modelSelection.instanceId,
    modelSelection,
    runtimeMode: message.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode: message.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: creation.branch,
    worktreePath: creation.workspaceMode === "worktree" ? null : creation.worktreePath,
    linkedPullRequest: null,
    branchPullRequest: null,
    lineage: {
      rootThreadId: message.threadId,
      parentThreadId: null,
      relationshipToParent: null,
    },
    forkedFrom: null,
    activeProviderThreadId: null,
    createdBy: "user",
    creationSource: "mobile",
    latestRunId: null,
    activeRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: createdAt,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    itemCount: 0,
    visibleItemCount: 0,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    deletedAt: null,
  });
}
