import type { RelayAgentActivityAggregateState } from "@t3tools/contracts/relay";
import type { AgentLiveUpdateContent } from "../../native/backgroundConnection";

const MAX_TITLE_TEXT_LENGTH = 72;
const MAX_CONTEXT_TEXT_LENGTH = 56;

const FORBIDDEN_BODY_PATTERNS = [
  /\bstdout\b/i,
  /\bstderr\b/i,
  /\btool[_\s-]?output\b/i,
  /(?:^|\s)(?:\/[\w.-]+)+\/[\w.-]+\.[A-Za-z0-9]{1,8}(?:\s|$)/,
  /(?:^|\s)[A-Za-z]:\\[\w\\.-]+\.[A-Za-z0-9]{1,8}(?:\s|$)/,
] as const;

function agentPhaseAccentColor(
  phase: RelayAgentActivityAggregateState["activities"][number]["phase"],
  colorScheme: "light" | "dark",
): string {
  const isLight = colorScheme === "light";
  switch (phase) {
    case "waiting_for_approval":
      return isLight ? "#d97706" : "#fcd34d";
    case "waiting_for_input":
      return isLight ? "#4f46e5" : "#a5b4fc";
    case "failed":
      return isLight ? "#dc2626" : "#fca5a5";
    case "completed":
      return isLight ? "#059669" : "#6ee7b7";
    case "starting":
    case "running":
    case "stale":
      return isLight ? "#0284c7" : "#7dd3fc";
  }
}

function agentPhaseStatusLabel(phase: OngoingAgentNotificationPhase): string {
  switch (phase) {
    case "starting":
      return "Starting";
    case "running":
      return "Working";
    case "waiting_for_approval":
      return "Approval needed";
    case "waiting_for_input":
      return "Input needed";
    case "stale":
      return "Waiting";
  }
}

function agentPhaseCriticalLabel(phase: OngoingAgentNotificationPhase): string {
  switch (phase) {
    case "starting":
      return "Start";
    case "running":
      return "Working";
    case "waiting_for_approval":
      return "Review";
    case "waiting_for_input":
      return "Input";
    case "stale":
      return "Waiting";
  }
}

export type OngoingAgentNotificationPhase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "stale";

export function shouldShowOngoingAgentNotification(
  aggregate: RelayAgentActivityAggregateState | null,
): aggregate is RelayAgentActivityAggregateState {
  if (!aggregate || aggregate.activeCount <= 0) {
    return false;
  }
  const primary = aggregate.activities[0];
  if (!primary) {
    return false;
  }
  return (
    primary.phase === "starting" ||
    primary.phase === "running" ||
    primary.phase === "waiting_for_approval" ||
    primary.phase === "waiting_for_input" ||
    primary.phase === "stale"
  );
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function formatExpandedBody(aggregate: RelayAgentActivityAggregateState): string {
  const primary = aggregate.activities[0]!;
  const lines = [
    `${truncateText(primary.projectTitle, MAX_CONTEXT_TEXT_LENGTH)} · ${truncateText(primary.modelTitle, MAX_CONTEXT_TEXT_LENGTH)}`,
  ];
  const additionalCount = Math.max(0, aggregate.activeCount - 1);
  if (additionalCount > 0) {
    lines.push(
      `+${additionalCount} other active ${additionalCount === 1 ? "session" : "sessions"}`,
    );
  }
  return lines.join("\n");
}

export function ongoingNotificationBodyPassesSec032(body: string): boolean {
  return !FORBIDDEN_BODY_PATTERNS.some((pattern) => pattern.test(body));
}

export function buildAgentLiveUpdateContent(
  aggregate: RelayAgentActivityAggregateState,
  deepLinkUrl: string,
  colorScheme: "light" | "dark" = "dark",
): AgentLiveUpdateContent {
  const primary = aggregate.activities[0]!;
  const status = agentPhaseStatusLabel(primary.phase as OngoingAgentNotificationPhase);
  const text = formatExpandedBody(aggregate);

  return {
    title: `${status}: ${truncateText(primary.threadTitle, MAX_TITLE_TEXT_LENGTH)}`,
    text,
    shortCriticalText: agentPhaseCriticalLabel(primary.phase as OngoingAgentNotificationPhase),
    deepLinkUrl,
    color: agentPhaseAccentColor(primary.phase, colorScheme),
  };
}

export function ongoingAgentNotificationSummary(aggregate: RelayAgentActivityAggregateState): {
  readonly phase: OngoingAgentNotificationPhase;
  readonly status: string;
  readonly color: string;
} {
  const primary = aggregate.activities[0]!;
  const phase = primary.phase as OngoingAgentNotificationPhase;
  return {
    phase,
    status: agentPhaseStatusLabel(phase),
    color: agentPhaseAccentColor(phase, "dark"),
  };
}
