import type { AgentAwarenessState, AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";

const attentionPhases = new Set<AgentAwarenessPhase>([
  "waiting_for_approval",
  "waiting_for_input",
  "completed",
  "failed",
]);

export function advanceLocalAgentActivity(
  previous: ReadonlyMap<string, AgentAwarenessPhase>,
  states: ReadonlyArray<AgentAwarenessState>,
  notify: boolean,
) {
  const next = new Map<string, AgentAwarenessPhase>();
  const alerts: AgentAwarenessState[] = [];
  for (const state of states) {
    const key = `${state.environmentId}:${state.threadId}`;
    const oldPhase = previous.get(key);
    next.set(key, state.phase);
    if (
      notify &&
      oldPhase !== undefined &&
      oldPhase !== state.phase &&
      attentionPhases.has(state.phase)
    ) {
      alerts.push(state);
    }
  }
  return { next, alerts };
}
