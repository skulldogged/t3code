/**
 * "Worth knowing": after a run (and every few tool calls while a long run is
 * working), a hidden, tool-less fork of the thread's own provider session is
 * asked whether there is one thing the user should know but probably missed.
 * The fork shares the conversation's cached prefix, so it sees everything the
 * agent saw. Findings are kept per thread and streamed to clients.
 *
 * @module worthKnowing/WorthKnowingService
 */
import {
  type OrchestrationV2TurnItem,
  type ProjectId,
  type RunId,
  type ThreadId,
  WorthKnowingError,
  type WorthKnowingFinding,
  WorthKnowingFindingId,
  type WorthKnowingSummariesResult,
  type WorthKnowingThreadResult,
  type WorthKnowingUpdateFindingInput,
  type WorthKnowingUpdateFindingResult,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { turnItemText } from "../mcp/OrchestratorMcpService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { buildWorthKnowingPrompt, parseWorthKnowingReply } from "./WorthKnowingPrompt.ts";
import * as WorthKnowingStore from "./WorthKnowingStore.ts";

/** A long run is checked again after this many more finished tool calls. */
const TOOL_CALLS_PER_MID_RUN_CHECK = 15;
/**
 * Drivers checked only when a run ends. A Codex fork is a new conversation to
 * the prompt cache, so every check re-sends the whole thread uncached.
 */
const END_OF_RUN_ONLY_DRIVERS: ReadonlySet<string> = new Set(["codex"]);
const KNOWN_TOPICS_IN_PROMPT = 30;
/** Forks running at once across all threads; each is a provider process or request. */
const MAX_CONCURRENT_CHECKS = 2;
/** A check that runs longer than this is abandoned so the thread's queue moves on. */
const CHECK_TIMEOUT = "5 minutes";
/** How many run and message ids the event watcher remembers. */
const MAX_REMEMBERED_IDS = 5_000;
/** Runs still being counted toward a mid-run check. */
const MAX_REMEMBERED_RUNS = 200;
const PREVIOUS_FINDINGS_IN_PROMPT = 10;

const TOOL_ITEM_TYPES: ReadonlySet<OrchestrationV2TurnItem["type"]> = new Set([
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
  "subagent",
]);

interface CheckRequest {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly stillWorking: boolean;
}

export class WorthKnowingService extends Context.Service<
  WorthKnowingService,
  {
    /** Starts watching runs. Checks run in the background of the given scope. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly listThread: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<WorthKnowingFinding>, WorthKnowingError>;
    readonly subscribeThread: (
      threadId: ThreadId,
    ) => Stream.Stream<WorthKnowingThreadResult, WorthKnowingError>;
    readonly subscribeSummaries: () => Stream.Stream<
      WorthKnowingSummariesResult,
      WorthKnowingError
    >;
    readonly updateFinding: (
      input: WorthKnowingUpdateFindingInput,
    ) => Effect.Effect<WorthKnowingUpdateFindingResult, WorthKnowingError>;
  }
>()("t3/worthKnowing/WorthKnowingService") {}

/**
 * How many checks to skip after the user passed over findings `streak` times
 * in a row: none for the first two, then 1, 2, 4… up to 16, as Claude Code's
 * side agent does.
 */
export function checksToSkipAfterIgnoring(streak: number): number {
  return streak <= 2 ? 0 : Math.min(16, 2 ** (streak - 3));
}

/** Remembers an id, forgetting the oldest once the set is full. */
function remember<A>(set: Set<A>, value: A): void {
  set.add(value);
  if (set.size > MAX_REMEMBERED_IDS) {
    const oldest = set.values().next();
    if (!oldest.done) set.delete(oldest.value);
  }
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The item whose text contains the quote, preferring the latest. */
function findEvidenceItem(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  quote: string,
): OrchestrationV2TurnItem | undefined {
  const needles = [normalizeForMatch(quote)];
  if (needles[0]!.length > 60) needles.push(needles[0]!.slice(0, 60));
  for (const needle of needles) {
    if (needle.length < 8) continue;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index]!;
      const text = turnItemText(item);
      if (text !== null && normalizeForMatch(text).includes(needle)) return item;
    }
  }
  return undefined;
}

/** `/bin/bash -lc './x.sh 3'` reads better as `./x.sh 3`. */
function unwrapShellCommand(command: string): string {
  const wrapped = /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(command.trim());
  return wrapped?.[2] ?? command;
}

/** A short description of where evidence was found, for the card. */
function evidenceLabel(item: OrchestrationV2TurnItem): string | null {
  const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);
  switch (item.type) {
    case "command_execution":
      return `Output of ${clip(unwrapShellCommand(item.input.split("\n")[0] ?? item.input))}`;
    case "file_change":
      return `Change to ${item.fileName}`;
    case "assistant_message":
      return "The agent's message";
    case "dynamic_tool":
      return `Result of ${item.toolName}`;
    case "subagent":
      return "A subagent's result";
    case "web_search":
      return "A web search";
    case "file_search":
      return "A file search";
    case "error":
      return "An error";
    default:
      return item.title;
  }
}

