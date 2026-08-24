import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const AGENT_NOTIFICATION_CHANNEL_IDS = {
  liveStatus: "t3code_agent_live_status",
  alerts: "t3code_agent_alerts",
} as const;

let channelsPromise: Promise<void> | null = null;

export function ensureAgentNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") {
    return Promise.resolve();
  }
  channelsPromise ??= Promise.all([
    Notifications.setNotificationChannelAsync(AGENT_NOTIFICATION_CHANNEL_IDS.liveStatus, {
      name: "Live agent status",
      description: "Ongoing status for active T3 Code sessions",
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
      showBadge: false,
    }),
    Notifications.setNotificationChannelAsync(AGENT_NOTIFICATION_CHANNEL_IDS.alerts, {
      name: "Agent alerts",
      description: "Input requests, approvals, completed turns, and failures",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      enableVibrate: true,
      vibrationPattern: [0, 250],
      showBadge: true,
    }),
  ]).then(() => undefined);
  return channelsPromise;
}

export function resetAgentNotificationChannelsForTests(): void {
  channelsPromise = null;
}
