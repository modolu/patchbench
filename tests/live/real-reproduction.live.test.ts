import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRunPolicy } from "@/domain/policy";
import { emptyMetrics, type PatchBenchRun } from "@/domain/run";
import { createRunId } from "@/lib/ids";
import { detectBobIntegration } from "@/server/bob/detect";
import { ManualBobAdapter } from "@/server/bob/manual-adapter";
import { runReproductionGate } from "@/server/reproduction/reproduction-service";
import { GitWorktreeManager } from "@/server/git/worktrees";
import { transitionRun } from "@/server/runs/lifecycle";
import { FileRunStore } from "@/server/runs/store";
import { redactSecrets, secretEnvValues } from "@/server/runner/redaction";
import { captureBaseline } from "@/server/verification/baseline";
import { REPO_ROOT } from "../helpers/scenario";

/**
 * ONE controlled live IBM Bob reproduction of fixtures/auth-expiry-bug (T05).
 * Spends Bobcoins, so it is gated twice: a separate vitest config and
 * PATCHBENCH_LIVE_BOB=1. Everything Bob can see lives under
 * PATCHBENCH_LIVE_ROOT, outside this repository, so the fake-Bob answer key
 * and fixture notes are unreachable from the Bob workspace.
 *
 *   PATCHBENCH_LIVE_BOB=1 PATCHBENCH_LIVE_ROOT=~/patchbench-live-t05 pnpm test:live-bob
 *
 * Then open <root>/HANDOFF.md and run its packet as one Bob IDE task.
 */
const LIVE = process.env.PATCHBENCH_LIVE_BOB === "1";
/** Overridable only so the plumbing can be dry-run without writing into bob_sessions/. */
const EVIDENCE_DIR = process.env.PATCHBENCH_LIVE_EVIDENCE_DIR ?? path.join(REPO_ROOT, "bob_sessions", "shipyard_t05_real_reproduction_run");

const ISSUE: PatchBenchRun["issue"] = {
  title: "Expired refresh token returns HTTP 500 instead of 401",
  description:
    "POST /auth/refresh with an expired refresh token responds with HTTP 500 { error: \"internal_error\" }. Clients treat 5xx as an outage and retry instead of sending the user back to log in.",
  expectedBehavior: "POST /auth/refresh with an expired refresh token responds with HTTP 401, as documented in the README API contract.",
  actualBehavior: "HTTP 500 internal_error.",
};

function sh(cwd: string, command: string, ...args: string[]): string {
  // Per-command identity/config only; global Git config is never read or written.
  return execFileSync(command, args, { cwd, encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: cwd, GIT_CONFIG_NOSYSTEM: "1" } }).trim();
}

async function assertOutsideRepo(root: string): Promise<string> {
  if (!path.isAbsolute(root)) throw new Error("PATCHBENCH_LIVE_ROOT must be absolute.");
  if (await stat(root).then(() => true, () => false)) throw new Error(`${root} already exists; use a fresh directory.`);
  await mkdir(root, { recursive: true });
  const real = await realpath(root);
  const rel = path.relative(await realpath(REPO_ROOT), real);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error("PATCHBENCH_LIVE_ROOT must be outside the PatchBench repository.");
  return real;
}

/** Copies the run's evidence into bob_sessions/, with local paths and secrets scrubbed. */
async function exportEvidence(store: FileRunStore, runId: string, root: string, extra: Record<string, unknown>) {
  const src = store.runDir(runId);
  const home = process.env.HOME ?? "";
  const secrets = secretEnvValues(process.env);
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(path.join(src, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) await walk(r);
      else if (e.isFile()) {
        const text = (await readFile(path.join(src, r), "utf8")).split(root).join("<LIVE_ROOT>").split(home).join("~");
        await mkdir(path.dirname(path.join(EVIDENCE_DIR, r)), { recursive: true });
        await writeFile(path.join(EVIDENCE_DIR, r), redactSecrets(text, secrets));
      }
    }
  };
  await walk("");
  await writeFile(
    path.join(EVIDENCE_DIR, "LABEL.json"),
    `${JSON.stringify({ label: "REAL IBM Bob run (manual Bob IDE hand-off) — not a FakeBob fixture", task: "PatchBench T05 — Real Reproduction", runId, ...extra }, null, 2)}\n`,
  );
}

