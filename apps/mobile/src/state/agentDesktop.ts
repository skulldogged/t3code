import { createAgentDesktopEnvironmentAtoms } from "@t3tools/client-runtime/state/agent-desktop";
import { resolveDeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import { AGENT_DESKTOP_STREAM_BASE_PATH, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";
import { environmentSession, usePreparedConnection } from "./session";

export const agentDesktopEnvironment = createAgentDesktopEnvironmentAtoms(connectionAtomRuntime);

const agentDesktopStreamAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(
        get(environmentSession.preparedConnectionValueAtom(environmentId)),
      );
      return prepared === null
        ? Effect.never
        : resolveDeviceHubAccess({ prepared, hubBasePath: AGENT_DESKTOP_STREAM_BASE_PATH });
    })
    .pipe(
      Atom.setIdleTTL(60_000),
      Atom.withLabel(`mobile-agent-desktop-stream-access:${environmentId}`),
    ),
);

export function useAgentDesktopStreamAccess(environmentId: EnvironmentId) {
  const prepared = usePreparedConnection(environmentId);
  const query = useEnvironmentQuery(agentDesktopStreamAccessAtom(environmentId));
  const access = query.data && query.error === null && Option.isSome(prepared) ? query.data : null;
  return { access, refresh: query.refresh };
}

export function useAgentDesktopState(environmentId: EnvironmentId) {
  const query = useEnvironmentQuery(agentDesktopEnvironment.state({ environmentId, input: {} }));
  return { desktops: query.data?.desktops ?? [], loaded: query.data !== undefined };
}