const make = Effect.gen(function* () {
  const store = yield* WorthKnowingStore.WorthKnowingStore;
  const engine = yield* Orchestrator.OrchestratorV2;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const runtimePolicies = yield* RuntimePolicy.RuntimePolicyV2;
  const crypto = yield* Crypto.Crypto;
  const changes = yield* PubSub.unbounded<ThreadId>();
  const forkPermits = yield* Semaphore.make(MAX_CONCURRENT_CHECKS);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const notifyChanged = (threadId: ThreadId) =>
    PubSub.publish(changes, threadId).pipe(Effect.asVoid);

  const listThread: WorthKnowingService["Service"]["listThread"] = (threadId) =>
    store.listThread(threadId).pipe(Effect.map((rows) => rows.map((row) => row.finding)));

  const isEnabledFor = (projectId: ProjectId) =>
    serverSettings.getSettings.pipe(
      Effect.map((settings) => resolveProjectSettings(settings, projectId).settings),
      Effect.map((settings) => settings.worthKnowingEnabled),
      Effect.orElseSucceed(() => false),
    );

  const check = Effect.fn("WorthKnowingService.check")(function* (request: CheckRequest) {
    const records = yield* threads.getThreadRecords(
      request.threadId,
      ["runs", "providerThreads", "turnItems"],
      { runIds: [request.runId], turnItemRunIds: [request.runId] },
    );
    const thread = records.thread;
    if (
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.lineage.relationshipToParent === "subagent"
    ) {
      return;
    }
    if (!(yield* isEnabledFor(thread.projectId))) return;

    const run = records.runs.find((candidate) => candidate.id === request.runId);
    if (run === undefined) return;
    if (!request.stillWorking && run.status !== "completed" && run.status !== "interrupted") {
      return;
    }
    // A run that used no tools has nothing buried for the observer to dig out.
    if (!records.turnItems.some((item) => TOOL_ITEM_TYPES.has(item.type))) return;

    const providerThread = records.providerThreads.find(
      (candidate) => candidate.id === run.providerThreadId,
    );
    const nativeThreadId = providerThread?.nativeThreadRef?.nativeId ?? null;
    if (nativeThreadId === null) return;
    const instance = yield* providerInstances.getInstance(run.modelSelection.instanceId);
    const generateSideReply = instance?.textGeneration.generateSideReply;
    if (instance === undefined || generateSideReply === undefined) return;
    if (request.stillWorking && END_OF_RUN_ONLY_DRIVERS.has(instance.driverKind)) return;

    const projectState = yield* store.getProjectState(thread.projectId);
    if (projectState.checksToSkip > 0) {
      yield* store.setProjectState(thread.projectId, {
        ...projectState,
        checksToSkip: projectState.checksToSkip - 1,
      });
      return;
    }

    const runtimePolicy = yield* runtimePolicies.resolve({
      thread,
      modelSelection: run.modelSelection,
    });
    const project = yield* projects.get(thread.projectId);
    const cwd =
      runtimePolicy.cwd ??
      thread.worktreePath ??
      (Option.isSome(project) ? project.value.workspaceRoot : null);
    if (cwd === null) return;

    const prior = yield* store.listThread(request.threadId);
    // A finding the user restored stays open until they close it, so it is
    // only shown as already raised, never offered for resolving.
    const open = prior
      .filter((row) => row.finding.status === "open" && row.finding.restoredAt == null)
      .map((row, index) => ({ ref: `F${index + 1}`, finding: row.finding }));
    const previous = prior
      .filter((row) => row.finding.status !== "open" || row.finding.restoredAt != null)
      .slice(0, PREVIOUS_FINDINGS_IN_PROMPT)
      .map((row) => row.finding);
    const known = yield* store.listKnown(thread.projectId, KNOWN_TOPICS_IN_PROMPT);

    const reply = yield* forkPermits
      .withPermit(
        generateSideReply({
          threadId: request.threadId,
          nativeThreadId,
          cwd,
          modelSelection: run.modelSelection,
          runtimePolicy,
          prompt: buildWorthKnowingPrompt({
            stillWorking: request.stillWorking,
            open,
            previous,
            known,
          }),
        }),
      )
      .pipe(
        // A runtime that cannot fork (OpenCode 2) is skipped quietly, not logged per run.
        Effect.catchTag("TextGenerationError", (error) =>
          error.detail === TextGeneration.SIDE_REPLY_UNSUPPORTED
            ? Effect.succeed(undefined)
            : Effect.fail(error),
        ),
      );
    if (reply === undefined) return;
    const parsed = parseWorthKnowingReply(reply.text);
    if (parsed.finding === undefined && !/^\W*learn\W*:\s*none\b/im.test(reply.text)) {
      yield* Effect.logWarning("Worth knowing reply was not in the expected format", {
        threadId: request.threadId,
        runId: request.runId,
        reply: reply.text.slice(0, 1_500),
      });
    }
    const now = yield* nowIso;
    let changed = false;
    let resolvedCount = 0;

    for (const ref of parsed.resolved) {
      const target = open.find((candidate) => candidate.ref === ref);
      if (target === undefined) continue;
      // The user may have answered it while the fork was thinking.
      const current = yield* store.get(target.finding.id);
      if (current?.finding.status !== "open" || current.finding.restoredAt != null) continue;
      resolvedCount += 1;
      yield* store.update({
        ...current.finding,
        status: "resolved",
        resolvedByRunId: request.runId,
        updatedAt: now,
      });
      changed = true;
    }

    const raised = parsed.finding;
    const isRepeat =
      raised !== undefined &&
      prior.some(
        (row) =>
          normalizeForMatch(row.finding.learn) === normalizeForMatch(raised.learn) ||
          normalizeForMatch(row.finding.title) === normalizeForMatch(raised.title),
      );
    if (raised !== undefined && !isRepeat) {
      const evidenceItem =
        raised.evidence === null ? undefined : findEvidenceItem(records.turnItems, raised.evidence);
      const id = WorthKnowingFindingId.make(`wk_${yield* crypto.randomUUIDv4}`);
      yield* store.insert({
        id,
        threadId: request.threadId,
        projectId: thread.projectId,
        runId: request.runId,
        tag: raised.tag,
        learn: raised.learn,
        title: raised.title,
        body: raised.body,
        evidence:
          raised.evidence === null
            ? null
            : {
                quote: raised.evidence,
                itemId: evidenceItem?.id ?? null,
                runId: evidenceItem?.runId ?? null,
                label: evidenceItem === undefined ? null : evidenceLabel(evidenceItem),
              },
        status: "open",
        raisedMidRun: request.stillWorking,
        resolvedByRunId: null,
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
    }

    yield* Effect.logInfo("Worth knowing check finished", {
      threadId: request.threadId,
      runId: request.runId,
      stillWorking: request.stillWorking,
      raised: raised !== undefined && !isRepeat,
      resolved: resolvedCount,
      inputTokens: reply.usage?.inputTokens,
      cachedInputTokens: reply.usage?.cachedInputTokens,
      outputTokens: reply.usage?.outputTokens,
    });
    if (changed) yield* notifyChanged(request.threadId);
  });

  // Checks for one thread run one at a time; a run's end supersedes its own
  // pending mid-run check, and another run's checks wait their turn.
  const pending = new Map<ThreadId, Map<RunId, CheckRequest>>();
  const draining = new Set<ThreadId>();

  const drainThread = (threadId: ThreadId): Effect.Effect<void> =>
    Effect.gen(function* () {
      while (true) {
        const queue = pending.get(threadId);
        const next = queue?.values().next();
        if (queue === undefined || next === undefined || next.done) {
          // Same step as the queue check, so a request arriving now starts a new drain.
          pending.delete(threadId);
          draining.delete(threadId);
          return;
        }
        queue.delete(next.value.runId);
        yield* check(next.value).pipe(
          Effect.timeout(CHECK_TIMEOUT),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.logWarning("Worth knowing check failed", {
                  threadId,
                  runId: next.value.runId,
                  cause: Cause.pretty(cause),
                }),
          ),
        );
      }
    }).pipe(Effect.onInterrupt(() => Effect.sync(() => draining.delete(threadId))));

  const requestCheck = (scope: Scope.Scope, request: CheckRequest) =>
    Effect.suspend(() => {
      const queue = pending.get(request.threadId) ?? new Map<RunId, CheckRequest>();
      const queued = queue.get(request.runId);
      if (queued === undefined || queued.stillWorking) queue.set(request.runId, request);
      pending.set(request.threadId, queue);
      if (draining.has(request.threadId)) return Effect.void;
      draining.add(request.threadId);
      return drainThread(request.threadId).pipe(Effect.forkIn(scope), Effect.asVoid);
    });

  /** A user message sent past unanswered findings counts once toward backing off. */
  const recordPassedOver = (threadId: ThreadId, sentAt: string) =>
    Effect.gen(function* () {
      const marked = yield* store.markIgnored(threadId, sentAt);
      if (marked === 0) return;
      const records = yield* threads.getThreadRecords(threadId, []);
      const state = yield* store.getProjectState(records.thread.projectId);
      const ignoredStreak = state.ignoredStreak + 1;
      yield* store.setProjectState(records.thread.projectId, {
        ignoredStreak,
        checksToSkip: checksToSkipAfterIgnoring(ignoredStreak),
      });
    });

  const start: WorthKnowingService["Service"]["start"] = Effect.fn("WorthKnowingService.start")(
    function* () {
      const scope = yield* Effect.scope;
      const finishedToolItems = new Map<RunId, Set<string>>();
      // Finished runs are announced again (checkpoints, delegated results); check each once.
      const finishedRuns = new Set<RunId>();
      const seenUserMessages = new Set<string>();
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) => {
          switch (event.type) {
            case "turn-item.updated": {
              const item = event.payload;
              if (
                item.runId === null ||
                item.status !== "completed" ||
                !TOOL_ITEM_TYPES.has(item.type)
              ) {
                return Effect.void;
              }
              const finished = finishedToolItems.get(item.runId) ?? new Set<string>();
              if (finished.has(item.id)) return Effect.void;
              finished.add(item.id);
              finishedToolItems.set(item.runId, finished);
              // Runs that never report an end would otherwise stay here forever.
              if (finishedToolItems.size > MAX_REMEMBERED_RUNS) {
                const oldest = finishedToolItems.keys().next();
                if (!oldest.done) finishedToolItems.delete(oldest.value);
              }
              return finished.size % TOOL_CALLS_PER_MID_RUN_CHECK === 0
                ? requestCheck(scope, {
                    threadId: event.threadId,
                    runId: item.runId,
                    stillWorking: true,
                  })
                : Effect.void;
            }
            case "run.updated": {
              if (!ThreadManagementService.isTerminalRunStatus(event.payload.status)) {
                return Effect.void;
              }
              finishedToolItems.delete(event.payload.id);
              if (finishedRuns.has(event.payload.id)) return Effect.void;
              remember(finishedRuns, event.payload.id);
              return event.payload.status === "completed" || event.payload.status === "interrupted"
                ? requestCheck(scope, {
                    threadId: event.threadId,
                    runId: event.payload.id,
                    stillWorking: false,
                  })
                : Effect.void;
            }
            case "message.updated": {
              const message = event.payload;
              if (
                message.role !== "user" ||
                message.createdBy !== "user" ||
                seenUserMessages.has(message.id)
              ) {
                return Effect.void;
              }
              remember(seenUserMessages, message.id);
              return recordPassedOver(message.threadId, DateTime.formatIso(message.createdAt)).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("Worth knowing could not record passed-over findings", {
                    threadId: message.threadId,
                    cause,
                  }),
                ),
              );
            }
            case "thread.deleted":
              return store.deleteThread(event.threadId).pipe(
                Effect.andThen(notifyChanged(event.threadId)),
                Effect.catchCause((cause) =>
                  Effect.logWarning("Worth knowing could not remove a deleted thread's findings", {
                    threadId: event.threadId,
                    cause,
                  }),
                ),
              );
            default:
              return Effect.void;
          }
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Worth knowing event stream stopped", { cause }),
          ),
        ),
      );
    },
  );

  const subscribeThread: WorthKnowingService["Service"]["subscribeThread"] = (threadId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before the snapshot so a change landing between the two is not lost.
        const subscription = yield* PubSub.subscribe(changes);
        const snapshot = listThread(threadId).pipe(
          Effect.map((findings) => ({ threadId, findings })),
        );
        return Stream.concat(
          Stream.fromEffect(snapshot),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((changed) => changed === threadId),
            Stream.mapEffect(() => snapshot),
          ),
        );
      }),
    );

  const subscribeSummaries: WorthKnowingService["Service"]["subscribeSummaries"] = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        const snapshot = store.listOpenSummaries.pipe(Effect.map((summaries) => ({ summaries })));
        return Stream.concat(
          Stream.fromEffect(snapshot),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => snapshot)),
        );
      }),
    );

  const updateFinding: WorthKnowingService["Service"]["updateFinding"] = (input) =>
    Effect.gen(function* () {
      const stored = yield* store.get(input.findingId);
      if (stored === undefined) {
        return yield* new WorthKnowingError({ message: "That finding no longer exists." });
      }
      const status =
        input.action === "dismiss"
          ? "dismissed"
          : input.action === "known"
            ? "known"
            : input.action === "restore"
              ? "open"
              : stored.finding.status;
      const now = yield* nowIso;
      const finding: WorthKnowingFinding = {
        ...stored.finding,
        status,
        ...(input.action === "restore" ? { resolvedByRunId: null, restoredAt: now } : {}),
        updatedAt: now,
      };
      yield* store.update(finding, { engaged: true });
      // Any answer shows the user is reading findings, so checks stop backing off.
      yield* store.setProjectState(finding.projectId, { ignoredStreak: 0, checksToSkip: 0 });
      yield* notifyChanged(finding.threadId);
      return { finding };
    });

  return WorthKnowingService.of({
    start,
    listThread,
    subscribeThread,
    subscribeSummaries,
    updateFinding,
  });
});

export const layer = Layer.effect(WorthKnowingService, make).pipe(
  Layer.provide(WorthKnowingStore.layer),
);
