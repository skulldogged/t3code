import type {
  BranchNamingOptions,
  ChatAttachment,
  ModelSelection,
  TextGenerationError,
  ThreadId,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import type { ProviderAdapterV2RuntimePolicy } from "./ProviderAdapter.ts";
import type { TextGenerationPolicy } from "./textGenerationPolicy.ts";

export interface CommitMessageGenerationInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  /** When true, the model also returns a semantic branch name for the change. */
  includeBranch?: boolean;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface CommitMessageGenerationResult {
  subject: string;
  body: string;
  /** Only present when `includeBranch` was set on the input. */
  branch?: string | undefined;
}

export interface PrContentGenerationInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  changeRequestTemplate?: string | undefined;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface PrContentGenerationResult {
  title: string;
  body: string;
}

export interface BranchNameGenerationInput {
  naming?: BranchNamingOptions | undefined;
  cwd: string;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface BranchNameGenerationResult {
  branch: string;
}

export interface ThreadTitleGenerationInput {
  linkedContext?: string | undefined;
  cwd: string;
  message: string;
  /** Present when replacing an existing title from the current thread history. */
  previousTitle?: string | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface ThreadTitleGenerationResult {
  title: string;
  needsRefinement?: boolean | undefined;
}

/** Commit, change request, branch, and title generation backed by one provider instance. */
export interface ProviderTextGeneration {
  /**
   * Generate a commit message from staged change context.
   */
  readonly generateCommitMessage: (
    input: CommitMessageGenerationInput,
  ) => Effect.Effect<CommitMessageGenerationResult, TextGenerationError>;

  /**
   * Generate change request title/body from branch and diff context.
   */
  readonly generatePrContent: (
    input: PrContentGenerationInput,
  ) => Effect.Effect<PrContentGenerationResult, TextGenerationError>;

  /**
   * Generate a concise branch name from a user message.
   */
  readonly generateBranchName: (
    input: BranchNameGenerationInput,
  ) => Effect.Effect<BranchNameGenerationResult, TextGenerationError>;

  /** Generate a concise thread title from a first message or thread history. */
  readonly generateThreadTitle: (
    input: ThreadTitleGenerationInput,
  ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;

  /**
   * Ask a hidden, tool-less fork of a provider conversation one question and
   * return its reply, leaving the conversation itself untouched. Absent when
   * the provider cannot fork its conversations.
   */
  readonly generateSideReply?: (
    input: SideReplyInput,
  ) => Effect.Effect<SideReplyResult, TextGenerationError>;
}

/** The detail of the error a provider runtime returns when it cannot fork for side replies. */
export const SIDE_REPLY_UNSUPPORTED =
  "This provider runtime cannot fork conversations for side replies.";

export interface SideReplyInput {
  /** The app thread whose conversation is forked; its live session's tools are reused. */
  threadId: ThreadId;
  /** The provider's own id for the conversation to fork. */
  nativeThreadId: string;
  cwd: string;
  /** The thread's own selection, so the fork runs on the same model as the conversation. */
  modelSelection: ModelSelection;
  runtimePolicy: ProviderAdapterV2RuntimePolicy;
  prompt: string;
}

export interface SideReplyResult {
  text: string;
  /** Token counts when the provider reports them, to see how much of the fork was cached. */
  usage?:
    | {
        readonly inputTokens: number;
        readonly cachedInputTokens: number;
        readonly outputTokens: number;
      }
    | undefined;
}
