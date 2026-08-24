import * as Notifications from "expo-notifications";
import type { AgentAwarenessPhase, AgentAwarenessState } from "@t3tools/shared/agentAwareness";

import { AGENT_NOTIFICATION_CHANNEL_IDS } from "./notificationChannels";

export const AGENT_ALERT_NOTIFICATION_TAG = "t3-agent-alert" as const;

const ALERT_PHASES = new Set<AgentAwarenessPhase>([
  "waiting_for_approval",
  "waiting_for_input",
  "completed",
  "failed",
]);

export function agentAwarenessStateKey(
  state: Pick<AgentAwarenessState, "environmentId" | "threadId">,
): string {
  return JSON.stringify([state.environmentId, state.threadId]);
}

export function shouldNotifyAgentTransition(input: {
  readonly previous: AgentAwarenessState | undefined;
  readonly current: AgentAwarenessState;
}): boolean {
  return (
    input.previous !== undefined &&
    input.previous.phase !== input.current.phase &&
    ALERT_PHASES.has(input.current.phase)
  );
}

function alertTitle(phase: AgentAwarenessPhase): string {
  switch (phase) {
    case "waiting_for_approval":
      return "Approval required";
    case "waiting_for_input":
      return "T3 Code needs input";
    case "completed":
      return "Turn completed";
    case "failed":
      return "Turn failed";
    case "starting":
    case "running":
    case "stale":
      return "T3 Code update";
  }
}

export function buildAgentAlertNotificationContent(
  state: AgentAwarenessState,
): Notifications.NotificationContentInput {
  return {
    title: `${alertTitle(state.phase)}: ${state.threadTitle}`,
    body: `${state.projectTitle} · ${state.modelTitle}`,
    autoDismiss: true,
    sound: "default",
    priority: Notifications.AndroidNotificationPriority.HIGH,
    data: {
      deepLink: state.deepLink,
      environmentId: state.environmentId,
      threadId: state.threadId,
      notificationTag: AGENT_ALERT_NOTIFICATION_TAG,
      phase: state.phase,
    },
  };
}

export function agentAlertNotificationIdentifier(state: AgentAwarenessState): string {
  return `${AGENT_ALERT_NOTIFICATION_TAG}:${agentAwarenessStateKey(state)}`;
}

export function agentAlertNotificationTrigger(): Notifications.NotificationTriggerInput {
  return { channelId: AGENT_NOTIFICATION_CHANNEL_IDS.alerts };
}
