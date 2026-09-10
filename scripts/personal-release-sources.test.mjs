import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validatePersonalSources, writePersonalSources } from "./personal-release-sources.mjs";

test("rejects malformed or duplicate source identities", () => {
  assert.throws(() => validatePersonalSources({ mainSha: "main", overlays: [] }));
  const source = { repository: "pingdotgg/t3code", number: 2829, sha: "a".repeat(40) };
  assert.throws(() =>
    validatePersonalSources({ mainSha: "b".repeat(40), overlays: [source, source] }),
  );
});

test("records exact ancestors and refuses a different checkout or unmerged overlay", () => {
  const cwd = mkdtempSync(join(tmpdir(), "t3-personal-sources-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Source test");
    git("config", "user.email", "source-test@example.invalid");
    git("commit", "--allow-empty", "-m", "main");
    const mainSha = git("rev-parse", "HEAD");
    git("checkout", "-b", "overlay");
    git("commit", "--allow-empty", "-m", "overlay");
    const sha = git("rev-parse", "HEAD");
    const input = { mainSha, overlays: [{ repository: "pingdotgg/t3code", number: 2829, sha }] };
    const outputDirectory = join(cwd, "artifact");
    writePersonalSources({ cwd, input, expectedSha: sha, outputDirectory });
    assert.deepEqual(
      JSON.parse(readFileSync(join(outputDirectory, "personal-sources.json"), "utf8")),
      { schemaVersion: 1, integrationSha: sha, ...input },
    );
    assert.throws(
      () => writePersonalSources({ cwd, input, expectedSha: mainSha, outputDirectory }),
      /differs/,
    );
    git("checkout", "main");
    assert.throws(() =>
      writePersonalSources({ cwd, input, expectedSha: mainSha, outputDirectory }),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
