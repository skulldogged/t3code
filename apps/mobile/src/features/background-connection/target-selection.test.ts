import { describe, expect, it } from "vite-plus/test";
import {
  presentThreadShell,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectId,
  RunId,
  ThreadId,
  type ScopedThreadRef,
  type OrchestrationV2RunStatus,
} from "@t3tools/contracts";
import { makeRawThreadShell } from "../../test-fixtures";

import { selectBackgroundConnectionThreadTargets } from "./target-selection";

const environmentId = EnvironmentId.make("environment-1");
const projectId = ProjectId.make("project-1");

function shell(id: string, status: OrchestrationV2RunStatus | "idle"): EnvironmentThreadShell {
  return presentThreadShell(
    environmentId,
    makeRawThreadShell({
      id: ThreadId.make(id),
      projectId,
      title: id,
      status,
      latestRunId: status === "idle" ? null : RunId.make(`run-${id}`),
      activeRunId: status === "idle" ? null : RunId.make(`run-${id}`),
    }),
  );
}

describe("background connection target selection", () => {
  it("keeps the retained thread followed by starting and running threads", () => {
    const retained: ScopedThreadRef = {
      environmentId,
      threadId: ThreadId.make("retained"),
    };

    expect(
      selectBackgroundConnectionThreadTargets(retained, [
        shell("settled", "idle"),
        shell("starting", "starting"),
        shell("running", "running"),
      ]),
    ).toEqual([
      retained,
      { environmentId, threadId: ThreadId.make("starting") },
      { environmentId, threadId: ThreadId.make("running") },
    ]);
  });

  it("deduplicates a retained running thread without changing order", () => {
    const retained = { environmentId, threadId: ThreadId.make("running") };
    expect(
      selectBackgroundConnectionThreadTargets(retained, [
        shell("running", "running"),
        shell("other", "starting"),
      ]),
    ).toEqual([retained, { environmentId, threadId: ThreadId.make("other") }]);
  });

  it("drops active targets after their shell settles", () => {
    expect(selectBackgroundConnectionThreadTargets(null, [shell("task", "running")])).toHaveLength(
      1,
    );
    expect(selectBackgroundConnectionThreadTargets(null, [shell("task", "idle")])).toEqual([]);
  });

  it.each(["preparing", "queued", "waiting"] as const)("retains V2 %s runs", (status) => {
    expect(selectBackgroundConnectionThreadTargets(null, [shell("task", status)])).toEqual([
      { environmentId, threadId: ThreadId.make("task") },
    ]);
  });
});
