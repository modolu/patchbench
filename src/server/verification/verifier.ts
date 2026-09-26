import path from "node:path";
import type { CandidateResult } from "@/domain/candidate";
import { pbError, type PatchBenchError } from "@/domain/errors";
import type { CheckResult, VerificationResult } from "@/domain/evidence";
import type { VerificationCommand } from "@/domain/policy";
import { err, ok, type Result } from "@/lib/result";
import { systemClock, type Clock } from "@/lib/time";
import { GitAdapter } from "../git/git-adapter";
import { candidateBranchName, candidateWorktreePath } from "../git/worktrees";
import { loadFrozenArtifact, verifyFrozenRegression } from "../reproduction/regression-artifact";
import { transitionCandidate } from "../runs/lifecycle";
import { writeFileAtomic, type FileRunStore } from "../runs/store";
import { runCheck } from "./checks";
import { summarizeDiff } from "./diff-analysis";
import { compareFailures, hardGateReasons } from "./gates";

export interface VerifierDeps {
  store: FileRunStore;
  clock?: Clock;
}

export const candidateDir = (store: FileRunStore, runId: string, candidateId: string): string =>
  path.join(store.runDir(runId), "candidates", candidateId);

/** `candidates/<id>/result.json`: a deterministic projection of the candidate in run.json. */
export async function writeCandidateProjection(store: FileRunStore, runId: string, candidate: CandidateResult): Promise<void> {
  await writeFileAtomic(path.join(candidateDir(store, runId, candidate.id), "result.json"), `${JSON.stringify(candidate, null, 2)}\n`);
}

const skipped = (name: string, command?: CheckResult["command"]): CheckResult => ({
  name, passed: false, exitCode: null, durationMs: 0, timedOut: false, failures: [], skipped: true, ...(command ? { command } : {}),
});

/**
 * Shared verifier: every candidate gets the identical frozen regression and
 * the identical baseline-configured commands, in order: integrity →
 * regression → tests → typecheck → lint → build → diff. Moves the candidate
 * VERIFYING → ELIGIBLE | REJECTED; a rejection never fails the run.
 */
