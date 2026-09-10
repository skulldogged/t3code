import { AsyncResult, type AtomRegistry } from "effect/unstable/reactivity";
import { AppState, Platform } from "react-native";
import type { AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";
import { advanceLocalAgentActivity } from "./localAgentActivityTransitions";

import { environmentCatalog } from "../../connection/catalog";
import { environmentProjects } from "../../state/projects";
import { environmentThreadShells } from "../../state/threads";
import { mobilePreferencesAtom } from "../../state/preferences";
import {
  publishLocalAndroidAgentActivity,
  publishLocalAndroidAgentAlert,
  configureLocalAndroidAgentActivity,
} from "./androidNotifications";
import {
  buildLocalAgentActivityAggregate,
  buildLocalAgentAwarenessStates,
} from "./localAgentActivityAggregate";

const POLL_INTERVAL_MS = 2_000;
const workers = new WeakMap<
  AtomRegistry.AtomRegistry,
  {
    owners: number;
    timer: ReturnType<typeof setInterval> | null;
    previous: Map<string, AgentAwarenessPhase>;
    releasePreferences: () => void;
    releaseAppState: () => void;
  }
>();

function sync(registry: AtomRegistry.AtomRegistry): void {
  if (Platform.OS !== "android") return;
  const preferences = registry.get(mobilePreferencesAtom);
  if (!AsyncResult.isSuccess(preferences)) {
    publishLocalAndroidAgentActivity("", "", "/", false);
    return;
  }
  const localActivityEnabled = preferences.value.liveActivitiesEnabled !== false;
  configureLocalAndroidAgentActivity(localActivityEnabled);
  const shouldNotify = localActivityEnabled && AppState.currentState !== "active";
  const catalog = registry.get(environmentCatalog.catalogValueAtom);
  const directEnvironmentIds = new Set(
    [...catalog.entries].flatMap(([environmentId, entry]) =>
      entry.target._tag === "RelayConnectionTarget" ? [] : [environmentId],
    ),
  );
  const projects = registry.get(environmentProjects.projectsAtom);
  const threads = registry
    .get(environmentThreadShells.threadShellsAtom)
    .filter((thread) => directEnvironmentIds.has(thread.environmentId));
  const aggregate = buildLocalAgentActivityAggregate({
    projects,
    threads,
  });
  const worker = workers.get(registry);
  const states = buildLocalAgentAwarenessStates({ projects, threads });
  if (worker) {
    const { next, alerts } = advanceLocalAgentActivity(worker.previous, states, shouldNotify);
    worker.previous = next;
    for (const state of alerts) {
      const title =
        state.phase === "waiting_for_approval"
          ? "Approval required"
          : state.phase === "waiting_for_input"
            ? "Input required"
            : state.phase === "failed"
              ? "Turn failed"
              : "Turn completed";
      publishLocalAndroidAgentAlert(
        `${title}: ${state.threadTitle}`,
        `${state.projectTitle} · ${state.modelTitle}`,
        state.deepLink,
        `${state.environmentId}:${state.threadId}:${state.phase}`,
      );
    }
  }
  if (!shouldNotify || !aggregate) {
    publishLocalAndroidAgentActivity("", "", "/", false);
    return;
  }
  const primary = aggregate.activities[0]!;
  publishLocalAndroidAgentActivity(
    aggregate.activeCount === 1
      ? `${primary.status}: ${primary.threadTitle}`
      : `${aggregate.activeCount} active agents`,
    `${primary.projectTitle} · ${primary.status}`,
    primary.deepLink,
    true,
  );
}

/** Keeps direct and Tailscale activity visible while the headless connection is mounted. */
export function acquireLocalDirectAgentActivity(registry: AtomRegistry.AtomRegistry): () => void {
  let worker = workers.get(registry);
  if (!worker) {
    worker = {
      owners: 0,
      timer: null,
      previous: new Map(),
      releasePreferences: registry.mount(mobilePreferencesAtom),
      releaseAppState: () => {},
    };
    workers.set(registry, worker);
    const subscription = AppState.addEventListener("change", () => sync(registry));
    worker.releaseAppState = () => subscription.remove();
  }
  worker.owners += 1;
  if (worker.timer === null && Platform.OS === "android") {
    sync(registry);
    worker.timer = setInterval(() => sync(registry), POLL_INTERVAL_MS);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--worker.owners === 0) {
      worker.releasePreferences();
      worker.releaseAppState();
      if (worker.timer) clearInterval(worker.timer);
      publishLocalAndroidAgentActivity("", "", "/", false);
      workers.delete(registry);
    }
  };
}
