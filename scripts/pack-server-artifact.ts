#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { parse } from "yaml";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";

class PackServerArtifactError extends Schema.TaggedError<PackServerArtifactError>()(
  "PackServerArtifactError",
  { message: Schema.String },
) {}

const main = Effect.gen(function* () {
  const [version, outputDirectory] = process.argv.slice(2);
  if (!version || !outputDirectory) {
    return yield* new PackServerArtifactError({
      message: "Usage: pack-server-artifact.ts VERSION OUTPUT_DIRECTORY",
    });
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const packagePath = path.join(repoRoot, "apps/server/package.json");
  const originalPackage = yield* fs.readFileString(packagePath);
  const packageJson = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
  )(originalPackage);
  const workspaceText = yield* fs.readFileString(path.join(repoRoot, "pnpm-workspace.yaml"));
  const workspace = yield* Effect.try(
    () => parse(workspaceText) as { catalog?: Record<string, string> },
  );
  const publishPackage = {
    name: packageJson.name,
    version,
    license: packageJson.license,
    repository: packageJson.repository,
    bin: packageJson.bin,
    files: packageJson.files,
    type: packageJson.type,
    dependencies: resolveCatalogDependencies(
      packageJson.dependencies as Record<string, string>,
      workspace.catalog ?? {},
      "apps/server",
    ),
    engines: packageJson.engines,
  };
  yield* Effect.gen(function* () {
    const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
      publishPackage,
    );
    yield* fs.writeFileString(packagePath, `${encoded}\n`);
    const child = yield* spawner.spawn(
      ChildProcess.make("npm", ["pack", "./apps/server", "--pack-destination", outputDirectory], {
        cwd: repoRoot,
        stdout: "inherit",
        stderr: "inherit",
      }),
    );
    const exitCode = yield* child.exitCode;
    if (exitCode !== 0)
      return yield* new PackServerArtifactError({
        message: `npm pack failed with exit code ${exitCode}`,
      });
  }).pipe(Effect.ensuring(fs.writeFileString(packagePath, originalPackage).pipe(Effect.orDie)));
});

main.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
