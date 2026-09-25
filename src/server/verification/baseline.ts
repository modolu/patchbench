import path from "node:path";
import { pbError, type PatchBenchError } from "@/domain/errors";
import type { BaselineResult } from "@/domain/run";
import { err, ok, type Result } from "@/lib/result";
import { systemClock, type Clock } from "@/lib/time";
import { provisionNodeModules } from "../candidates/dependencies";
import type { WorktreeManager } from "../git/worktrees";
import { detectScripts, verificationCommandsFor } from "../runner/script-detector";
import { writeFileExclusive } from "../reproduction/regression-artifact";
import type { FileRunStore } from "../runs/store";
import { runCheck } from "./checks";

export interface BaselineDeps {
  store: FileRunStore;
  worktrees: WorktreeManager;
  clock?: Clock;
}

export const baselineDir = (store: FileRunStore, runId: string): string => path.join(store.runDir(runId), "baseline");

/**
 * Runs the shared verification commands against `run.repository.commitSha`
 * in a clean, detached, PatchBench-owned `baseline` worktree — never in the
 * (possibly dirty) primary worktree. Failures are recorded, not fatal: they
 * are the `baselineFailures` later subtracted from every candidate.
 * Requires BASELINING; persists run.baseline and baseline/result.json.
 */
export async function captureBaseline(
  deps: BaselineDeps,
  input: { runId: string; dependencySource?: string; signal?: AbortSignal },
): Promise<Result<BaselineResult, PatchBenchError>> {
  const { store, worktrees } = deps;
  const clock = deps.clock ?? systemClock;
  const loaded = await store.loadRun(input.runId);
  if (!loaded.ok) return loaded;
  const run = loaded.value;
  if (run.status !== "BASELINING") return err(pbError("INVALID_TRANSITION", `Baseline capture requires BASELINING, run is ${run.status}.`));
  if (run.baseline) return err(pbError("RUN_CORRUPT", "Baseline was already captured for this run."));

  const started = clock.now().getTime();
  const ws = await worktrees.createWorkspace({ repoRoot: run.repository.root, runId: run.id, baseSha: run.repository.commitSha, kind: "baseline" });
  if (!ws.ok) return ws;
  if (input.dependencySource) {
    const deps = await provisionNodeModules(ws.value.path, input.dependencySource);
    if (!deps.ok) return deps;
  }
  // Commands come from the committed package.json, so uncommitted script edits cannot influence them.
  let policy = run.policy;
  if (policy.verificationCommands.length === 0) {
    const scripts = await detectScripts(ws.value.path);
    if (!scripts) return err(pbError("SCRIPT_NOT_FOUND", "No readable package.json at the baseline commit."));
    policy = { ...policy, verificationCommands: verificationCommandsFor(scripts, policy) };
    await store.saveRun({ ...run, policy });
  }
  await store.appendEvent(run.id, {
    type: "baseline.started",
    data: { commitSha: run.repository.commitSha, checks: policy.verificationCommands.map((c) => c.name), commands: policy.verificationCommands.map((c) => [c.command, ...c.args].join(" ")) },
  });

  const dir = baselineDir(store, run.id);
  const checks = [];
  for (const cmd of policy.verificationCommands) {
    if (input.signal?.aborted) return err(pbError("COMMAND_CANCELLED", "Baseline capture was cancelled.", { recoverable: true }));
    const check = await runCheck(cmd, {
      cwd: ws.value.path,
      logFile: path.join(dir, "logs", `${cmd.name}.log`),
      logPath: `baseline/logs/${cmd.name}.log`,
      policy,
      signal: input.signal,
    });
    checks.push(check);
    await store.appendEvent(run.id, {
      type: "baseline.check_completed",
      data: { check: check.name, passed: check.passed, exitCode: check.exitCode, durationMs: check.durationMs, failureCount: check.failures.length },
    });
  }

  const testCheck = checks.find((c) => c.name === "test");
  const baseline: BaselineResult = {
    commitSha: run.repository.commitSha,
    checks,
    failures: testCheck?.failures ?? [],
    durationMs: Math.max(0, clock.now().getTime() - started),
  };
  const written = await writeFileExclusive(path.join(dir, "result.json"), `${JSON.stringify(baseline, null, 2)}\n`);
  if (!written.ok) return err(pbError("RUN_CORRUPT", "Baseline result already exists.", { detail: written.error.detail }));

  const current = await store.loadRun(run.id);
  if (!current.ok) return current;
  await store.saveRun({
    ...current.value,
    baseline,
    metrics: {
      ...current.value.metrics,
      commandsExecuted: current.value.metrics.commandsExecuted + checks.length,
      stageDurationsMs: { ...current.value.metrics.stageDurationsMs, baseline: baseline.durationMs },
    },
  });
  await store.appendEvent(run.id, {
    type: "baseline.completed",
    data: { passed: checks.filter((c) => c.passed).map((c) => c.name), failed: checks.filter((c) => !c.passed).map((c) => c.name), failureCount: baseline.failures.length },
  });
  return ok(baseline);
}
