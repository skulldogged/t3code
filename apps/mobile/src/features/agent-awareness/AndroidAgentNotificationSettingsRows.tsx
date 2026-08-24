import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Notifications from "expo-notifications";
import { useCallback } from "react";
import { Alert, Platform } from "react-native";

import {
  getAgentLiveUpdateStatus,
  openAgentLiveUpdateSettings,
} from "../../native/backgroundConnection";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { ensureAgentNotificationChannels } from "./notificationChannels";
import { clearOngoingAgentNotification } from "./ongoingNotificationSync";

async function requestAndroidNotificationPermission(): Promise<boolean> {
  await ensureAgentNotificationChannels();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) {
    return true;
  }
  if (!existing.canAskAgain) {
    return false;
  }
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export function AndroidAgentNotificationSettingsRows() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : {};
  const preferencesReady = AsyncResult.isSuccess(preferencesResult);
  const deviceNotificationsEnabled = preferences.androidAgentAlertsEnabled !== false;
  const liveActivityUpdatesEnabled = preferences.androidLiveStatusNotificationsEnabled !== false;

  const enableOrExplain = useCallback(async () => {
    try {
      if (await requestAndroidNotificationPermission()) {
        return true;
      }
    } catch (error) {
      console.warn("[agent-notifications] could not request Android notification access", error);
    }
    Alert.alert(
      "Notifications disabled",
      "Allow notifications for T3 Code Preview in Android settings, then try again.",
    );
    return false;
  }, []);

  const handleDeviceNotificationsChange = useCallback(
    async (enabled: boolean) => {
      if (enabled && !(await enableOrExplain())) {
        return;
      }
      savePreferences({ androidAgentAlertsEnabled: enabled });
    },
    [enableOrExplain, savePreferences],
  );

  const handleLiveActivityUpdatesChange = useCallback(
    async (enabled: boolean) => {
      if (enabled && !(await enableOrExplain())) {
        return;
      }
      if (!enabled) {
        await clearOngoingAgentNotification();
      }
      savePreferences({ androidLiveStatusNotificationsEnabled: enabled });
      if (enabled) {
        const status = getAgentLiveUpdateStatus();
        if (status.supported && !status.promotionAllowed) {
          Alert.alert(
            "Allow Live Updates",
            "Android needs permission to promote T3 Code's ongoing agent status into the status-bar chip.",
            [
              { text: "Not Now", style: "cancel" },
              {
                text: "Open Settings",
                onPress: () => void openAgentLiveUpdateSettings(),
              },
            ],
          );
        }
      }
    },
    [enableOrExplain, savePreferences],
  );

  if (Platform.OS !== "android") {
    return null;
  }

  return (
    <>
      <SettingsSwitchRow
        disabled={!preferencesReady}
        icon="bell.badge"
        label="Device Notifications"
        subtitle="Input, approvals, completed turns, and failures"
        value={deviceNotificationsEnabled}
        onValueChange={(enabled) => void handleDeviceNotificationsChange(enabled)}
      />
      <SettingsSwitchRow
        disabled={!preferencesReady}
        icon="bolt.circle"
        label="Live Activity Updates"
        subtitle="Android Live Update chip for active sessions"
        value={liveActivityUpdatesEnabled}
        onValueChange={(enabled) => void handleLiveActivityUpdatesChange(enabled)}
      />
    </>
  );
}
