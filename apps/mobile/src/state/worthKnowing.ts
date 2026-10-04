import { createWorthKnowingAtoms } from "@t3tools/client-runtime/state/worth-knowing";

import { connectionAtomRuntime } from "../connection/runtime";

export const worthKnowing = createWorthKnowingAtoms(connectionAtomRuntime);
