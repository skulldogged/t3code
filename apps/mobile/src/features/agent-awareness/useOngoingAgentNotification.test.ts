import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const atoms = vi.hoisted(() => ({
  projects: { key: "projects" },
  threads: { key: "threads" },
  preferences: { key: "preferences" },
}));

const appState = vi.hoisted(() => ({
  current: "background" as "active" | "background",
}));

const notifications = vi.hoisted(() => ({
  clear: vi.fn(() => Promise.resolve()),
  sync: vi.fn(() => Promise.resolve()),
}));

vi.mock("react-native", () => ({
  Appearance: { getColorScheme: vi.fn(() => "dark") },
  AppState: {
    get currentState() {
      return appState.current;
    },
  },
  Platform: { OS: "android" },
}));

vi.mock("../../native/backgroundConnection", () => ({
  getAgentLiveUpdateStatus: () => ({ notificationsEnabled: true }),
}));

vi.mock("../../state/projects", () => ({
  environmentProjects: { projectsAtom: atoms.projects },
}));

vi.mock("../../state/threads", () => ({
  environmentThreadShells: { threadShellsAtom: atoms.threads },
}));

vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: atoms.preferences,
}));

vi.mock("./localAgentActivityAggregate", () => ({
  buildLocalAgentAwarenessStates: vi.fn(() => []),
  buildLocalAgentActivityAggregate: vi.fn(() => null),
}));

vi.mock("./agentAlertModel", () => ({
  agentAwarenessStateKey: vi.fn(() => "thread"),
  shouldNotifyAgentTransition: vi.fn(() => false),
}));

vi.mock("./ongoingNotificationSync", () => ({
  clearOngoingAgentNotification: notifications.clear,
  publishAgentTransitionNotification: vi.fn(() => Promise.resolve()),
  syncOngoingAgentNotification: notifications.sync,
}));

import {
  acquireAndroidAgentNotifications,
  AGENT_NOTIFICATION_POLL_INTERVAL_MS,
} from "./useOngoingAgentNotification";

function makeRegistry() {
  const subscribe = vi.fn();
  return {
    get(atom: object) {
      if (atom === atoms.projects || atom === atoms.threads) return [];
      if (atom === atoms.preferences) return { _tag: "Success", value: {} };
      throw new Error("unexpected atom");
    },
    subscribe,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  appState.current = "background";
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Android agent notification worker", () => {
  it("polls at a fixed cadence without subscribing to interactive app state", async () => {
    const registry = makeRegistry();
    const release = acquireAndroidAgentNotifications(registry as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(notifications.sync).toHaveBeenCalledOnce();

    expect(registry.subscribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AGENT_NOTIFICATION_POLL_INTERVAL_MS - 1);
    expect(notifications.sync).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(notifications.sync).toHaveBeenCalledTimes(2);

    release();
    expect(notifications.clear).toHaveBeenCalledOnce();
  });

  it("suppresses the Live Update while the app is foregrounded", async () => {
    appState.current = "active";
    const release = acquireAndroidAgentNotifications(makeRegistry() as never);

    await Promise.resolve();
    await Promise.resolve();
    expect(notifications.sync).toHaveBeenCalledOnce();
    expect(notifications.sync).toHaveBeenCalledWith(
      expect.objectContaining({ notificationsEnabled: false }),
    );

    release();
  });
});