describe.skipIf(!LIVE)("T05 — live IBM Bob reproduction (manual Bob IDE hand-off)", () => {
  it("Bob's regression test is independently confirmed by the reproduction gate", async () => {
    const root = await assertOutsideRepo(process.env.PATCHBENCH_LIVE_ROOT ?? "");
    const timeoutMs = Number(process.env.PATCHBENCH_LIVE_TIMEOUT_MIN ?? "60") * 60_000;
    const integration = await detectBobIntegration();

    // Deterministic fixture repo, cloned outside this repository with no remote back to it.
    const prepared = path.join(REPO_ROOT, ".patchbench", "fixture-repos", "auth-expiry-bug");
    sh(REPO_ROOT, process.execPath, "scripts/prepare-fixture.mts");
    const repo = path.join(root, "repo");
    sh(root, "git", "clone", "-q", "--no-hardlinks", prepared, repo);
    sh(repo, "git", "remote", "remove", "origin");
    const baseSha = sh(repo, "git", "rev-parse", "HEAD");
    expect(baseSha).toBe(sh(prepared, "git", "rev-parse", "HEAD"));

    const runtime = path.join(root, "runtime");
    const store = new FileRunStore(runtime);
    const worktrees = new GitWorktreeManager(runtime);
    const now = new Date();
    const runId = createRunId(now);
    const policy = defaultRunPolicy({
      verificationCommands: [{ name: "test", command: "node", args: ["--test", "--test-reporter=tap", "test/**/*.test.ts"], required: true }],
      requireBuild: false,
      requireTypecheck: false,
    });
    const created = await store.createRun({
      id: runId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      repository: { root: repo, branch: "main", commitSha: baseSha, isDirty: false, packageManager: "pnpm", detectedScripts: { test: "node --test \"test/**/*.test.ts\"" } },
      issue: ISSUE,
      policy,
      status: "CREATED",
      strategies: [],
      candidates: [],
      metrics: emptyMetrics(),
    });
    if (!created.ok) throw new Error(created.error.message);

    expect((await transitionRun(store, runId, "BASELINING")).ok).toBe(true);
    const baseline = await captureBaseline({ store, worktrees }, { runId });
    if (!baseline.ok) throw new Error(baseline.error.message);
    expect(baseline.value.failures).toEqual([]);
    expect((await transitionRun(store, runId, "REPRODUCING")).ok).toBe(true);
    const ws = await worktrees.createWorkspace({ repoRoot: repo, runId, baseSha, kind: "reproduction" });
    if (!ws.ok) throw new Error(ws.error.message);

    const bob = new ManualBobAdapter({
      handoffDir: (id) => path.join(store.runDir(id), "handoff"),
      timeoutMs,
      pollIntervalMs: 2_000,
      regressionCommand: policy.regressionCommand,
      onPacketReady: ({ packetPath, workspace, resultPath }) => {
        const next = `# PatchBench T05 — Real Reproduction (hand-off)\n\n1. Open this folder in IBM Bob IDE: \`${workspace}\`\n2. Start ONE Bob task named "PatchBench T05 — Real Reproduction" and paste the whole packet from:\n   \`${packetPath}\`\n3. Wait for Bob to write \`${resultPath}\`. PatchBench is polling and will verify automatically.\n`;
        void writeFile(path.join(root, "HANDOFF.md"), next);
        console.log(`\n${next}`);
      },
    });
    const gated = await runReproductionGate({ store, bob }, { runId, workspace: ws.value.path, primaryRoot: repo });
    if (!gated.ok) throw new Error(gated.error.message);
    const run = gated.value;
    const events = (await readFile(path.join(store.runDir(runId), "events.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { type: string; data: Record<string, unknown> });
    await exportEvidence(store, runId, root, {
      integration: integration.kind,
      bobInvocations: 1,
      finalStatus: run.status,
      outcome: run.reproduction?.outcome ?? null,
      statusPath: events.filter((e) => e.type === "run.status_changed").map((e) => e.data.to),
    });

    expect(run.status, JSON.stringify(run.failure ?? run.reproduction)).toBe("STRATEGIZING");
    expect(run.reproduction?.outcome).toBe("REPRODUCED");
    expect(run.reproduction?.frozenPatchSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(events.map((e) => e.type)).toContain("reproduction.frozen");
    const log = await readFile(path.join(store.runDir(runId), "reproduction", "logs", "baseline.log"), "utf8");
    expect(log).toMatch(/\b500\b/);
    expect(log).toMatch(/\b401\b/);
    expect(log).toContain("ERR_ASSERTION");
    expect(sh(repo, "git", "status", "--porcelain")).toBe("");
  });
});
