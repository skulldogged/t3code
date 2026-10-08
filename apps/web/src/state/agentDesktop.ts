import { useAtomValue } from "@effect/atom-react";
import { createAgentDesktopEnvironmentAtoms } from "@t3tools/client-runtime/state/agent-desktop";
import {
  type DeviceHubAccess,
  resolveDeviceHubAccess,
} from "@t3tools/client-runtime/state/deviceHubAccess";
import {
  AGENT_DESKTOP_STREAM_BASE_PATH,
  type AgentDesktopState,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironmentQuery } from "./query";
import { environmentSession } from "./session";

export const agentDesktopEnvironment = createAgentDesktopEnvironmentAtoms(connectionAtomRuntime);

const EMPTY_AGENT_DESKTOP_STATE: AgentDesktopState = { desktops: [] };

export function useAgentDesktopState(environmentId: EnvironmentId | null): {
  readonly state: AgentDesktopState;
  readonly loaded: boolean;
} {
  const query = useEnvironmentQuery(
    environmentId === null ? null : agentDesktopEnvironment.state({ environmentId, input: {} }),
  );
  return { state: query.data ?? EMPTY_AGENT_DESKTOP_STATE, loaded: query.data !== undefined };
}

// Re-pairing changes the prepared connection, invalidating its cached ticket.
const agentDesktopStreamAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(
        get(environmentSession.preparedConnectionValueAtom(environmentId)),
      );
      if (prepared === null) return Effect.never;
      return resolveDeviceHubAccess({ prepared, hubBasePath: AGENT_DESKTOP_STREAM_BASE_PATH });
    })
    .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`agent-desktop-stream-access:${environmentId}`)),
);

export function useAgentDesktopStreamAccess(environmentId: EnvironmentId): DeviceHubAccess | null {
  const result = useAtomValue(agentDesktopStreamAccessAtom(environmentId));
  return AsyncResult.isSuccess(result) ? result.value : null;
}

export function refreshAgentDesktopStreamAccess(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(agentDesktopStreamAccessAtom(environmentId));
}
