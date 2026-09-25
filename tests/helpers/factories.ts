import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultRunPolicy } from "@/domain/policy";
import { emptyMetrics, type PatchBenchRun } from "@/domain/run";

export function makeRun(overrides: Partial<PatchBenchRun> = {}): PatchBenchRun {
  return {
    id: "run-20260925120000-abc123",
    createdAt: "2026-09-25T12:00:00.000Z",
    updatedAt: "2026-09-25T12:00:00.000Z",
    repository: {
      root: "/tmp/repo",
      branch: "main",
      commitSha: "a".repeat(40),
      isDirty: false,
      packageManager: "pnpm",
      detectedScripts: { test: "node --test" },
    },
    issue: {
      title: "Expired refresh token returns 500",
      description: "POST /auth/refresh with an expired token responds 500.",
      expectedBehavior: "Respond 401 with error token_expired.",
    },
    policy: defaultRunPolicy(),
    status: "CREATED",
    strategies: [],
    candidates: [],
    metrics: emptyMetrics(),
    ...overrides,
  };
}

/** Temp dir resolved through realpath (macOS /var → /private/var). */
export async function makeTempDir(prefix = "patchbench-test-"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
