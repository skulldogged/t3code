import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationV2Base } from "./051_OrchestrationV2.ts";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const rollbackLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const unknownManifestLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

rollbackLayer("051_OrchestrationV2 reconciliation rollback", (it) => {
  it.effect("rolls back a failed canonical pull-request migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 49 });
      yield* OrchestrationV2Base;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name, created_at)
        VALUES (50, 'OrchestrationV2', '2026-01-02 03:04:05')
      `;
      yield* sql`CREATE TABLE projection_thread_pull_requests (thread_id TEXT PRIMARY KEY)`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES ('project:rollback', 'Rollback', '/tmp/rollback', '[]',
          '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z', NULL)
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, linked_pull_request_json, created_at, updated_at
        ) VALUES ('thread:rollback', 'project:rollback', 'Rollback',
          '{"instanceId":"codex","model":"gpt-5.4"}',
          '{"repository":"acme/rollback","number":1,"url":"https://github.com/acme/rollback/pull/1"}',
          '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z')
      `;

      const result = yield* Effect.result(runMigrations());
      assert.ok(Result.isFailure(result));
      assert.deepStrictEqual(
        yield* sql`SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 50`,
        [{ migration_id: 50, name: "OrchestrationV2" }],
      );
      assert.deepStrictEqual(yield* sql`PRAGMA table_info(projection_thread_pull_requests)`, [
        {
          cid: 0,
          name: "thread_id",
          type: "TEXT",
          notnull: 0,
          dflt_value: null,
          pk: 1,
        },
      ]);
      assert.deepStrictEqual(
        yield* sql`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'orchestration_v2_projection_subagents'
        `,
        [],
      );
      const eventColumns = yield* sql<{
        readonly name: string;
      }>`PRAGMA table_info(orchestration_v2_events)`;
      assert.ok(!eventColumns.some(({ name }) => name === "driver"));
    }),
  );
});

unknownManifestLayer("051_OrchestrationV2 reconciliation manifest validation", (it) => {
  it.effect("rejects an unrecognized ledger without applying pending migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 49 });
      yield* sql`UPDATE effect_sql_migrations SET name = 'UnknownMigration' WHERE migration_id = 49`;

      const result = yield* Effect.result(runMigrations());
      assert.ok(Result.isFailure(result));
      assert.deepStrictEqual(
        yield* sql`SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 49`,
        [{ migration_id: 49, name: "UnknownMigration" }],
      );
      assert.deepStrictEqual(
        yield* sql`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'projection_thread_pull_requests'
        `,
        [],
      );
    }),
  );
});

layer("051_OrchestrationV2 reconciliation", (it) => {
  it.effect("finishes an early partial private V2 prefix without rerunning its base schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* OrchestrationV2Base;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name, created_at)
        VALUES (44, 'OrchestrationV2', '2026-01-02 03:04:05')
      `;

      const executed = yield* runMigrations();
      assert.deepStrictEqual(executed, [
        [44, "ClearAutomaticProjectModelDefaults"],
        [45, "ProjectionProjectsAutoPull"],
        [46, "RepairAutomaticSettlementTimestamps"],
        [47, "ProjectionProjectIcon"],
        [48, "ProjectionThreadBranchPullRequest"],
        [49, "ProjectionThreadsActiveOrderKey"],
        [50, "ProjectionThreadPullRequests"],
        [51, "OrchestrationV2"],
      ]);
      const migrations = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 44 ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        { migration_id: 44, name: "ClearAutomaticProjectModelDefaults" },
        { migration_id: 45, name: "ProjectionProjectsAutoPull" },
        { migration_id: 46, name: "RepairAutomaticSettlementTimestamps" },
        { migration_id: 47, name: "ProjectionProjectIcon" },
        { migration_id: 48, name: "ProjectionThreadBranchPullRequest" },
        { migration_id: 49, name: "ProjectionThreadsActiveOrderKey" },
        { migration_id: 50, name: "ProjectionThreadPullRequests" },
        { migration_id: 51, name: "OrchestrationV2" },
      ]);
    }),
  );

  it.effect("preserves an installed private V2 schema and its import sources", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      assert.deepStrictEqual(
        yield* sql`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'orchestration_v2_agent_session_import_sources'
        `,
        [],
      );
      yield* sql`
        CREATE TABLE orchestration_v2_agent_session_import_sources (
          thread_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          source_json TEXT NOT NULL,
          PRIMARY KEY (thread_id, file_path)
        )
      `;
      yield* sql`
        INSERT INTO orchestration_v2_agent_session_import_sources (thread_id, file_path, source_json)
        VALUES ('thread:preserved', '/tmp/session.json', '{"source":"legacy"}')
      `;
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 50`;
      const historicalNames = [
        "OrchestrationV2",
        "OrchestrationV2Subagents",
        "OrchestrationV2Foundation",
        "OrchestrationV2ProviderSessionBindings",
        "OrchestrationV2ThreadLaunchWorkflows",
        "ApplicationEventSource",
        "OrchestrationV2EffectCancellation",
        "ScheduledTasks",
        "LegacyV1ImportState",
        "ApplicationEventSequenceIndexes",
        "OrchestrationV2RecoveryIndexes",
        "OrchestrationV2ShellIndexes",
        "AgentSessionImportSources",
      ];
      for (const [offset, name] of historicalNames.entries()) {
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name, created_at)
          VALUES (${50 + offset}, ${name}, '2026-01-02 03:04:05')
        `;
      }

      yield* runMigrations();
      assert.deepStrictEqual(
        yield* sql`SELECT thread_id, file_path, source_json FROM orchestration_v2_agent_session_import_sources`,
        [
          {
            thread_id: "thread:preserved",
            file_path: "/tmp/session.json",
            source_json: '{"source":"legacy"}',
          },
        ],
      );
      assert.deepStrictEqual(
        yield* sql`
          SELECT migration_id, strftime('%Y-%m-%d %H:%M:%S', created_at) AS created_at
          FROM effect_sql_migrations
          WHERE migration_id = 51
          ORDER BY migration_id
        `,
        [{ migration_id: 51, created_at: "2026-01-02 03:04:05" }],
      );
      assert.deepStrictEqual(yield* runMigrations(), []);
    }),
  );
});
