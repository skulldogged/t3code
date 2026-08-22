#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";

const [version, outputDirectory] = process.argv.slice(2);
if (!version || !outputDirectory) {
  throw new Error("Usage: pack-server-artifact.ts VERSION OUTPUT_DIRECTORY");
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const packagePath = path.join(repoRoot, "apps/server/package.json");
const workspacePath = path.join(repoRoot, "pnpm-workspace.yaml");
const originalPackage = readFileSync(packagePath, "utf8");
const packageJson = JSON.parse(originalPackage) as Record<string, unknown>;
const workspace = parse(readFileSync(workspacePath, "utf8")) as {
  catalog?: Record<string, string>;
  overrides?: Record<string, string>;
};

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

try {
  writeFileSync(packagePath, `${JSON.stringify(publishPackage, null, 2)}\n`);
  const packed = spawnSync(
    "npm",
    ["pack", "./apps/server", "--pack-destination", outputDirectory],
    { cwd: repoRoot, encoding: "utf8", stdio: "inherit" },
  );
  if (packed.status !== 0) {
    throw new Error(`npm pack failed with exit code ${packed.status ?? "unknown"}`);
  }
} finally {
  writeFileSync(packagePath, originalPackage);
}