export async function verifyCandidate(
  deps: VerifierDeps,
  input: { runId: string; candidateId: string; signal?: AbortSignal },
): Promise<Result<CandidateResult, PatchBenchError>> {
  const { store } = deps;
  const clock = deps.clock ?? systemClock;
  const loaded = await store.loadRun(input.runId);
  if (!loaded.ok) return loaded;
  const run = loaded.value;
  if (run.status !== "VERIFYING") return err(pbError("INVALID_TRANSITION", `Verification requires VERIFYING, run is ${run.status}.`));
  const candidate = run.candidates.find((c) => c.id === input.candidateId);
  if (!candidate || candidate.status !== "VERIFYING") return err(pbError("INVALID_TRANSITION", `Candidate ${input.candidateId} is not VERIFYING.`));
  if (!run.baseline) return err(pbError("RUN_CORRUPT", "Run has no baseline evidence to compare against."));
  let ownedPath: string;
  let ownedBranch: string;
  try {
    ownedPath = candidateWorktreePath(store.runtimeRoot, run.id, candidate.id);
    ownedBranch = candidateBranchName(run.id, candidate.id);
  } catch (cause) {
    return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Candidate id is not PatchBench-owned.", { detail: String(cause) }));
  }
  if (path.resolve(candidate.worktreePath) !== ownedPath || candidate.branchName !== ownedBranch) {
    return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Candidate worktree is not PatchBench-owned.", { detail: candidate.worktreePath }));
  }
  const frozen = await loadFrozenArtifact(store, run);
  if (!frozen.ok) return frozen;

  const wt = candidate.worktreePath;
  const policy = run.policy;
  const frozenPaths = frozen.value.files.map((f) => f.path);
  const dir = candidateDir(store, run.id, candidate.id);
  const logOf = (name: string) => ({ logFile: path.join(dir, "logs", `${name}.log`), logPath: `candidates/${candidate.id}/logs/${name}.log` });
  await store.appendEvent(run.id, { type: "candidate.verification_started", candidateId: candidate.id, data: { checks: ["regression", ...policy.verificationCommands.map((c) => c.name)] } });
  const record = (c: CheckResult) =>
    store.appendEvent(run.id, {
      type: "candidate.check_completed",
      candidateId: candidate.id,
      data: { check: c.name, passed: c.passed, skipped: c.skipped ?? false, exitCode: c.exitCode, durationMs: c.durationMs, failureCount: c.failures.length },
    });

  // 1. Frozen regression integrity.
  const integrity = await verifyFrozenRegression(wt, frozen.value.files);
  const regressionIntact = integrity.ok;
  const regressionCommand = { command: policy.regressionCommand.command, args: [...policy.regressionCommand.args, ...frozenPaths] };

  // 2. Regression: must run real tests with zero failures.
  let regression: CheckResult;
  if (regressionIntact) {
    regression = await runCheck({ name: "regression", ...regressionCommand }, { cwd: wt, ...logOf("regression"), policy, signal: input.signal });
    if (!regression.summary || regression.summary.tests === 0 || regression.summary.fail > 0) regression = { ...regression, passed: false };
  } else {
    regression = skipped("regression", regressionCommand);
  }
  await record(regression);

  // 3–6. The same commands the baseline ran.
  const checks: Array<{ command: VerificationCommand; result: CheckResult }> = [];
  for (const cmd of policy.verificationCommands) {
    const result = regressionIntact
      ? await runCheck(cmd, { cwd: wt, ...logOf(cmd.name), policy, signal: input.signal })
      : skipped(cmd.name, { command: cmd.command, args: [...cmd.args] });
    checks.push({ command: cmd, result });
    await record(result);
  }
  const byName = (name: string) => checks.find((c) => c.command.name === name)?.result;

  // Baseline subtraction. The frozen regression has its own gate, so its
  // tests (absent on baseline) are not double-counted as "new" failures.
  const isFrozen = (id: string) => frozenPaths.some((p) => id === p || id.startsWith(`${p} > `));
  const testFailures = (byName("test")?.failures ?? []).filter((f) => !isFrozen(f));
  const { newFailures, preservedFailures } = compareFailures(testFailures, run.baseline.failures);

  // 7. Change surface.
  const git = new GitAdapter({ allowedRoots: [wt] });
  const staged = await git.intentToAddAll(wt);
  const numstat = staged.ok ? await git.diffNumstat(wt, run.repository.commitSha) : staged;
  const diff = numstat.ok ? summarizeDiff(numstat.value, frozenPaths) : candidate.diff;
  if (!diff) return err(pbError("COMMAND_FAILED", "Could not compute the candidate diff.", { detail: numstat.ok ? "" : numstat.error.detail }));
  // Review copy of the implementation diff (frozen regression excluded) for the UI.
  const patch = staged.ok ? await git.diffPatch(wt, run.repository.commitSha, frozenPaths) : staged;
  if (patch.ok) await writeFileAtomic(path.join(dir, "diff.patch"), patch.value);

  const rejectionReasons = hardGateReasons({ regressionIntact, regression, newFailures, checks, policy });
  const verification: VerificationResult = {
    regressionIntact,
    regression,
    ...(byName("test") ? { tests: byName("test") } : {}),
    ...(byName("typecheck") ? { typecheck: byName("typecheck") } : {}),
    ...(byName("lint") ? { lint: byName("lint") } : {}),
    ...(byName("build") ? { build: byName("build") } : {}),
    newFailures,
    baselineFailures: run.baseline.failures,
    preservedFailures,
    diff,
    hardGatePassed: rejectionReasons.length === 0,
    rejectionReasons,
  };

  const eligible = verification.hardGatePassed;
  const moved = await transitionCandidate(
    store,
    run.id,
    candidate.id,
    eligible ? "ELIGIBLE" : "REJECTED",
    { verification, diff, ...(!regressionIntact && !integrity.ok ? { failure: integrity.error } : {}) },
    { clock },
  );
  if (!moved.ok) return moved;
  await store.appendEvent(run.id, {
    type: eligible ? "candidate.eligible" : "candidate.rejected",
    candidateId: candidate.id,
    data: { newFailures: newFailures.length, rejectionReasons: rejectionReasons.map((r) => r.replace(/ \(\d+\):.*$/, "")) },
  });
  await writeCandidateProjection(store, run.id, moved.value);
  return ok(moved.value);
}
