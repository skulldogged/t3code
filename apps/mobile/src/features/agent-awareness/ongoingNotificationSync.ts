import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

import {
  endAgentLiveUpdate,
  hideAgentLiveUpdate,
  publishAgentLiveUpdate,
} from "../../native/backgroundConnection";
import { ensureAgentNotificationChannels } from "./notificationChannels";
import {
  AGENT_ALERT_NOTIFICATION_TAG,
  agentAlertNotificationIdentifier,
  agentAlertNotificationTrigger,
  buildAgentAlertNotificationContent,
} from "./agentAlertModel";
import {
  buildAgentLiveUpdateContent,
  shouldShowOngoingAgentNotification,
} from "./ongoingNotificationModel";
import type { RelayAgentActivityAggregateState } from "@t3tools/contracts/relay";

let handlerInstalled = false;
let lastPublishedFingerprint: string | null = null;
let liveUpdateEnded = false;

function installOngoingNotificationHandler(): void {
  if (handlerInstalled || Platform.OS !== "android") {
    return;
  }
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const notificationTag = notification.request.content.data?.notificationTag;
      const isAgentAlert = notificationTag === AGENT_ALERT_NOTIFICATION_TAG;
      return {
        shouldShowBanner: isAgentAlert,
        shouldShowList: isAgentAlert,
        shouldPlaySound: isAgentAlert,
        shouldSetBadge: false,
      };
    },
  });
  handlerInstalled = true;
}

export async function publishAgentTransitionNotification(
  state: import("@t3tools/shared/agentAwareness").AgentAwarenessState,
): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }
  installOngoingNotificationHandler();
  await ensureAgentNotificationChannels();
  await Notifications.scheduleNotificationAsync({
    identifier: agentAlertNotificationIdentifier(state),
    content: buildAgentAlertNotificationContent(state),
    trigger: agentAlertNotificationTrigger(),
  });
}

export async function dismissAgentTransitionNotification(
  state: Pick<
    import("@t3tools/shared/agentAwareness").AgentAwarenessState,
    "environmentId" | "threadId"
  >,
): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }
  const identifier = agentAlertNotificationIdentifier(state);
  await Promise.allSettled([
    Notifications.dismissNotificationAsync(identifier),
    Notifications.cancelScheduledNotificationAsync(identifier),
  ]);
}

function fingerprintAggregate(aggregate: RelayAgentActivityAggregateState): string {
  return JSON.stringify({
    activeCount: aggregate.activeCount,
    activities: aggregate.activities.map((row) => ({
      environmentId: row.environmentId,
      threadId: row.threadId,
      projectTitle: row.projectTitle,
      threadTitle: row.threadTitle,
      modelTitle: row.modelTitle,
      phase: row.phase,
      deepLink: row.deepLink,
    })),
  });
}

export async function clearOngoingAgentNotification(): Promise<void> {
  if (Platform.OS !== "android") return;
  if (!liveUpdateEnded) {
    endAgentLiveUpdate();
  }
  liveUpdateEnded = true;
  lastPublishedFingerprint = null;
}

export async function syncOngoingAgentNotification(input: {
  readonly aggregate: RelayAgentActivityAggregateState | null;
  readonly notificationsEnabled: boolean;
  readonly colorScheme?: "light" | "dark";
}): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  if (!shouldShowOngoingAgentNotification(input.aggregate)) {
    await clearOngoingAgentNotification();
    return;
  }

  liveUpdateEnded = false;

  if (!input.notificationsEnabled) {
    hideAgentLiveUpdate();
    lastPublishedFingerprint = null;
    return;
  }

  const fingerprint = fingerprintAggregate(input.aggregate);
  if (fingerprint === lastPublishedFingerprint) {
    return;
  }

  const primary = input.aggregate.activities[0]!;
  const published = publishAgentLiveUpdate(
    buildAgentLiveUpdateContent(
      input.aggregate,
      Linking.createURL(primary.deepLink),
      input.colorScheme ?? "dark",
    ),
  );
  if (published) {
    lastPublishedFingerprint = fingerprint;
  }
}

export function resetOngoingAgentNotificationSyncForTests(): void {
  handlerInstalled = false;
  lastPublishedFingerprint = null;
  liveUpdateEnded = false;
}
