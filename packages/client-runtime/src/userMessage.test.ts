import { ScheduledTaskId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveUserMessagePresentation } from "./userMessage.ts";

describe("resolveUserMessagePresentation", () => {
  const legacyText = "[Triggered by schedule task: Daily audit]\n\nCheck for crashes.\n";

  it("removes attribution from legacy scheduled prompts", () => {
    expect(
      resolveUserMessagePresentation({ role: "user", createdBy: "agent", text: legacyText }),
    ).toEqual({ text: "Check for crashes.\n", isAutomation: true, scheduledTaskId: undefined });
  });

  it("uses task metadata without changing the prompt", () => {
    expect(
      resolveUserMessagePresentation({
        role: "user",
        createdBy: "agent",
        scheduledTaskId: ScheduledTaskId.make("task-1"),
        text: legacyText,
      }),
    ).toEqual({ text: legacyText, isAutomation: true, scheduledTaskId: "task-1" });
  });

  it("preserves user-written and assistant-quoted schedule headers", () => {
    for (const message of [
      { role: "user", createdBy: "user" as const },
      { role: "user" },
      { role: "assistant", createdBy: "agent" as const },
    ]) {
      expect(resolveUserMessagePresentation({ ...message, text: legacyText })).toEqual({
        text: legacyText,
        isAutomation: false,
        scheduledTaskId: undefined,
      });
    }
  });

  it("leaves other agent prompts and embedded headers intact", () => {
    for (const text of [
      "Review this area",
      `Quoted prompt:\n${legacyText}`,
      "[Triggered by schedule task: Daily audit]",
    ]) {
      expect(resolveUserMessagePresentation({ role: "user", createdBy: "agent", text })).toEqual({
        text,
        isAutomation: false,
        scheduledTaskId: undefined,
      });
    }
  });

  it("recovers the triggering automation from older scheduler message ids", () => {
    for (const trigger of ["scheduled", "manual"]) {
      expect(
        resolveUserMessagePresentation({
          id: `scheduled-task-message:task:daily-audit:1788661140000:${trigger}`,
          role: "user",
          createdBy: "user",
          text: legacyText,
        }),
      ).toEqual({
        text: "Check for crashes.\n",
        isAutomation: true,
        scheduledTaskId: "task:daily-audit",
      });
    }
  });

  it("presents delegated completions from structured task metadata", () => {
    expect(
      resolveUserMessagePresentation({
        role: "user",
        text: "Delegated task node:internal reached a terminal state.",
        delegatedCompletion: { taskIds: ["node:internal"] },
        delegatedTasks: [
          {
            id: "node:internal",
            title: "Fix mobile child-agent list clutter",
            status: "completed",
          },
        ],
      }),
    ).toEqual({
      text: "Delegated task completed: Fix mobile child-agent list clutter",
      isAutomation: false,
      scheduledTaskId: undefined,
    });
  });

  it("keeps multiple delegated task titles and their individual terminal states", () => {
    expect(
      resolveUserMessagePresentation({
        role: "user",
        text: "provider continuation instructions",
        delegatedCompletion: { taskIds: ["one", "two", "missing"] },
        delegatedTasks: [
          { id: "one", title: "Collect logs", status: "failed" },
          { id: "two", title: "Update release notes", status: "cancelled" },
        ],
      }),
    ).toMatchObject({
      text: "Delegated task updates: failed: Collect logs; cancelled: Update release notes; another task finished",
    });
  });

  it("does not rewrite matching text without delegated-completion provenance", () => {
    const text = "Delegated task node:internal reached a terminal state.";
    expect(resolveUserMessagePresentation({ role: "user", text })).toMatchObject({ text });
  });
});
