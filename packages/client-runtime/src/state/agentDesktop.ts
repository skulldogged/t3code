import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcSubscriptionAtomFamily } from "./runtime.ts";

export function createAgentDesktopEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** Server-pushed agent desktops for one environment, with who controls each. */
    state: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:agent-desktop:state",
      tag: WS_METHODS.subscribeAgentDesktopState,
    }),
  };
}
