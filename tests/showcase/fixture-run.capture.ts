import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { defaultRunPolicy } from "@/domain/policy";
import { emptyMetrics } from "@/domain/run";
import { createRunId } from "@/lib/ids";
import { FakeBobAdapter } from "@/server/bob/fake-adapter";
import { GitWorktreeManager } from "@/server/git/worktrees";
import { runDeterministicPipeline } from "@/server/runs/orchestrator";
import { FileRunStore } from "@/server/runs/store";
import { SHOWCASE_LOCAL_ROOT, findAbsolutePaths } from "@/server/ui/sanitize";
import { makeTempDir } from "../helpers/factories";
import { FAKE_SCENARIO_DIR, FIXTURE_DIR, REPO_ROOT, copyFixture } from "../helpers/scenario";

/**
 * Captures a real deterministic PatchBench run of the auth-expiry-bug fixture
 * (FakeBobAdapter, zero Bobcoins) and exports a sanitized copy to
 * `showcase/runs/<run-id>/` for the hosted showcase and UI tests.
 *
 *   pnpm showcase:capture
 *
 * Absolute machine paths are rewritten to `<local>/…`; the export fails if
 * any absolute path survives. Worktrees are not exported.
 */
const FIXED_DATE = "2026-09-25T00:00:00Z";
const REPO_NAME = "auth-expiry-bug";
const OUT_ROOT = path.join(REPO_ROOT, "showcase", "runs");
const EXPORTED = /\.(json|jsonl|log|patch|sha256)$/;

function commitFixture(dir: string): string {
  const env = { NODE_ENV: "production" as const, PATH: process.env.PATH ?? "", HOME: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_DATE: FIXED_DATE, GIT_COMMITTER_DATE: FIXED_DATE };
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Shipyard Fixture", "-c", "user.email=fixture@patchbench.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", "-c", "core.autocrlf=false", ...args], { cwd: dir, env, encoding: "utf8" }).trim();
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "auth-expiry-bug fixture baseline");
  return git("rev-parse", "HEAD");
}

async function listFiles(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(root, p)));
    else if (EXPORTED.test(entry.name)) out.push(p);
  }
  return out.sort();
}

it("captures and exports the fixture run", async () => {
  const tmp = await makeTempDir("patchbench-showcase-");
  try {
    const primary = await copyFixture(path.join(tmp.dir, REPO_NAME));
    const sha = commitFixture(primary);
    const runtime = path.join(tmp.dir, ".patchbench");
    const store = new FileRunStore(runtime);
    const now = new Date();
    const runId = createRunId(now);
    const created = await store.createRun({
      id: runId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      repository: {
        root: primary,
        branch: "main",
        commitSha: sha,
        isDirty: false,
        packageManager: "pnpm",
        detectedScripts: { test: 'node --test "test/**/*.test.ts"', typecheck: "tsc --noEmit", lint: "tsc --noEmit --noUnusedLocals --noUnusedParameters", build: "tsc -p tsconfig.build.json" },
      },
      issue: {
        title: "Expired refresh token returns HTTP 500 instead of the documented 401",
        description:
          "POST /auth/refresh with a refresh token past its expiry responds 500 internal_error. AuthService.refresh throws TokenExpiredError, which the HTTP error mapper does not handle, so clients treat an expired session as an outage and retry.",
        expectedBehavior: "POST /auth/refresh with an expired refresh token responds 401. All other documented auth responses are unchanged.",
        actualBehavior: '500 {"error":"internal_error"}',
      },
      policy: defaultRunPolicy(),
      status: "CREATED",
      strategies: [],
      candidates: [],
      metrics: emptyMetrics(),
    });
    if (!created.ok) throw new Error(created.error.message);

    const result = await runDeterministicPipeline(
      { store, bob: new FakeBobAdapter(FAKE_SCENARIO_DIR), worktrees: new GitWorktreeManager(runtime) },
      { runId, dependencySource: path.join(FIXTURE_DIR, "node_modules") },
    );
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    expect(result.value.status).toBe("COMPLETE");

    // Sanitize + export.
    const src = store.runDir(runId);
    const dest = path.join(OUT_ROOT, runId);
    await rm(OUT_ROOT, { recursive: true, force: true }); // only PatchBench-exported captures live here
    await mkdir(dest, { recursive: true });
    const replacements: Array<[string, string]> = [
      [primary, `${SHOWCASE_LOCAL_ROOT}/${REPO_NAME}`],
      [tmp.dir, SHOWCASE_LOCAL_ROOT],
      [os.homedir(), "~"],
    ];
    for (const rel of await listFiles(src)) {
      let text = await readFile(path.join(src, rel), "utf8");
      for (const [from, to] of replacements) text = text.split(from).join(to);
      const leaks = findAbsolutePaths(text);
      if (leaks.length) throw new Error(`Absolute path survived sanitization in ${rel}: ${leaks[0]}`);
      await mkdir(path.dirname(path.join(dest, rel)), { recursive: true });
      await writeFile(path.join(dest, rel), text);
    }
    expect((await stat(path.join(dest, "run.json"))).isFile()).toBe(true);
    console.log(`showcase run exported: showcase/runs/${runId}`);
  } finally {
    await tmp.cleanup();
  }
}, 300_000);
