import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnItemId,
} from "./baseSchemas.ts";

export const WorthKnowingFindingId = TrimmedNonEmptyString.pipe(
  Schema.brand("WorthKnowingFindingId"),
);
export type WorthKnowingFindingId = typeof WorthKnowingFindingId.Type;

/**
 * `heads_up` is about the work in this thread (a decision the agent made, a
 * result that may be off) with a cost if missed. `you_should_know` is about
 * understanding how something works when it matters for the user's work.
 */
export const WorthKnowingTag = Schema.Literals(["heads_up", "you_should_know"]);
export type WorthKnowingTag = typeof WorthKnowingTag.Type;

/**
 * `known` means the user already knew it, so the observer avoids the topic in
 * this project afterwards. `resolved` means a later run dealt with it.
 */
export const WorthKnowingFindingStatus = Schema.Literals([
  "open",
  "dismissed",
  "known",
  "resolved",
]);
export type WorthKnowingFindingStatus = typeof WorthKnowingFindingStatus.Type;

/** Where in the conversation the observer saw what it flagged. */
export const WorthKnowingEvidence = Schema.Struct({
  /** Verbatim text the observer quoted from the conversation. */
  quote: Schema.String,
  /** The thread item containing the quote, when the server could find it. */
  itemId: Schema.NullOr(TurnItemId),
  runId: Schema.NullOr(RunId),
  /** Where the quote came from, such as the command whose output held it. */
  label: Schema.NullOr(Schema.String),
});
export type WorthKnowingEvidence = typeof WorthKnowingEvidence.Type;

export const WorthKnowingFinding = Schema.Struct({
  id: WorthKnowingFindingId,
  threadId: ThreadId,
  projectId: ProjectId,
  /** The run the observer was reading when it raised this. */
  runId: RunId,
  tag: WorthKnowingTag,
  /** One plain sentence stating what to know. */
  learn: Schema.String,
  /** A few words stating the takeaway. */
  title: Schema.String,
  /** A short markdown explanation for someone switching in with no context. */
  body: Schema.String,
  evidence: Schema.NullOr(WorthKnowingEvidence),
  status: WorthKnowingFindingStatus,
  /** Raised while the run was still working, rather than after it finished. */
  raisedMidRun: Schema.Boolean,
  resolvedByRunId: Schema.NullOr(RunId),
  /** When the user restored it; the observer then leaves it open until they close it. */
  restoredAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorthKnowingFinding = typeof WorthKnowingFinding.Type;

/** What the sidebar needs about one thread's open findings. */
export const WorthKnowingThreadSummary = Schema.Struct({
  threadId: ThreadId,
  openCount: Schema.Int,
  headsUpCount: Schema.Int,
  latestOpenAt: IsoDateTime,
  latestHeadsUpAt: Schema.NullOr(IsoDateTime),
  /** Title of the newest open heads-up finding, for notifications. */
  latestHeadsUpTitle: Schema.NullOr(Schema.String),
});
export type WorthKnowingThreadSummary = typeof WorthKnowingThreadSummary.Type;

export const WorthKnowingThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type WorthKnowingThreadInput = typeof WorthKnowingThreadInput.Type;

/** Every finding a thread has, newest first. */
export const WorthKnowingThreadResult = Schema.Struct({
  threadId: ThreadId,
  findings: Schema.Array(WorthKnowingFinding),
});
export type WorthKnowingThreadResult = typeof WorthKnowingThreadResult.Type;

/** One summary per thread that has open findings. */
export const WorthKnowingSummariesResult = Schema.Struct({
  summaries: Schema.Array(WorthKnowingThreadSummary),
});
export type WorthKnowingSummariesResult = typeof WorthKnowingSummariesResult.Type;

/**
 * `engaged` records that the user acted on a finding (opened its source or
 * handed it to the agent) without changing its status; any action tells the
 * observer its findings are being read.
 */
export const WorthKnowingFindingAction = Schema.Literals([
  "dismiss",
  "known",
  "restore",
  "engaged",
]);
export type WorthKnowingFindingAction = typeof WorthKnowingFindingAction.Type;

export const WorthKnowingUpdateFindingInput = Schema.Struct({
  findingId: WorthKnowingFindingId,
  action: WorthKnowingFindingAction,
});
export type WorthKnowingUpdateFindingInput = typeof WorthKnowingUpdateFindingInput.Type;

export const WorthKnowingUpdateFindingResult = Schema.Struct({
  finding: WorthKnowingFinding,
});
export type WorthKnowingUpdateFindingResult = typeof WorthKnowingUpdateFindingResult.Type;

export class WorthKnowingError extends Schema.TaggedError<WorthKnowingError>()(
  "WorthKnowingError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
