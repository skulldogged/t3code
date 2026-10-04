import {
  worthKnowingAgentPrompt,
  worthKnowingFindingsForRun,
} from "@t3tools/client-runtime/state/worth-knowing";
import type {
  EnvironmentId,
  RunId,
  ScopedThreadRef,
  ThreadId,
  WorthKnowingFinding,
  WorthKnowingFindingAction,
} from "@t3tools/contracts";
import { LightbulbIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { worthKnowing } from "~/state/worthKnowing";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { InlineButton } from "../ui/button";

const EMPTY_FINDINGS: ReadonlyArray<WorthKnowingFinding> = [];

/** The thread's findings, newest first, kept live while the thread is open. */
export function useThreadWorthKnowing(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): ReadonlyArray<WorthKnowingFinding> {
  const query = useEnvironmentQuery(
    environmentId === null || threadId === null
      ? null
      : worthKnowing.threadFindings({ environmentId, input: { threadId } }),
  );
  return query.data?.findings ?? EMPTY_FINDINGS;
}

/** Finding actions, plus handing a finding to the agent through the composer. */
export function useWorthKnowingActions(
  environmentId: EnvironmentId,
  composerTarget: ScopedThreadRef | null,
) {
  const updateFinding = useAtomCommand(worthKnowing.updateFinding, {
    label: "update worth knowing finding",
  });
  const update = useCallback(
    (finding: WorthKnowingFinding, action: WorthKnowingFindingAction) => {
      void updateFinding({ environmentId, input: { findingId: finding.id, action } });
    },
    [environmentId, updateFinding],
  );
  const askAgent = useCallback(
    (finding: WorthKnowingFinding) => {
      if (composerTarget === null) return;
      const store = useComposerDraftStore.getState();
      const current = store.getComposerDraft(composerTarget)?.prompt ?? "";
      const prompt = worthKnowingAgentPrompt(finding);
      store.setPrompt(
        composerTarget,
        current.trim().length === 0 ? prompt : `${current.trimEnd()}\n\n${prompt}`,
      );
      update(finding, "engaged");
    },
    [composerTarget, update],
  );
  return useMemo(
    () => ({ update, askAgent: composerTarget === null ? null : askAgent }),
    [askAgent, composerTarget, update],
  );
}

export function worthKnowingTagLabel(finding: WorthKnowingFinding): string {
  return finding.tag === "heads_up" ? "Heads up" : "You should know";
}

/** Where a finding's quote came from, shown when the user asks for its source. */
export function WorthKnowingSource({ finding }: { readonly finding: WorthKnowingFinding }) {
  if (finding.evidence === null) return null;
  return (
    <figure className="flex flex-col gap-1 border-l-2 border-border pl-2.5 text-xs">
      <blockquote className="whitespace-pre-wrap break-words font-mono text-secondary-label">
        {finding.evidence.quote}
      </blockquote>
      {finding.evidence.label === null ? null : (
        <figcaption className="text-muted-foreground">{finding.evidence.label}</figcaption>
      )}
    </figure>
  );
}

function WorthKnowingFindingRow({
  finding,
  cwd,
  environmentId,
  threadRef,
  actions,
}: {
  readonly finding: WorthKnowingFinding;
  readonly cwd: string | undefined;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | null;
  readonly actions: ReturnType<typeof useWorthKnowingActions>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const open = finding.status === "open";

  if (!open) {
    return (
      <div className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {finding.title}
          {finding.status === "resolved"
            ? " · addressed later"
            : finding.status === "known"
              ? " · you knew this"
              : " · dismissed"}
        </span>
        <InlineButton tone="muted" onClick={() => actions.update(finding, "restore")}>
          Restore
        </InlineButton>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-worth-knowing-finding={finding.id}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Badge size="sm" variant={finding.tag === "heads_up" ? "warning" : "info"}>
          {worthKnowingTagLabel(finding)}
        </Badge>
        <span className="min-w-0 text-sm font-medium text-foreground">{finding.title}</span>
      </div>
      <p className="text-sm text-secondary-label">{finding.learn}</p>
      {expanded && finding.body.length > 0 ? (
        <ChatMarkdown
          text={finding.body}
          cwd={cwd}
          environmentId={environmentId}
          threadRef={threadRef ?? undefined}
          isStreaming={false}
          headingLevelOffset={3}
        />
      ) : null}
      {sourceOpen ? <WorthKnowingSource finding={finding} /> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {finding.body.length > 0 ? (
          <InlineButton
            tone="muted"
            aria-expanded={expanded}
            onClick={() => {
              if (!expanded) actions.update(finding, "engaged");
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Less" : "Explain"}
          </InlineButton>
        ) : null}
        {finding.evidence === null ? null : (
          <InlineButton
            tone="muted"
            aria-expanded={sourceOpen}
            onClick={() => {
              if (!sourceOpen) actions.update(finding, "engaged");
              setSourceOpen(!sourceOpen);
            }}
          >
            {sourceOpen ? "Hide source" : "Show source"}
          </InlineButton>
        )}
        {actions.askAgent === null ? null : (
          <InlineButton tone="muted" onClick={() => actions.askAgent?.(finding)}>
            Ask agent
          </InlineButton>
        )}
        <InlineButton tone="muted" onClick={() => actions.update(finding, "known")}>
          Knew this
        </InlineButton>
        <InlineButton tone="muted" onClick={() => actions.update(finding, "dismiss")}>
          Dismiss
        </InlineButton>
      </div>
    </div>
  );
}

/**
 * What the observer flagged while reading one run, under that run's final
 * answer. Renders nothing for runs it raised nothing about.
 */
export function WorthKnowingRunCard({
  environmentId,
  threadId,
  runId,
  threadRef,
  cwd,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly threadRef: ScopedThreadRef | null;
  readonly cwd: string | undefined;
}) {
  const findings = useThreadWorthKnowing(environmentId, threadId);
  const actions = useWorthKnowingActions(environmentId, threadRef);
  const [showClosed, setShowClosed] = useState(false);
  const runFindings = worthKnowingFindingsForRun(findings, runId);
  if (runFindings.length === 0) return null;
  const openFindings = runFindings.filter((finding) => finding.status === "open");
  const closedFindings = runFindings.filter((finding) => finding.status !== "open");

  // Once everything is closed, only a quiet way back remains.
  if (openFindings.length === 0 && !showClosed) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <LightbulbIcon className="size-3.5" aria-hidden />
        <InlineButton tone="muted" aria-expanded={false} onClick={() => setShowClosed(true)}>
          {closedFindings.length === 1
            ? "1 closed finding"
            : `${closedFindings.length} closed findings`}
        </InlineButton>
      </div>
    );
  }

  return (
    <section
      aria-label="Worth knowing"
      className="mt-3 flex flex-col gap-3 rounded-lg border border-border/60 px-3 py-2.5"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <LightbulbIcon className="size-3.5" aria-hidden />
        <span>Worth knowing</span>
        {closedFindings.length > 0 ? (
          <span className="ml-auto">
            <InlineButton
              tone="muted"
              aria-expanded={showClosed}
              onClick={() => setShowClosed(!showClosed)}
            >
              {showClosed ? "Hide closed" : `${closedFindings.length} closed`}
            </InlineButton>
          </span>
        ) : null}
      </div>
      {[...openFindings, ...(showClosed ? closedFindings : [])].map((finding) => (
        <WorthKnowingFindingRow
          key={finding.id}
          finding={finding}
          cwd={cwd}
          environmentId={environmentId}
          threadRef={threadRef}
          actions={actions}
        />
      ))}
    </section>
  );
}
