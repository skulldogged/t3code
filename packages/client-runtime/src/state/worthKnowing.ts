import {
  WS_METHODS,
  type WorthKnowingFinding,
  type WorthKnowingFindingStatus,
} from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Live "Worth knowing" findings per thread, sidebar summaries, and the finding actions. */
export function createWorthKnowingAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    /** One thread's findings, newest first: a snapshot, then the full list after every change. */
    threadFindings: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:worth-knowing:thread",
      tag: WS_METHODS.worthKnowingSubscribeThread,
    }),
    /** One summary per thread with open findings. */
    summaries: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:worth-knowing:summaries",
      tag: WS_METHODS.worthKnowingSubscribeSummaries,
    }),
    updateFinding: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worth-knowing:update-finding",
      tag: WS_METHODS.worthKnowingUpdateFinding,
    }),
  };
}

/**
 * The open finding to show above the composer. Like Claude Code's plugin, a
 * finding waits there until the user answers it or passes it over, except
 * while the card under its run's final answer is the last thing in the
 * thread: pass that run as `settledRunId`. Findings are newest first.
 */
export function worthKnowingComposerFinding(
  findings: ReadonlyArray<WorthKnowingFinding>,
  settledRunId: string | null,
): WorthKnowingFinding | undefined {
  return findings.find((finding) => finding.status === "open" && finding.runId !== settledRunId);
}

/** How a closed finding was closed, after its title. */
export function worthKnowingClosedLabel(status: WorthKnowingFindingStatus): string {
  switch (status) {
    case "known":
      return "you knew this";
    case "discussed":
      return "asked the agent";
    case "passed_over":
      return "passed over";
    case "resolved":
      return "addressed later";
    default:
      return "dismissed";
  }
}

/** Findings shown in a run's card: open ones first, then those the user can still restore. */
export function worthKnowingFindingsForRun(
  findings: ReadonlyArray<WorthKnowingFinding>,
  runId: string,
): ReadonlyArray<WorthKnowingFinding> {
  return findings.filter((finding) => finding.runId === runId);
}

/** The text handed to the agent when the user asks it about a finding. */
export function worthKnowingAgentPrompt(finding: WorthKnowingFinding): string {
  const evidence = finding.evidence === null ? "" : `\n\nIt points to: "${finding.evidence.quote}"`;
  return `T3's "Worth knowing" observer flagged this about your work: ${finding.learn}${evidence}\n\nIs this right, and what should we do about it?`;
}
