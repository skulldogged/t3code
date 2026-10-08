import { AgentDesktopToolError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as AgentDesktopService from "../../../agentDesktop/AgentDesktopService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { AgentDesktopToolkit } from "./tools.ts";

const callerThread = McpInvocationContext.McpInvocationContext.pipe(
  Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, "Desktop tools")),
  Effect.map((scope) => scope.thread.threadId),
);

const toolError = (error: { readonly message: string }) =>
  new AgentDesktopToolError({ reason: error.message });

const handlers = {
  agent_desktop_register: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const threadId = yield* callerThread;
      const desktops = yield* AgentDesktopService.AgentDesktopService;
      return yield* desktops.register(threadId, input).pipe(Effect.mapError(toolError));
    }),
  ),
  agent_desktop_unregister: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const threadId = yield* callerThread;
      const desktops = yield* AgentDesktopService.AgentDesktopService;
      yield* desktops.unregister(threadId, input.desktopId);
      return {};
    }),
  ),
  agent_desktop_status: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const threadId = yield* callerThread;
      const desktops = yield* AgentDesktopService.AgentDesktopService;
      return yield* desktops.status(threadId, input.desktopId);
    }),
  ),
  agent_desktop_request: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const threadId = yield* callerThread;
      const desktops = yield* AgentDesktopService.AgentDesktopService;
      yield* desktops
        .request(threadId, input.desktopId, input.reason)
        .pipe(Effect.mapError(toolError));
      return {};
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof AgentDesktopToolkit.tools>;

export const layer = McpToolAccess.toLayer(AgentDesktopToolkit, handlers);
