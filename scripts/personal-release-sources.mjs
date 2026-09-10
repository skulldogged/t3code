import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validatePersonalSources(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !/^[a-f0-9]{40}$/.test(value.mainSha ?? "") ||
    !Array.isArray(value.overlays)
  ) {
    throw new Error("Expected mainSha and an array of pull-request source heads.");
  }
  const seen = new Set();
  for (const entry of value.overlays) {
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(entry.repository ?? "") ||
      !Number.isSafeInteger(entry.number) ||
      entry.number <= 0 ||
      !/^[a-f0-9]{40}$/.test(entry.sha ?? "")
    ) {
      throw new Error("Invalid pull-request source.");
    }
    const key = `${entry.repository}#${entry.number}`;
    if (seen.has(key)) throw new Error(`Duplicate pull-request source: ${key}`);
    seen.add(key);
  }
  return {
    mainSha: value.mainSha,
    overlays: value.overlays.map(({ repository, number, sha }) => ({ repository, number, sha })),
  };
}

export function writePersonalSources({ cwd, input, expectedSha, outputDirectory }) {
  const sources = validatePersonalSources(input);
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const integrationSha = git("rev-parse", "HEAD");
  if (expectedSha && integrationSha !== expectedSha)
    throw new Error("Release checkout differs from the requested integration commit.");
  for (const sha of [sources.mainSha, ...sources.overlays.map(({ sha }) => sha)]) {
    git("merge-base", "--is-ancestor", sha, integrationSha);
  }
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    resolve(outputDirectory, "personal-sources.json"),
    `${JSON.stringify({ schemaVersion: 1, integrationSha, ...sources }, null, 2)}\n`,
  );
  const lines = [
    `Built from integration commit \`${integrationSha}\`.`,
    "",
    `- Upstream main: [${sources.mainSha.slice(0, 12)}](https://github.com/pingdotgg/t3code/commit/${sources.mainSha})`,
    ...sources.overlays.map(
      ({ repository, number, sha }) =>
        `- ${repository}#${number}: [${sha.slice(0, 12)}](https://github.com/${repository}/commit/${sha})`,
    ),
    "",
    "The nightly version is a release-ordering label; source revisions are recorded above and in personal-sources.json.",
  ];
  writeFileSync(resolve(outputDirectory, "personal-release-notes.md"), `${lines.join("\n")}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writePersonalSources({
    cwd: process.cwd(),
    input: JSON.parse(
      process.env.SOURCE_MANIFEST || readFileSync(".github/personal-sources.json", "utf8"),
    ),
    expectedSha: process.env.EXPECTED_SHA,
    outputDirectory: process.argv[2] || "release-provenance",
  });
}
