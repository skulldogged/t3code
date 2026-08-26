import type { AgentAwarenessState } from "@t3tools/shared/agentAwareness";
import { AsyncResult, type AtomRegistry } from "effect/unstable/reactivity";
import { AppState, Appearance, Platform } from "react-native";

import { getAgentLiveUpdateStatus } from "../../native/backgroundConnection";
import { environmentProjects } from "../../state/projects";
import { mobilePreferencesAtom } from "../../state/preferences";
import { environmentThreadShells } from "../../state/threads";
import {
  agentAwarenessStateKey,
  shouldDismissAgentTransitionNotification,
  shouldNotifyAgentTransition,
} from "./agentAlertModel";
import {
  buildLocalAgentActivityAggregate,
  buildLocalAgentAwarenessStates,
} from "./localAgentActivityAggregate";
import {
  clearOngoingAgentNotification,
  dismissAgentTransitionNotification,
  publishAgentTransitionNotification,
  syncOngoingAgentNotification,
} from "./ongoingNotificationSync";

interface AndroidAgentNotificationWorker {
  readonly registry: AtomRegistry.AtomRegistry;
  owners: number;
  stopped: boolean;
  syncing: boolean;
  interval: ReturnType<typeof setInterval> | null;
  initialized: boolean;
  previousStates: Map<string, AgentAwarenessState>;
}

const workers = new WeakMap<AtomRegistry.AtomRegistry, AndroidAgentNotificationWorker>();
export const AGENT_NOTIFICATION_POLL_INTERVAL_MS = 2_000;

async function poll(worker: AndroidAgentNotificationWorker): Promise<void> {
  if (worker.stopped || worker.syncing) return;
  worker.syncing = true;
  try {
    const projects = worker.registry.get(environmentProjects.projectsAtom);
    const threads = worker.registry.get(environmentThreadShells.threadShellsAtom);
    const currentStates = buildLocalAgentAwarenessStates({ projects, threads });
    const aggregate = buildLocalAgentActivityAggregate({ projects, threads });
    const preferencesResult = worker.registry.get(mobilePreferencesAtom);
    const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : {};
    const liveStatusEnabled = preferences.androidLiveStatusNotificationsEnabled !== false;
    const agentAlertsEnabled = preferences.androidAgentAlertsEnabled !== false;
    const appIsForegrounded = AppState.currentState === "active";
    const notificationsEnabled = getAgentLiveUpdateStatus().notificationsEnabled;

    await syncOngoingAgentNotification({
      aggregate,
      notificationsEnabled: !appIsForegrounded && notificationsEnabled && liveStatusEnabled,
      colorScheme: Appearance.getColorScheme() === "light" ? "light" : "dark",
    });

    if (worker.initialized) {
      for (const current of currentStates) {
        const previous = worker.previousStates.get(agentAwarenessStateKey(current));
        if (shouldDismissAgentTransitionNotification({ previous, current })) {
          await dismissAgentTransitionNotification(current);
        } else if (
          notificationsEnabled &&
          agentAlertsEnabled &&
          !appIsForegrounded &&
          shouldNotifyAgentTransition({ previous, current })
        ) {
          await publishAgentTransitionNotification(current);
        }
      }
    }

    const existingThreadKeys = new Set(
      threads.map((thread) => JSON.stringify([thread.environmentId, thread.id])),
    );
    for (const key of worker.previousStates.keys()) {
      if (!existingThreadKeys.has(key)) {
        const removedState = worker.previousStates.get(key);
        if (removedState) {
          await dismissAgentTransitionNotification(removedState);
        }
        worker.previousStates.delete(key);
      }
    }
    for (const current of currentStates) {
      worker.previousStates.set(agentAwarenessStateKey(current), current);
    }
    worker.initialized = true;
  } catch (error) {
    console.warn("[agent-notifications] bounded Android notification poll failed", error);
  } finally {
    worker.syncing = false;
  }
}

function startWorker(worker: AndroidAgentNotificationWorker): void {
  if (!worker.stopped || Platform.OS !== "android") return;
  worker.stopped = false;
  void poll(worker);
  worker.interval = setInterval(() => void poll(worker), AGENT_NOTIFICATION_POLL_INTERVAL_MS);
}

function stopWorker(worker: AndroidAgentNotificationWorker): void {
  if (worker.stopped) return;
  worker.stopped = true;
  if (worker.interval !== null) {
    clearInterval(worker.interval);
    worker.interval = null;
  }
  void clearOngoingAgentNotification();
}

/**
 * Runs only in the background service. Polling deliberately avoids atom and
 * AppState subscriptions so queued-message state transitions cannot re-enter
 * the notification bridge or block the composer.
 */
export function acquireAndroidAgentNotifications(registry: AtomRegistry.AtomRegistry): () => void {
  let worker = workers.get(registry);
  if (worker === undefined) {
    worker = {
      registry,
      owners: 0,
      stopped: true,
      syncing: false,
      interval: null,
      initialized: false,
      previousStates: new Map(),
    };
    workers.set(registry, worker);
  }
  worker.owners += 1;
  startWorker(worker);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    worker.owners -= 1;
    if (worker.owners === 0) {
      stopWorker(worker);
      workers.delete(registry);
    }
  };
}
