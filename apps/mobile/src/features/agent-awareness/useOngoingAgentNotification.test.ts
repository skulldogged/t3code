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
  dismiss: vi.fn(() => Promise.resolve()),
  publish: vi.fn(() => Promise.resolve()),
  sync: vi.fn(() => Promise.resolve()),
}));

const awareness = vi.hoisted(() => ({
  states: [] as Array<{
    environmentId: string;
    threadId: string;
    phase: string;
  }>,
  shouldDismiss: vi.fn(
    (input: { previous?: { phase: string }; current: { phase: string } }) =>
      input.previous?.phase === "completed" && input.current.phase === "running",
  ),
  shouldNotify: vi.fn(() => false),
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
  buildLocalAgentAwarenessStates: vi.fn(() => awareness.states),
  buildLocalAgentActivityAggregate: vi.fn(() => null),
}));

vi.mock("./agentAlertModel", () => ({
  agentAwarenessStateKey: vi.fn((state: { environmentId: string; threadId: string }) =>
    JSON.stringify([state.environmentId, state.threadId]),
  ),
  shouldDismissAgentTransitionNotification: awareness.shouldDismiss,
  shouldNotifyAgentTransition: awareness.shouldNotify,
}));

vi.mock("./ongoingNotificationSync", () => ({
  clearOngoingAgentNotification: notifications.clear,
  dismissAgentTransitionNotification: notifications.dismiss,
  publishAgentTransitionNotification: notifications.publish,
  syncOngoingAgentNotification: notifications.sync,
}));

import {
  acquireAndroidAgentNotifications,
  AGENT_NOTIFICATION_POLL_INTERVAL_MS,
} from "./useOngoingAgentNotification";

function makeRegistry(threads: Array<{ environmentId: string; id: string }> = []) {
  const subscribe = vi.fn();
  return {
    get(atom: object) {
      if (atom === atoms.projects) return [];
      if (atom === atoms.threads) return threads;
      if (atom === atoms.preferences) return { _tag: "Success", value: {} };
      throw new Error("unexpected atom");
    },
    subscribe,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  appState.current = "background";
  awareness.states = [];
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

  it("dismisses a completed alert when work resumes while the app is foregrounded", async () => {
    appState.current = "active";
    const threads = [{ environmentId: "environment-1", id: "thread-1" }];
    awareness.states = [
      { environmentId: "environment-1", threadId: "thread-1", phase: "completed" },
    ];
    const release = acquireAndroidAgentNotifications(makeRegistry(threads) as never);
    await Promise.resolve();
    await Promise.resolve();

    awareness.states = [{ environmentId: "environment-1", threadId: "thread-1", phase: "running" }];
    await vi.advanceTimersByTimeAsync(AGENT_NOTIFICATION_POLL_INTERVAL_MS);

    expect(notifications.dismiss).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: "environment-1", threadId: "thread-1" }),
    );
    expect(notifications.publish).not.toHaveBeenCalled();
    release();
  });
});
