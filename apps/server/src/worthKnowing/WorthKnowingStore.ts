import {
  type ProjectId,
  type ThreadId,
  WorthKnowingError,
  WorthKnowingFinding,
  type WorthKnowingFindingId,
  type WorthKnowingThreadSummary,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** How many findings one thread keeps; older ones are pruned when a new one lands. */
const MAX_FINDINGS_PER_THREAD = 50;

/** Per project, how the user has been answering findings, so checks can back off. */
export interface WorthKnowingProjectState {
  /** Consecutive user messages sent past unanswered findings. */
  readonly ignoredStreak: number;
  /** Checks still to skip before the observer looks again. */
  readonly checksToSkip: number;
}

export interface StoredWorthKnowingFinding {
  readonly finding: WorthKnowingFinding;
  /** The user acted on it: opened its source, handed it to the agent, or changed its status. */
  readonly engaged: boolean;
}

export class WorthKnowingStore extends Context.Service<
  WorthKnowingStore,
  {
    readonly get: (
      id: WorthKnowingFindingId,
    ) => Effect.Effect<StoredWorthKnowingFinding | undefined, WorthKnowingError>;
    readonly listThread: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<StoredWorthKnowingFinding>, WorthKnowingError>;
    /** What the user said they already knew in this project, newest first. */
    readonly listKnown: (
      projectId: ProjectId,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<WorthKnowingFinding>, WorthKnowingError>;
    readonly listOpenSummaries: Effect.Effect<
      ReadonlyArray<WorthKnowingThreadSummary>,
      WorthKnowingError
    >;
    readonly insert: (finding: WorthKnowingFinding) => Effect.Effect<void, WorthKnowingError>;
    readonly update: (
      finding: WorthKnowingFinding,
      options?: { readonly engaged?: boolean },
    ) => Effect.Effect<void, WorthKnowingError>;
    /**
     * Marks the thread's open findings the user has not acted on, raised
     * before `before`, as passed over. Returns how many were newly marked.
     */
    readonly markIgnored: (
      threadId: ThreadId,
      before: string,
    ) => Effect.Effect<number, WorthKnowingError>;
    readonly deleteThread: (threadId: ThreadId) => Effect.Effect<void, WorthKnowingError>;
    readonly getProjectState: (
      projectId: ProjectId,
    ) => Effect.Effect<WorthKnowingProjectState, WorthKnowingError>;
    readonly setProjectState: (
      projectId: ProjectId,
      state: WorthKnowingProjectState,
    ) => Effect.Effect<void, WorthKnowingError>;
  }
>()("t3/worthKnowing/WorthKnowingStore") {}

const storeError = (operation: string) => (cause: unknown) =>
  new WorthKnowingError({ message: `Worth knowing storage failed to ${operation}.`, cause });

const decodeFinding = Schema.decodeUnknownEffect(Schema.fromJsonString(WorthKnowingFinding));
const encodeFinding = Schema.encodeEffect(Schema.fromJsonString(WorthKnowingFinding));

interface FindingRow {
  readonly payload_json: string;
  readonly engaged: number;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Created here rather than in a numbered migration: this table belongs to
  // the personal fork, and a fork migration would take an id upstream's next
  // migration needs.
  yield* Effect.all(
    [
      sql`
        CREATE TABLE IF NOT EXISTS worth_knowing_findings (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          status TEXT NOT NULL,
          tag TEXT NOT NULL,
          engaged INTEGER NOT NULL DEFAULT 0,
          ignored INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        )
      `,
      sql`
        CREATE INDEX IF NOT EXISTS idx_worth_knowing_findings_thread
        ON worth_knowing_findings (thread_id, created_at)
      `,
      sql`
        CREATE INDEX IF NOT EXISTS idx_worth_knowing_findings_project_status
        ON worth_knowing_findings (project_id, status)
      `,
      sql`
        CREATE TABLE IF NOT EXISTS worth_knowing_projects (
          project_id TEXT PRIMARY KEY,
          ignored_streak INTEGER NOT NULL,
          checks_to_skip INTEGER NOT NULL
        )
      `,
    ],
    { discard: true },
  ).pipe(Effect.orDie);

  const decodeRows = (rows: ReadonlyArray<FindingRow>) =>
    Effect.forEach(rows, (row) =>
      decodeFinding(row.payload_json).pipe(
        Effect.map((finding) => ({ finding, engaged: row.engaged === 1 })),
      ),
    );

  const get: WorthKnowingStore["Service"]["get"] = (id) =>
    sql<FindingRow>`
      SELECT payload_json, engaged FROM worth_knowing_findings WHERE id = ${id}
    `.pipe(
      Effect.flatMap(decodeRows),
      Effect.map((rows) => rows[0]),
      Effect.mapError(storeError("read a finding")),
    );

  const listThread: WorthKnowingStore["Service"]["listThread"] = (threadId) =>
    sql<FindingRow>`
      SELECT payload_json, engaged FROM worth_knowing_findings
      WHERE thread_id = ${threadId}
      ORDER BY created_at DESC
      LIMIT ${MAX_FINDINGS_PER_THREAD}
    `.pipe(Effect.flatMap(decodeRows), Effect.mapError(storeError("list a thread's findings")));

  const listKnown: WorthKnowingStore["Service"]["listKnown"] = (projectId, limit) =>
    sql<FindingRow>`
      SELECT payload_json, engaged FROM worth_knowing_findings
      WHERE project_id = ${projectId} AND status = 'known'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `.pipe(
      Effect.flatMap(decodeRows),
      Effect.map((rows) => rows.map((row) => row.finding)),
      Effect.mapError(storeError("list known topics")),
    );

  const listOpenSummaries: WorthKnowingStore["Service"]["listOpenSummaries"] = sql<{
    readonly thread_id: ThreadId;
    readonly tag: string;
    readonly created_at: string;
    readonly title: string | null;
  }>`
    SELECT thread_id, tag, created_at, json_extract(payload_json, '$.title') AS title
    FROM worth_knowing_findings
    WHERE status = 'open'
    ORDER BY created_at
  `.pipe(
    Effect.map((rows) => {
      const summaries = new Map<ThreadId, WorthKnowingThreadSummary>();
      for (const row of rows) {
        const prior = summaries.get(row.thread_id);
        const headsUp = row.tag === "heads_up";
        summaries.set(row.thread_id, {
          threadId: row.thread_id,
          openCount: (prior?.openCount ?? 0) + 1,
          headsUpCount: (prior?.headsUpCount ?? 0) + (headsUp ? 1 : 0),
          latestOpenAt: row.created_at,
          latestHeadsUpAt: headsUp ? row.created_at : (prior?.latestHeadsUpAt ?? null),
          latestHeadsUpTitle: headsUp ? row.title : (prior?.latestHeadsUpTitle ?? null),
        });
      }
      return [...summaries.values()];
    }),
    Effect.mapError(storeError("summarize open findings")),
  );

  const insert: WorthKnowingStore["Service"]["insert"] = (finding) =>
    encodeFinding(finding).pipe(
      Effect.flatMap((payload) =>
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO worth_knowing_findings (
                id, thread_id, project_id, status, tag, created_at, payload_json
              ) VALUES (
                ${finding.id},
                ${finding.threadId},
                ${finding.projectId},
                ${finding.status},
                ${finding.tag},
                ${finding.createdAt},
                ${payload}
              )
            `;
            yield* sql`
              DELETE FROM worth_knowing_findings
              WHERE thread_id = ${finding.threadId}
                AND id NOT IN (
                  SELECT id FROM worth_knowing_findings
                  WHERE thread_id = ${finding.threadId}
                  ORDER BY created_at DESC
                  LIMIT ${MAX_FINDINGS_PER_THREAD}
                )
            `;
          }),
        ),
      ),
      Effect.mapError(storeError("save a finding")),
    );

  const update: WorthKnowingStore["Service"]["update"] = (finding, options) =>
    encodeFinding(finding).pipe(
      Effect.flatMap(
        (payload) => sql`
          UPDATE worth_knowing_findings
          SET status = ${finding.status},
              payload_json = ${payload},
              engaged = CASE WHEN ${options?.engaged === true ? 1 : 0} = 1 THEN 1 ELSE engaged END
          WHERE id = ${finding.id}
        `,
      ),
      Effect.asVoid,
      Effect.mapError(storeError("update a finding")),
    );

  const markIgnored: WorthKnowingStore["Service"]["markIgnored"] = (threadId, before) =>
    sql<{ readonly id: string }>`
      UPDATE worth_knowing_findings
      SET ignored = 1
      WHERE thread_id = ${threadId}
        AND status = 'open'
        AND engaged = 0
        AND ignored = 0
        AND created_at < ${before}
      RETURNING id
    `.pipe(
      Effect.map((rows) => rows.length),
      Effect.mapError(storeError("mark passed-over findings")),
    );

  const deleteThread: WorthKnowingStore["Service"]["deleteThread"] = (threadId) =>
    sql`DELETE FROM worth_knowing_findings WHERE thread_id = ${threadId}`.pipe(
      Effect.asVoid,
      Effect.mapError(storeError("delete a thread's findings")),
    );

  const getProjectState: WorthKnowingStore["Service"]["getProjectState"] = (projectId) =>
    sql<{ readonly ignored_streak: number; readonly checks_to_skip: number }>`
      SELECT ignored_streak, checks_to_skip FROM worth_knowing_projects
      WHERE project_id = ${projectId}
    `.pipe(
      Effect.map((rows) => ({
        ignoredStreak: Number(rows[0]?.ignored_streak ?? 0),
        checksToSkip: Number(rows[0]?.checks_to_skip ?? 0),
      })),
      Effect.mapError(storeError("read project state")),
    );

  const setProjectState: WorthKnowingStore["Service"]["setProjectState"] = (projectId, state) =>
    sql`
      INSERT INTO worth_knowing_projects (project_id, ignored_streak, checks_to_skip)
      VALUES (${projectId}, ${state.ignoredStreak}, ${state.checksToSkip})
      ON CONFLICT (project_id) DO UPDATE SET
        ignored_streak = excluded.ignored_streak,
        checks_to_skip = excluded.checks_to_skip
    `.pipe(Effect.asVoid, Effect.mapError(storeError("save project state")));

  return WorthKnowingStore.of({
    get,
    listThread,
    listKnown,
    listOpenSummaries,
    insert,
    update,
    markIgnored,
    deleteThread,
    getProjectState,
    setProjectState,
  });
});

export const layer = Layer.effect(WorthKnowingStore, make);
