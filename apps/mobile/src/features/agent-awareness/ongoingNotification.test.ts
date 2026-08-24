import type { RelayAgentActivityAggregateState } from "@t3tools/contracts/relay";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Notifications from "expo-notifications";

import {
  agentAlertNotificationTrigger,
  buildAgentAlertNotificationContent,
  shouldNotifyAgentTransition,
} from "./agentAlertModel";
import {
  buildAgentLiveUpdateContent,
  ongoingNotificationBodyPassesSec032,
  shouldShowOngoingAgentNotification,
} from "./ongoingNotificationModel";
import {
  publishAgentTransitionNotification,
  resetOngoingAgentNotificationSyncForTests,
  syncOngoingAgentNotification,
} from "./ongoingNotificationSync";
const platformState = vi.hoisted(() => ({
  OS: "android" as "ios" | "android" | "web",
}));
const nativeLiveUpdate = vi.hoisted(() => ({
  publish: vi.fn(() => true),
  end: vi.fn(),
  hide: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return platformState.OS;
    },
  },
}));

vi.mock("expo-notifications", () => ({
  AndroidNotificationPriority: {
    LOW: -1,
    HIGH: 1,
  },
  setNotificationHandler: vi.fn(),
  scheduleNotificationAsync: vi.fn(() => Promise.resolve("t3-agent-aggregate")),
  dismissNotificationAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock("expo-linking", () => ({
  createURL: (path: string) => `t3code-preview://${path}`,
}));

vi.mock("../../native/backgroundConnection", () => ({
  publishAgentLiveUpdate: nativeLiveUpdate.publish,
  endAgentLiveUpdate: nativeLiveUpdate.end,
  hideAgentLiveUpdate: nativeLiveUpdate.hide,
}));

vi.mock("./notificationChannels", () => ({
  AGENT_NOTIFICATION_CHANNEL_IDS: {
    liveStatus: "agent_live_status",
    alerts: "agent_alerts",
  },
  ensureAgentNotificationChannels: vi.fn(() => Promise.resolve()),
}));

const aggregate: RelayAgentActivityAggregateState = {
  title: "T3 Code",
  subtitle: "Agent work in progress",
  activeCount: 2,
  updatedAt: "2026-06-29T11:00:00.000Z",
  activities: [
    {
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-approval"),
      projectTitle: "T3 Code",
      threadTitle: "Approval thread",
      modelTitle: "gpt-5.4",
      phase: "waiting_for_approval",
      status: "Approval",
      updatedAt: "2026-06-29T11:00:00.000Z",
      deepLink: "/threads/environment-1/thread-approval",
    },
    {
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-running"),
      projectTitle: "T3 Code",
      threadTitle: "Running thread",
      modelTitle: "gpt-5.4",
      phase: "running",
      status: "Working",
      updatedAt: "2026-06-29T10:00:00.000Z",
      deepLink: "/threads/environment-1/thread-running",
    },
  ],
};

describe("ongoing notification model", () => {
  it("shows ongoing notification for every non-terminal primary", () => {
    expect(shouldShowOngoingAgentNotification(aggregate)).toBe(true);
    expect(
      shouldShowOngoingAgentNotification({
        ...aggregate,
        activities: [
          {
            ...aggregate.activities[0]!,
            phase: "waiting_for_input",
            status: "Input",
          },
        ],
      }),
    ).toBe(true);
    expect(shouldShowOngoingAgentNotification(null)).toBe(false);
  });

  it("builds SEC-032-safe native Live Update content", () => {
    const content = buildAgentLiveUpdateContent(
      aggregate,
      "t3code-preview:///threads/environment-1/thread-approval",
    );
    expect(content.title).toBe("Approval needed: Approval thread");
    expect(content.text).toBe("T3 Code · gpt-5.4\n+1 other active session");
    expect(content.shortCriticalText).toBe("Review");
    expect(content.deepLinkUrl).toBe("t3code-preview:///threads/environment-1/thread-approval");
    expect(content.text).not.toContain("stdout");
    expect(ongoingNotificationBodyPassesSec032(content.text)).toBe(true);
  });
});

describe("agent transition alerts", () => {
  it("alerts only when an existing thread enters an actionable or terminal phase", () => {
    const current = {
      environmentId: aggregate.activities[0]!.environmentId,
      threadId: aggregate.activities[0]!.threadId,
      projectTitle: "T3 Code",
      threadTitle: "Approval thread",
      modelTitle: "gpt-5.4",
      phase: "waiting_for_approval" as const,
      headline: "Approval needed",
      updatedAt: aggregate.activities[0]!.updatedAt,
      deepLink: aggregate.activities[0]!.deepLink,
    };
    expect(shouldNotifyAgentTransition({ previous: undefined, current })).toBe(false);
    expect(
      shouldNotifyAgentTransition({
        previous: { ...current, phase: "running", headline: "Agent is working" },
        current,
      }),
    ).toBe(true);
    expect(shouldNotifyAgentTransition({ previous: current, current })).toBe(false);
  });

  it("builds a high-priority alert on the independent alert channel", () => {
    const state = {
      environmentId: aggregate.activities[0]!.environmentId,
      threadId: aggregate.activities[0]!.threadId,
      projectTitle: "T3 Code",
      threadTitle: "Approval thread",
      modelTitle: "gpt-5.4",
      phase: "waiting_for_approval" as const,
      headline: "Approval needed",
      updatedAt: aggregate.activities[0]!.updatedAt,
      deepLink: aggregate.activities[0]!.deepLink,
    };
    expect(buildAgentAlertNotificationContent(state)).toEqual(
      expect.objectContaining({
        title: "Approval required: Approval thread",
        priority: 1,
        sound: "default",
      }),
    );
    expect(agentAlertNotificationTrigger()).toEqual({ channelId: "agent_alerts" });
  });
});

describe("syncOngoingAgentNotification", () => {
  beforeEach(() => {
    platformState.OS = "android";
    resetOngoingAgentNotificationSyncForTests();
    vi.mocked(Notifications.scheduleNotificationAsync).mockClear();
    vi.mocked(Notifications.dismissNotificationAsync).mockClear();
    vi.mocked(Notifications.setNotificationHandler).mockClear();
    nativeLiveUpdate.publish.mockClear();
    nativeLiveUpdate.end.mockClear();
    nativeLiveUpdate.hide.mockClear();
  });

  it("updates the same identifier in place for aggregate ticks", async () => {
    await syncOngoingAgentNotification({
      aggregate,
      notificationsEnabled: true,
    });
    await syncOngoingAgentNotification({
      aggregate,
      notificationsEnabled: true,
    });

    expect(nativeLiveUpdate.publish).toHaveBeenCalledOnce();
    expect(nativeLiveUpdate.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        shortCriticalText: "Review",
        deepLinkUrl: "t3code-preview:///threads/environment-1/thread-approval",
      }),
    );
  });

  it("does not republish when only streaming timestamps and status text change", async () => {
    await syncOngoingAgentNotification({ aggregate, notificationsEnabled: true });
    await syncOngoingAgentNotification({
      aggregate: {
        ...aggregate,
        updatedAt: "2026-06-29T11:00:01.000Z",
        activities: aggregate.activities.map((activity) => ({
          ...activity,
          status: `${activity.status}.`,
          updatedAt: "2026-06-29T11:00:01.000Z",
        })),
      },
      notificationsEnabled: true,
    });

    expect(nativeLiveUpdate.publish).toHaveBeenCalledTimes(1);
  });

  it("dismisses ongoing notification when active work is no longer eligible", async () => {
    await syncOngoingAgentNotification({
      aggregate,
      notificationsEnabled: true,
    });
    await syncOngoingAgentNotification({
      aggregate: {
        ...aggregate,
        activeCount: 0,
        activities: [],
      },
      notificationsEnabled: true,
    });

    expect(nativeLiveUpdate.end).toHaveBeenCalledOnce();
  });

  it("skips Android notification work on non-Android platforms", async () => {
    platformState.OS = "ios";
    await syncOngoingAgentNotification({
      aggregate,
      notificationsEnabled: true,
    });
    expect(nativeLiveUpdate.publish).not.toHaveBeenCalled();
  });

  it("clears ongoing notification when notifications are disabled", async () => {
    await syncOngoingAgentNotification({
      aggregate,
      notificationsEnabled: true,
    });
    nativeLiveUpdate.hide.mockClear();
    await syncOngoingAgentNotification({
      aggregate,
      notificationsEnabled: false,
    });
    expect(nativeLiveUpdate.hide).toHaveBeenCalledOnce();
  });

  it("publishes transition alerts with a stable per-thread identifier", async () => {
    const state = {
      environmentId: aggregate.activities[0]!.environmentId,
      threadId: aggregate.activities[0]!.threadId,
      projectTitle: "T3 Code",
      threadTitle: "Approval thread",
      modelTitle: "gpt-5.4",
      phase: "waiting_for_approval" as const,
      headline: "Approval needed",
      updatedAt: aggregate.activities[0]!.updatedAt,
      deepLink: aggregate.activities[0]!.deepLink,
    };
    await publishAgentTransitionNotification(state);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: expect.stringContaining("t3-agent-alert"),
      content: expect.objectContaining({ title: "Approval required: Approval thread" }),
      trigger: { channelId: "agent_alerts" },
    });
  });
});
