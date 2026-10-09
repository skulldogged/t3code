/**
 * Side replies on Claude: resume the thread's session as a fork that is never
 * written to disk, built from the same options as the thread's live query so
 * the request reuses the conversation's cached prefix. Every tool call is
 * denied and the fork gets a single turn.
 *
 * @module textGeneration/ClaudeSideReply
 */
import {
  type CanUseTool,
  type HookCallback,
  type Options as ClaudeQueryOptions,
  query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type ClaudeSettings,
  type ProviderInstanceEnvironment,
  TextGenerationError,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ServerConfig from "../config.ts";
import {
  claudeMcpQueryOverrides,
  claudeQueryMessages,
  claudeRuntimeQueryPolicyForRuntimePolicy,
  makeClaudeQueryOptions,
} from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { resolveClaudeSdkExecutablePath } from "../provider/Drivers/ClaudeExecutable.ts";
import { makeClaudeEnvironment } from "../provider/Drivers/ClaudeHome.ts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import type * as TextGeneration from "./TextGeneration.ts";

const SIDE_REPLY_TIMEOUT = "3 minutes";

const NO_TOOLS_MESSAGE =
  "Tools are unavailable in this side request. Answer from the conversation.";

const denyEveryTool: CanUseTool = async () => ({ behavior: "deny", message: NO_TOOLS_MESSAGE });

// The permission callback is only asked when a call would otherwise prompt, so
// tools the user's settings pre-approve would still run. A PreToolUse deny
// overrides those rules without changing the tool list the cache depends on.
const denyEveryToolHook: HookCallback = async () => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: NO_TOOLS_MESSAGE,
  },
});

const sideReplyError = (detail: string, cause?: unknown) =>
  new TextGenerationError({ operation: "generateSideReply", detail, cause });

interface CollectedReply {
  readonly texts: ReadonlyArray<string>;
  readonly result: SDKResultMessage | undefined;
}

function assistantText(message: SDKMessage): string | undefined {
  if (message.type !== "assistant" || message.parent_tool_use_id !== null) return undefined;
  const text = message.message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  return text.length === 0 ? undefined : text;
}

// A fork of a session whose background tasks were still running reports them
// as stopped and closes that out with an empty result before it reads the
// prompt. The reply's own result follows.
function isBackgroundTaskBookkeeping(message: SDKMessage): boolean {
  return (
    message.type === "result" &&
    message.origin?.kind === "task-notification" &&
    message.num_turns === 0
  );
}

export const makeClaudeSideReply = Effect.fn("makeClaudeSideReply")(function* (input: {
  readonly config: ClaudeSettings;
  readonly environment: ProviderInstanceEnvironment | undefined;
}) {
  const hostEnvironment = yield* HostProcessEnvironment;
  const mcpSessions = yield* McpProviderSessions.McpProviderSessions;
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  const claudeEnvironment = yield* makeClaudeEnvironment(
    input.config,
    mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
  );
  const binaryPath = yield* resolveClaudeSdkExecutablePath(
    expandHomePath(input.config.binaryPath),
    claudeEnvironment,
  );
  const settings = { ...input.config, binaryPath };

  const generateSideReply: NonNullable<
    TextGeneration.TextGeneration["Service"]["generateSideReply"]
  > = Effect.fn("ClaudeSideReply.generate")(function* (request) {
    const queryPolicy = claudeRuntimeQueryPolicyForRuntimePolicy(request.runtimePolicy);
    // Same tools and MCP servers as the live query: they lead the prompt, so
    // any difference there would forfeit the cached conversation.
    const { mcpServers } = claudeMcpQueryOverrides({
      mcpSession: yield* mcpSessions.read(request.threadId),
      readOnlySandbox: queryPolicy.tools !== undefined,
    });
    // Pre-approved tools would skip the permission callback.
    const {
      allowedTools: _allowedTools,
      allowDangerouslySkipPermissions: _allowDangerouslySkipPermissions,
      ...liveOptions
    } = makeClaudeQueryOptions({
      modelSelection: request.modelSelection,
      nativeThreadId: request.nativeThreadId,
      resume: true,
      cwd: request.cwd,
      attachmentsDir,
      settings,
      environment: claudeEnvironment,
      ...(queryPolicy.tools === undefined ? {} : { tools: queryPolicy.tools }),
      ...(mcpServers === undefined ? {} : { mcpServers }),
      canUseTool: denyEveryTool,
    });
    const options: ClaudeQueryOptions = {
      ...liveOptions,
      // Claude Code's own side requests run no hooks; a fork here would
      // otherwise fire the user's SessionStart and Stop hooks for a session
      // nobody sees. The tool guard below is an SDK callback, which still runs.
      ...(typeof liveOptions.settings === "string"
        ? {}
        : { settings: { ...liveOptions.settings, disableAllHooks: true } }),
      permissionMode: "default",
      forkSession: true,
      persistSession: false,
      maxTurns: 1,
      hooks: { PreToolUse: [{ hooks: [denyEveryToolHook] }] },
    };

    const collected = yield* Effect.gen(function* () {
      const promptQueue = yield* Queue.unbounded<SDKUserMessage>();
      // The prompt stays open until the reply arrives: the permission callback
      // answers over the same channel.
      const prompt = Stream.fromQueue(promptQueue).pipe(
        Stream.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Stream.empty : Stream.failCause(cause),
        ),
        Stream.toAsyncIterable,
      );
      const queryRuntime = yield* Effect.acquireRelease(
        Effect.try({
          try: () => query({ prompt, options }),
          catch: (cause) => sideReplyError("Failed to start the Claude fork.", cause),
        }),
        (runtime) =>
          Queue.shutdown(promptQueue).pipe(
            Effect.andThen(Effect.try(() => runtime.close())),
            Effect.ignore,
          ),
      );
      yield* Queue.offer(promptQueue, {
        type: "user",
        message: { role: "user", content: request.prompt },
        parent_tool_use_id: null,
      });
      return yield* Stream.fromAsyncIterable(claudeQueryMessages(queryRuntime), (cause) =>
        sideReplyError("The Claude fork stopped before replying.", cause),
      ).pipe(
        Stream.filter((message) => !isBackgroundTaskBookkeeping(message)),
        Stream.takeUntil((message) => message.type === "result"),
        Stream.runFold(
          (): CollectedReply => ({ texts: [], result: undefined }),
          (acc, message): CollectedReply => {
            if (message.type === "result") return { ...acc, result: message };
            const text = assistantText(message);
            return text === undefined ? acc : { ...acc, texts: [...acc.texts, text] };
          },
        ),
      );
    }).pipe(
      Effect.scoped,
      Effect.timeoutOption(SIDE_REPLY_TIMEOUT),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(sideReplyError("The Claude fork timed out.")),
          onSome: Effect.succeed,
        }),
      ),
    );

    const result = collected.result;
    const text = (
      result?.subtype === "success" && result.result.trim().length > 0
        ? result.result
        : collected.texts.join("\n")
    ).trim();
    if (text.length === 0) {
      return yield* sideReplyError(
        result === undefined
          ? "The Claude fork ended without replying."
          : `The Claude fork ended without replying (${result.subtype}).`,
      );
    }
    return {
      text,
      ...(result === undefined
        ? {}
        : {
            usage: {
              inputTokens:
                result.usage.input_tokens +
                (result.usage.cache_read_input_tokens ?? 0) +
                (result.usage.cache_creation_input_tokens ?? 0),
              cachedInputTokens: result.usage.cache_read_input_tokens ?? 0,
              outputTokens: result.usage.output_tokens,
            },
          }),
    };
  });

  return generateSideReply;
});
