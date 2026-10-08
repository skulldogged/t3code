import {
  type AgentDesktopViewer,
  createAgentDesktopViewer,
} from "@t3tools/client-runtime/agent-desktop/viewer";

import type {
  AgentDesktopStreamCommand,
  AgentDesktopStreamConfiguration,
  AgentDesktopStreamMessage,
} from "./agent-desktop-document";

declare global {
  interface Window {
    ReactNativeWebView: { postMessage: (message: string) => void };
    T3AgentDesktopStream?: {
      readonly start: typeof start;
      readonly command: typeof command;
      readonly stop: typeof stop;
    };
  }
}

// Kept in the hidden textarea so a soft keyboard's backspace has something to delete.
const SENTINEL = "​";

let viewer: AgentDesktopViewer | null = null;

const post = (message: AgentDesktopStreamMessage) =>
  window.ReactNativeWebView.postMessage(JSON.stringify(message));

export function start(configuration: AgentDesktopStreamConfiguration) {
  stop();
  document.body.style.background = configuration.background;
  const container = document.getElementById("screen")!;
  const keys = document.getElementById("keys") as HTMLTextAreaElement;
  const current = createAgentDesktopViewer({
    container,
    url: configuration.url,
    interactive: configuration.interactive,
    onControl: (control) => post({ type: "control", ...control }),
    onStatus: (status) => post({ type: "status", status }),
  });
  viewer = current;
  const reset = () => {
    keys.value = SENTINEL;
    keys.setSelectionRange(1, 1);
  };
  reset();
  keys.addEventListener("input", (event) => {
    const inputType = (event as InputEvent).inputType;
    if (inputType === "deleteContentBackward") current.pressKey("Backspace");
    else if (inputType === "insertLineBreak") current.pressKey("Enter");
    else current.typeText(keys.value.replaceAll(SENTINEL, ""));
    reset();
  });
  keys.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "Tab" || event.key === "Escape") {
      event.preventDefault();
      current.pressKey(event.key);
    }
  });
}

export function command(input: AgentDesktopStreamCommand) {
  if (input.type === "takeControl") viewer?.takeControl();
  else if (input.type === "releaseControl") viewer?.releaseControl();
  else document.getElementById("keys")?.focus();
}

export function stop() {
  viewer?.destroy();
  viewer = null;
}

// Loaded as a module, so the document and native commands reach it through window.
window.T3AgentDesktopStream = { start, command, stop };
