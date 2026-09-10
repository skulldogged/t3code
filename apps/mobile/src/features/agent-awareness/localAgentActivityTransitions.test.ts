import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { AgentAwarenessPhase, AgentAwarenessState } from "@t3tools/shared/agentAwareness";
import { describe, expect, it } from "vite-plus/test";
import { advanceLocalAgentActivity } from "./localAgentActivityTransitions";

const state = (phase: AgentAwarenessPhase): AgentAwarenessState => ({
  environmentId: EnvironmentId.make("direct"),
  threadId: ThreadId.make("thread"),
  projectTitle: "Project",
  threadTitle: "Task",
  modelTitle: "Model",
  headline: "Task",
  phase,
  updatedAt: "2026-09-09T00:00:00Z",
  deepLink: "/threads/direct/thread",
});

describe("local activity transitions", () => {
  it("does not replay historical completions at startup", () => {
    expect(advanceLocalAgentActivity(new Map(), [state("completed")], true).alerts).toEqual([]);
  });
  it.each(["waiting_for_approval", "waiting_for_input", "completed", "failed"] as const)(
    "alerts once when a direct run becomes %s",
    (phase) => {
      const working = advanceLocalAgentActivity(new Map(), [state("running")], true);
      const changed = advanceLocalAgentActivity(working.next, [state(phase)], true);
      expect(changed.alerts).toEqual([state(phase)]);
      expect(advanceLocalAgentActivity(changed.next, [state(phase)], true).alerts).toEqual([]);
    },
  );
  it("observes foreground and disabled transitions without replaying them on backgrounding", () => {
    const working = advanceLocalAgentActivity(new Map(), [state("running")], false);
    const finished = advanceLocalAgentActivity(working.next, [state("completed")], false);
    expect(finished.alerts).toEqual([]);
    expect(advanceLocalAgentActivity(finished.next, [state("completed")], true).alerts).toEqual([]);
  });
  it("forgets removed direct targets so reconnecting cannot replay an old transition", () => {
    const working = advanceLocalAgentActivity(new Map(), [state("running")], true);
    const removed = advanceLocalAgentActivity(working.next, [], true);
    expect(removed.next.size).toBe(0);
    expect(advanceLocalAgentActivity(removed.next, [state("completed")], true).alerts).toEqual([]);
  });
});
