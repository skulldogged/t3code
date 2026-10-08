/**
 * Who controls an agent desktop, apart from the viewer itself: React Native
 * code can import this, while the viewer (noVNC, which uses top-level await)
 * only runs inside a WebView.
 *
 * @module agentDesktop/control
 */
import type { AgentDesktopStreamStatus } from "@t3tools/contracts";

export interface AgentDesktopControl {
  /** Whether this viewer may take control at all. */
  readonly canOperate: boolean;
  readonly controller: AgentDesktopStreamStatus["state"];
}

export function agentDesktopControlLabel(control: AgentDesktopControl | null): string {
  if (control === null) return "Connecting…";
  switch (control.controller) {
    case "you":
      return "You have control";
    case "another-viewer":
      return "Another viewer has control";
    case "agent":
      return control.canOperate ? "Agent is driving" : "Watching";
  }
}
