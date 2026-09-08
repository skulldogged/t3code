import { assert, it, vi } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ProjectId, ServerSettingsError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";

it.effect("resolves setup scripts through the standalone project service", () => {
  const open = vi.fn((input: Parameters<TerminalManager.TerminalManager["Service"]["open"]>[0]) =>
    Effect.succeed({
      threadId: input.threadId,
      terminalId: input.terminalId,
      cwd: input.cwd,
      worktreePath: input.worktreePath ?? null,
      status: "running" as const,
      pid: 123,
      history: "",
      exitCode: null,
      exitSignal: null,
      label: "Shell",
      updatedAt: "2026-06-20T00:00:00.000Z",
    }),
  );
  const write = vi.fn(
    (_input: Parameters<TerminalManager.TerminalManager["Service"]["write"]>[0]) => Effect.void,
  );
  const projectId = ProjectId.make("project:setup-runner-v2");
  let settings = DEFAULT_SERVER_SETTINGS;
  let project = {
    id: projectId,
    title: "Project",
    workspaceRoot: "/repo",
    repositoryIdentity: null,
    faviconPath: null,
    defaultModelSelection: null,
    scripts: [
      {
        id: "setup",
        name: "Setup",
        command: "vp install",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
      },
    ],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    deletedAt: null,
  };
  const layer = ProjectSetupScriptRunner.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeed(Option.some(project)),
        }),
        Layer.mock(TerminalManager.TerminalManager)({ open, write }),
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.sync(() => settings),
        }),
      ),
    ),
  );

  return Effect.gen(function* () {
    const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
    const result = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
    });
    assert.deepEqual(result, {
      status: "started",
      scriptId: "setup",
      scriptName: "Setup",
      terminalId: "setup-setup",
      cwd: "/repo-worktree",
    });
    assert.equal(open.mock.calls[0]?.[0].cwd, "/repo-worktree");
    assert.equal(write.mock.calls[0]?.[0].data, "vp install\r");
    project = { ...project, scripts: [] };
    const defaultScript = {
      id: "default",
      name: "Default setup",
      command: "vp i",
      icon: "configure" as const,
      runOnWorktreeCreate: true,
    };
    settings = { ...settings, defaultProjectScripts: [defaultScript] };
    const inherited = yield* runner.runForThread({
      threadId: "thread-2",
      projectId,
      worktreePath: "/repo-worktree",
    });
    assert.equal(inherited.status, "started");
    assert.equal(write.mock.calls[1]?.[0].data, "vp i\r");
    settings = { ...settings, projectScriptOverrides: { [projectId]: [] } };
    assert.deepEqual(
      yield* runner.runForThread({
        threadId: "thread-3",
        projectId,
        worktreePath: "/repo-worktree",
        project,
      }),
      { status: "no-script" },
    );
    assert.equal(open.mock.calls.length, 2);
    assert.equal(write.mock.calls.length, 2);
    settings = {
      ...settings,
      projectScriptOverrides: { [projectId]: [{ ...defaultScript, command: "vp custom" }] },
    };
    yield* runner.runForThread({
      threadId: "thread-4",
      projectId,
      worktreePath: "/repo-worktree",
      project,
    });
    assert.equal(write.mock.calls[2]?.[0].data, "vp custom\r");
  }).pipe(Effect.provide(layer));
});

for (const operation of ["readSettings", "openTerminal", "writeCommand"] as const) {
  it.effect(`preserves the exact ${operation} failure and stops later setup effects`, () => {
    const rootCause = new Error("setup dependency failed");
    const settingsError = new ServerSettingsError({
      settingsPath: "/test/settings.json",
      operation: "read-file",
      cause: rootCause,
    });
    const terminalError = new TerminalManager.TerminalCwdStatError({
      cwd: "/repo-worktree",
      cause: rootCause,
    });
    const open = vi.fn(() =>
      operation === "openTerminal"
        ? Effect.fail(terminalError)
        : Effect.succeed({
            threadId: "thread-failure",
            terminalId: "setup-setup",
            cwd: "/repo-worktree",
            worktreePath: "/repo-worktree",
            status: "running" as const,
            pid: 123,
            history: "",
            exitCode: null,
            exitSignal: null,
            label: "Setup",
            updatedAt: "2026-06-20T00:00:00.000Z",
          }),
    );
    const write = vi.fn(() => Effect.fail(terminalError));
    const projectId = ProjectId.make("project:setup-failure");
    const layer = ProjectSetupScriptRunner.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProjectService.ProjectService)({}),
          Layer.mock(TerminalManager.TerminalManager)({ open, write }),
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings:
              operation === "readSettings"
                ? Effect.fail(settingsError)
                : Effect.succeed(DEFAULT_SERVER_SETTINGS),
          }),
        ),
      ),
    );
    return Effect.gen(function* () {
      const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
      const error = yield* runner
        .runForThread({
          threadId: "thread-failure",
          projectId,
          worktreePath: "/repo-worktree",
          project: {
            id: projectId,
            workspaceRoot: "/repo",
            scripts: [
              {
                id: "setup",
                name: "Setup",
                command: "vp i",
                icon: "configure",
                runOnWorktreeCreate: true,
              },
            ],
          },
        })
        .pipe(Effect.flip);
      assert.equal(error._tag, "ProjectSetupScriptOperationError");
      if (error._tag !== "ProjectSetupScriptOperationError") return;
      assert.equal(error.operation, operation);
      assert.strictEqual(error.cause, operation === "readSettings" ? settingsError : terminalError);
      assert.equal(error.threadId, "thread-failure");
      assert.equal(error.worktreePath, "/repo-worktree");
      assert.equal(open.mock.calls.length, operation === "readSettings" ? 0 : 1);
      assert.equal(write.mock.calls.length, operation === "writeCommand" ? 1 : 0);
    }).pipe(Effect.provide(layer));
  });
}
