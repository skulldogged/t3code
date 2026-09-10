import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

interface AndroidAgentNotifications {
  configure(deviceId: string, userId: string, scheme: string, ongoingEnabled: boolean): void;
  clear(): void;
  publishLocalActivity(title: string, body: string, path: string, active: boolean): void;
  publishLocalAlert(title: string, body: string, path: string, id: string): void;
  configureLocalActivity(scheme: string, enabled: boolean): void;
}

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<AndroidAgentNotifications>("T3AgentNotifications")
    : null;

export function supportsAndroidAgentNotifications(): boolean {
  return typeof native?.configure === "function" && typeof native?.clear === "function";
}

export function configureAndroidAgentNotifications(
  deviceId: string,
  userId: string,
  ongoingEnabled: boolean,
): void {
  const scheme = Constants.expoConfig?.scheme;
  native?.configure?.(
    deviceId,
    userId,
    (Array.isArray(scheme) ? scheme[0] : scheme) ?? "t3code",
    ongoingEnabled,
  );
}

export function clearAndroidAgentNotifications(): void {
  native?.clear?.();
}

export function publishLocalAndroidAgentActivity(
  title: string,
  body: string,
  path: string,
  active: boolean,
): void {
  native?.publishLocalActivity?.(title, body, path, active);
}

export function publishLocalAndroidAgentAlert(
  title: string,
  body: string,
  path: string,
  id: string,
): void {
  native?.publishLocalAlert?.(title, body, path, id);
}

export function configureLocalAndroidAgentActivity(enabled: boolean): void {
  const scheme = Constants.expoConfig?.scheme;
  native?.configureLocalActivity?.(
    (Array.isArray(scheme) ? scheme[0] : scheme) ?? "t3code",
    enabled,
  );
}
