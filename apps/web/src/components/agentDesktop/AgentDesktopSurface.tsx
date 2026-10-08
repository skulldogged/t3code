import { withDeviceHubQuery } from "@t3tools/client-runtime/state/deviceHubAccess";
import {
  type AgentDesktopControl,
  type AgentDesktopViewer,
  type AgentDesktopViewerStatus,
  agentDesktopControlLabel,
  createAgentDesktopViewer,
} from "@t3tools/client-runtime/agent-desktop/viewer";
import type { AgentDesktopSummary, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { cn, randomUUID } from "~/lib/utils";
import {
  refreshAgentDesktopStreamAccess,
  useAgentDesktopState,
  useAgentDesktopStreamAccess,
} from "~/state/agentDesktop";

/** Tickets are short-lived; a refused stream gets a fresh one this many times in a row. */
const MAX_REFUSALS = 3;

// One key per desktop for this window, so control follows the desktop when it
// moves between the panel and the floating player.
const viewerKeys = new Map<string, string>();
const viewerKeyFor = (environmentId: EnvironmentId, desktopId: string) => {
  const id = `${environmentId}:${desktopId}`;
  let key = viewerKeys.get(id);
  if (key === undefined) {
    key = randomUUID();
    viewerKeys.set(id, key);
  }
  return key;
};

export function AgentDesktopSurface(props: {
  readonly environmentId: EnvironmentId;
  readonly desktop: Pick<AgentDesktopSummary, "id" | "title" | "width" | "height">;
  readonly interactive: boolean;
  /** The floating player shows only the screen. */
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const { environmentId, interactive } = props;
  const desktopId = props.desktop.id;
  const access = useAgentDesktopStreamAccess(environmentId);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<AgentDesktopViewer | null>(null);
  const refusals = useRef(0);
  const [control, setControl] = useState<AgentDesktopControl | null>(null);
  const [status, setStatus] = useState<AgentDesktopViewerStatus>("connecting");

  useEffect(() => {
    const container = containerRef.current;
    if (access === null || container === null) return;
    const query = new URLSearchParams({
      desktopId,
      viewer: viewerKeyFor(environmentId, desktopId),
      ...(interactive ? {} : { interactive: "false" }),
    });
    const viewer = createAgentDesktopViewer({
      container,
      url: withDeviceHubQuery(`${access.wsBase}/ws?${query.toString()}`, access),
      interactive,
      onControl: setControl,
      onStatus: (next) => {
        setStatus(next);
        if (next === "live") refusals.current = 0;
        if (next === "refused" && refusals.current < MAX_REFUSALS) {
          refusals.current += 1;
          refreshAgentDesktopStreamAccess(environmentId);
        }
      },
    });
    viewerRef.current = viewer;
    return () => {
      viewer.destroy();
      viewerRef.current = null;
      setControl(null);
    };
  }, [access, desktopId, environmentId, interactive]);

  const youHaveControl = control?.controller === "you";
  const problem =
    status === "gone"
      ? "This desktop has stopped."
      : status === "refused" && refusals.current >= MAX_REFUSALS
        ? "Couldn't connect to this desktop."
        : null;

  return (
    <div
      className={cn("relative flex min-h-0 flex-col overflow-hidden", props.className)}
      data-agent-desktop-surface={desktopId}
    >
      {props.compact ? null : (
        <div className="relative z-20 flex shrink-0 items-center gap-2 border-b border-border bg-background px-2 py-1">
          <span className="min-w-0 truncate text-xs font-medium">{props.desktop.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {props.desktop.width}×{props.desktop.height}
          </span>
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                youHaveControl ? "bg-emerald-500" : "bg-sky-500",
                control === null && "bg-muted-foreground/50",
              )}
            />
            {agentDesktopControlLabel(control)}
          </span>
          <span className="flex-1" />
          {control?.canOperate ? (
            <Button
              variant={youHaveControl ? "outline" : "default"}
              size="xs"
              disabled={control.controller === "another-viewer"}
              onClick={() =>
                youHaveControl
                  ? viewerRef.current?.releaseControl()
                  : viewerRef.current?.takeControl()
              }
            >
              {youHaveControl ? "Give back to agent" : "Take control"}
            </Button>
          ) : null}
        </div>
      )}
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden bg-black/80",
          youHaveControl && !props.compact && "ring-2 ring-emerald-500/70 ring-inset",
        )}
      >
        <div ref={containerRef} className="absolute inset-0" />
        {problem ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
            {problem}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The right panel's desktop tab: the desktop while it's registered, a note once it stops. */
export function AgentDesktopPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly desktopId: string;
  readonly title?: string | undefined;
}) {
  const { state, loaded } = useAgentDesktopState(props.threadRef.environmentId);
  const desktop = state.desktops.find((entry) => entry.id === props.desktopId);
  if (desktop === undefined) {
    return (
      <div className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {loaded ? `${props.title ?? props.desktopId} isn't running anymore.` : "Connecting…"}
      </div>
    );
  }
  return (
    <AgentDesktopSurface
      className="size-full"
      environmentId={props.threadRef.environmentId}
      desktop={desktop}
      interactive
    />
  );
}
