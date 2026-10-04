import { WS_METHODS, type WorthKnowingFinding } from "@t3tools/contracts";
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
