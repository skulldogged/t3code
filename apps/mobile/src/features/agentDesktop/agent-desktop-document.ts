import type {
  AgentDesktopControl,
  AgentDesktopViewerStatus,
} from "@t3tools/client-runtime/agent-desktop/viewer";

export interface AgentDesktopStreamConfiguration {
  /** The stream's WebSocket URL, ticket included. */
  readonly url: string;
  /** The floating player only watches. */
  readonly interactive: boolean;
  readonly background: string;
}

/** Messages the WebView document posts to the native view. */
export type AgentDesktopStreamMessage =
  | ({ readonly type: "control" } & AgentDesktopControl)
  | { readonly type: "status"; readonly status: AgentDesktopViewerStatus | "error" };

/** Commands the native view sends the document. */
export type AgentDesktopStreamCommand =
  | { readonly type: "takeControl" }
  | { readonly type: "releaseControl" }
  | { readonly type: "keyboard" };

export function agentDesktopDocument(configuration: string, script: string) {
  // Tickets and URLs are data, including any HTML delimiter characters.
  const safeConfiguration = configuration.replace(/</g, "\\u003c");
  const safeScript = script.replace(/<\/script/gi, "<\\/script");
  const failure = `window.ReactNativeWebView.postMessage(JSON.stringify({type:"status",status:"error"}));`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html, body { height: 100%; overflow: hidden; margin: 0; }
  #screen { position: fixed; inset: 0; overflow: hidden; touch-action: none; }
  /* Pinned so focus never scrolls; 16px keeps iOS from zooming on focus. */
  textarea {
    position: fixed; left: 0; top: 0; width: 1px; height: 1px;
    padding: 0; margin: -1px; border: 0; overflow: hidden; opacity: 0; font-size: 16px;
  }
</style></head><body><div id="screen"></div><textarea id="keys" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"></textarea><script>window.addEventListener("error",function(){${failure}});window.addEventListener("unhandledrejection",function(){${failure}});</script>
<script type="module">${safeScript}</script>
<script type="module">try{window.T3AgentDesktopStream.start(${safeConfiguration});}catch{${failure}}</script></body></html>`;
}

export function agentDesktopMessage(data: string): AgentDesktopStreamMessage | null {
  try {
    // Only our bundled viewer runs in this WebView.
    return JSON.parse(data) as AgentDesktopStreamMessage;
  } catch {
    return null;
  }
}
