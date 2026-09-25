import type { CandidateResult } from "@/domain/candidate";
import { pbError, type PatchBenchError } from "@/domain/errors";
import { err, ok, type Result } from "@/lib/result";
import { isoNow, systemClock, type Clock } from "@/lib/time";
import type { BobAdapter } from "../bob/adapter";
import { GitAdapter } from "../git/git-adapter";
import type { WorktreeManager } from "../git/worktrees";
import { applyFrozenRegression, verifyFrozenRegression, type FrozenRegression } from "../reproduction/regression-artifact";
import { transitionCandidate } from "../runs/lifecycle";
import type { FileRunStore } from "../runs/store";
import { summarizeDiff } from "../verification/diff-analysis";
import { provisionNodeModules } from "./dependencies";

export interface CandidateDeps {
  store: FileRunStore;
  bob: BobAdapter;
  worktrees: WorktreeManager;
  clock?: Clock;
}

/**
 * Creates one worktree per strategy from the baseline SHA and injects the
 * frozen regression into each. Requires PREPARING_CANDIDATES. A candidate
 * whose worktree cannot be prepared is FAILED; the others continue.
 */
export async function prepareCandidates(
  deps: CandidateDeps,
  input: { runId: string; frozen: FrozenRegression; dependencySource?: string },
): Promise<Result<CandidateResult[], PatchBenchError>> {
  const { store, worktrees } = deps;
  const loaded = await store.loadRun(input.runId);
  if (!loaded.ok) return loaded;
  const run = loaded.value;
  if (run.status !== "PREPARING_CANDIDATES") return err(pbError("INVALID_TRANSITION", `Preparing candidates requires PREPARING_CANDIDATES, run is ${run.status}.`));
  if (run.candidates.length > 0) return err(pbError("RUN_CORRUPT", "Candidates were already prepared for this run."));

  const strategies = run.strategies.slice(0, run.policy.candidateCount);
  const created: CandidateResult[] = [];
  const failures = new Map<string, PatchBenchError>();
  for (const strategy of strategies) {
    const wt = await worktrees.create({ repoRoot: run.repository.root, runId: run.id, candidateId: strategy.id, baseSha: run.repository.commitSha });
    if (!wt.ok) {
      failures.set(strategy.id, wt.error);
      created.push({ id: strategy.id, strategyId: strategy.id, worktreePath: "", branchName: "", status: "PENDING" });
      continue;
    }
    created.push({ id: strategy.id, strategyId: strategy.id, worktreePath: wt.value.path, branchName: wt.value.branchName, status: "PENDING" });
    await store.appendEvent(run.id, { type: "candidate.created", candidateId: strategy.id, data: { branch: wt.value.branchName, baseSha: wt.value.baseSha } });

    if (input.dependencySource) {
      const deps = await provisionNodeModules(wt.value.path, input.dependencySource);
      if (!deps.ok) {
        failures.set(strategy.id, deps.error);
        continue;
      }
    }
    const injected = await applyFrozenRegression(new GitAdapter({ allowedRoots: [wt.value.path] }), wt.value.path, input.frozen);
    if (!injected.ok) {
      failures.set(strategy.id, injected.error);
      continue;
    }
    await store.appendEvent(run.id, { type: "candidate.regression_injected", candidateId: strategy.id, data: { sha256: input.frozen.patchSha256 } });
  }

  const current = await store.loadRun(run.id);
  if (!current.ok) return current;
  await store.saveRun({ ...current.value, candidates: created });
  for (const [id, failure] of failures) {
    const r = await transitionCandidate(store, run.id, id, "FAILED", { failure }, { clock: deps.clock });
    if (!r.ok) return r;
  }
  const final = await store.loadRun(run.id);
  return final.ok ? ok(final.value.candidates) : final;
}

/**
 * Implements one strategy in its own worktree, then checks the frozen
 * regression is byte-identical. A mutated benchmark rejects the candidate,
 * never the whole run. Leaves an intact candidate in VERIFYING for the
 * shared verifier.
 */
export async function implementCandidate(
  deps: CandidateDeps,
  input: { runId: string; candidateId: string; frozen: FrozenRegression },
): Promise<Result<CandidateResult, PatchBenchError>> {
  const { store, bob } = deps;
  const clock = deps.clock ?? systemClock;
  const loaded = await store.loadRun(input.runId);
  if (!loaded.ok) return loaded;
  const run = loaded.value;
  if (run.status !== "PATCHING") return err(pbError("INVALID_TRANSITION", `Implementing candidates requires PATCHING, run is ${run.status}.`));
  const candidate = run.candidates.find((c) => c.id === input.candidateId);
  const strategy = run.strategies.find((s) => s.id === candidate?.strategyId);
  if (!candidate || !strategy || !run.reproduction) return err(pbError("RUN_CORRUPT", `Candidate ${input.candidateId} is not ready.`));

  const move = (to: CandidateResult["status"], patch: Partial<CandidateResult> = {}) =>
    transitionCandidate(store, run.id, candidate.id, to, patch, { clock });
  const reject = async (failure: PatchBenchError) => {
    await store.appendEvent(run.id, { type: "candidate.regression_mutated", candidateId: candidate.id, data: { detail: failure.detail } });
    return move("REJECTED", { failure });
  };

  const startedAt = isoNow(clock);
  const implementing = await move("IMPLEMENTING");
  if (!implementing.ok) return implementing;

  const frozenPaths = input.frozen.files.map((f) => f.path);
  const result = await bob.implementStrategy({
    runId: run.id,
    candidateId: candidate.id,
    workspace: candidate.worktreePath,
    issue: run.issue,
    reproduction: {
      testFiles: run.reproduction.testFiles,
      command: "",
      expectedFailure: run.reproduction.expectedFailure,
      notes: "",
    },
    strategy,
    frozenTestPaths: frozenPaths,
  });
  const implementation = { startedAt, finishedAt: isoNow(clock), ...(result.ok && result.value.bobTaskId ? { bobTaskId: result.value.bobTaskId } : {}) };

  if (!result.ok && result.error.code !== "REGRESSION_TEST_MUTATED") {
    return move(result.error.code === "COMMAND_TIMEOUT" ? "TIMED_OUT" : "FAILED", { implementation, failure: result.error });
  }

  const git = new GitAdapter({ allowedRoots: [candidate.worktreePath] });
  const staged = await git.intentToAddAll(candidate.worktreePath);
  const numstat = staged.ok ? await git.diffNumstat(candidate.worktreePath, run.repository.commitSha) : staged;
  const diff = numstat.ok ? summarizeDiff(numstat.value, frozenPaths) : undefined;
  await store.appendEvent(run.id, {
    type: "candidate.implemented",
    candidateId: candidate.id,
    data: { filesChanged: diff?.filesChanged ?? null, frozenExcluded: frozenPaths },
  });
  const implemented = await move("IMPLEMENTED", { implementation, ...(diff ? { diff } : {}) });
  if (!implemented.ok) return implemented;
  const verifying = await move("VERIFYING");
  if (!verifying.ok) return verifying;

  // The adapter itself reported an attempt on the frozen test: a benchmark violation.
  if (!result.ok) return reject(result.error);
  const intact = await verifyFrozenRegression(candidate.worktreePath, input.frozen.files);
  if (!intact.ok) return reject(intact.error);
  await store.appendEvent(run.id, { type: "candidate.regression_verified", candidateId: candidate.id, data: { sha256: input.frozen.patchSha256 } });
  return verifying;
}
