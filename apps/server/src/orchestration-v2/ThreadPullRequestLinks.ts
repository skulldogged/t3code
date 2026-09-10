import type { OrchestrationV2AppThread, ThreadPullRequestLink } from "@t3tools/contracts";
import { legacyThreadPullRequestKey } from "@t3tools/shared/threadPullRequests";
import * as DateTime from "effect/DateTime";

/** Read old V2 payloads through the multi-link model until their next mutation. */
export function withThreadPullRequestLinks(
  thread: OrchestrationV2AppThread,
): OrchestrationV2AppThread {
  if (thread.pullRequests.length > 0 || thread.linkedPullRequest == null) return thread;
  const legacy = thread.linkedPullRequest;
  const link: ThreadPullRequestLink = {
    ...legacyThreadPullRequestKey(legacy),
    url: legacy.url,
    source: "manual",
    linkedAt: DateTime.formatIso(thread.createdAt),
    snapshot: null,
    stack: null,
  };
  return { ...thread, pullRequests: [link] };
}
