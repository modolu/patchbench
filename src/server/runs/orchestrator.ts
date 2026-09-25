import { pbError, type PatchBenchError } from "@/domain/errors";
import type { PatchBenchRun } from "@/domain/run";
import { access } from "node:fs/promises";
import path from "node:path";
import { ok, type Result } from "@/lib/result";
import { systemClock, type Clock } from "@/lib/time";
import type { BobAdapter } from "../bob/adapter";
import { StrategiesSchema } from "../bob/schemas";
import { implementCandidate, prepareCandidates } from "../candidates/candidate-service";
import { GitAdapter } from "../git/git-adapter";
import type { WorktreeManager } from "../git/worktrees";
import { loadFrozenArtifact } from "../reproduction/regression-artifact";
import { runReproductionGate } from "../reproduction/reproduction-service";
import { transitionRun } from "./lifecycle";
import { captureBaseline } from "../verification/baseline";
import { buildEvidenceMatrix } from "../verification/evidence-builder";
import { verifyCandidate, writeCandidateProjection } from "../verification/verifier";
import { captureRepositorySnapshot } from "./repository-snapshot";
import { writeFileAtomic, type FileRunStore } from "./store";

export interface PipelineDeps {
  store: FileRunStore;
  bob: BobAdapter;
  worktrees: WorktreeManager;
  clock?: Clock;
}

/**
 * Deterministic pipeline: clean baseline worktree + baseline checks →
 * reproduction workspace → reproduction gate → strategies → candidate
 * worktrees (frozen regression injected) → sequential implementation →
 * shared verification → evidence matrix (report.json) → COMPLETE.
 *
 * `dependencySource` defaults to `<repo>/node_modules` when present; each
 * worktree gets a private copy. Returns the run in whatever state it reached;
 * err only when the run could not be loaded or a transition was invalid.
 */
export async function runDeterministicPipeline(
  deps: PipelineDeps,
  input: { runId: string; dependencySource?: string; signal?: AbortSignal },
): Promise<Result<PatchBenchRun, PatchBenchError>> {
  const { store, bob, worktrees } = deps;
  const clock = deps.clock ?? systemClock;
  const { runId } = input;
  const to = (status: PatchBenchRun["status"], failure?: PatchBenchError) => transitionRun(store, runId, status, { failure, clock });

  const loaded = await store.loadRun(runId);
  if (!loaded.ok) return loaded;
  const run = loaded.value;
  const repoRoot = run.repository.root;

  // Baseline: the repository must still be at the recorded commit.
  let r = await to("BASELINING");
  if (!r.ok) return r;
  const snapshot = await captureRepositorySnapshot(new GitAdapter({ allowedRoots: [repoRoot] }), repoRoot);
  if (!snapshot.ok) return to("BLOCKED_BASELINE", snapshot.error);
  if (snapshot.value.commitSha !== run.repository.commitSha) {
    return to("BLOCKED_BASELINE", pbError("REPO_DIRTY", "Repository HEAD moved since the run was created.", { detail: `${run.repository.commitSha} → ${snapshot.value.commitSha}` }));
  }
  // A dirty primary worktree is allowed (every check runs on the commit) but must be visible.
  await store.appendEvent(runId, { type: "baseline.captured", data: { commitSha: snapshot.value.commitSha, isDirty: snapshot.value.isDirty } });
  const defaultDeps = path.join(repoRoot, "node_modules");
  const dependencySource = input.dependencySource ?? ((await access(defaultDeps).then(() => true, () => false)) ? defaultDeps : undefined);
  const baseline = await captureBaseline({ store, worktrees, clock }, { runId, dependencySource, signal: input.signal });
  if (!baseline.ok) return to(baseline.error.code === "COMMAND_CANCELLED" ? "CANCELLED" : "FAILED", baseline.error);

  // Reproduction in a PatchBench-owned detached worktree.
  r = await to("REPRODUCING");
  if (!r.ok) return r;
  const ws = await worktrees.createWorkspace({ repoRoot, runId, baseSha: run.repository.commitSha, kind: "reproduction" });
  if (!ws.ok) return to("FAILED", ws.error);
  r = await runReproductionGate({ store, bob, clock }, { runId, workspace: ws.value.path, primaryRoot: repoRoot, signal: input.signal });
  if (!r.ok || r.value.status !== "STRATEGIZING") return r;
  const frozen = await loadFrozenArtifact(store, r.value);
  if (!frozen.ok) return to("FAILED", frozen.error);

  // Strategies are generated once, before any implementation.
  const strategies = await bob.generateStrategies({
    runId,
    workspace: ws.value.path,
    issue: run.issue,
    reproduction: { testFiles: r.value.reproduction!.testFiles, command: "", expectedFailure: r.value.reproduction!.expectedFailure, notes: "" },
    maxStrategies: run.policy.candidateCount,
  });
  if (!strategies.ok) return to("FAILED", strategies.error);
  const validated = StrategiesSchema.safeParse(strategies.value);
  if (!validated.success || new Set(validated.data.map((s) => s.id)).size !== validated.data.length) {
    return to("FAILED", pbError("BOB_OUTPUT_INVALID", "Strategies failed validation.", { detail: validated.success ? "duplicate ids" : validated.error.message }));
  }
  await store.saveRun({ ...r.value, strategies: validated.data });
  await store.appendEvent(runId, { type: "strategies.generated", data: { ids: validated.data.map((s) => s.id) } });

  r = await to("PREPARING_CANDIDATES");
  if (!r.ok) return r;
  const prepared = await prepareCandidates({ store, bob, worktrees, clock }, { runId, frozen: frozen.value, dependencySource });
  if (!prepared.ok) return to("FAILED", prepared.error);
  if (prepared.value.every((c) => c.status === "FAILED")) {
    return to("FAILED", pbError("WORKTREE_CREATE_FAILED", "No candidate worktree could be prepared."));
  }

  r = await to("PATCHING");
  if (!r.ok) return r;
  // Sequential: deterministic event order; candidates never see each other.
  for (const candidate of prepared.value.filter((c) => c.status === "PENDING")) {
    if (input.signal?.aborted) return to("CANCELLED", pbError("COMMAND_CANCELLED", "Run was cancelled.", { recoverable: true }));
    const done = await implementCandidate({ store, bob, worktrees, clock }, { runId, candidateId: candidate.id, frozen: frozen.value });
    if (!done.ok) return to("FAILED", done.error);
  }

  r = await to("VERIFYING");
  if (!r.ok) return r;
  for (const candidate of r.value.candidates.filter((c) => c.status === "VERIFYING")) {
    if (input.signal?.aborted) return to("CANCELLED", pbError("COMMAND_CANCELLED", "Run was cancelled.", { recoverable: true }));
    const verified = await verifyCandidate({ store, clock }, { runId, candidateId: candidate.id, signal: input.signal });
    if (!verified.ok) return to("FAILED", verified.error);
  }

  // Evidence: projections + matrix are derived from run.json, the single source of truth.
  const settled = await store.loadRun(runId);
  if (!settled.ok) return settled;
  const rejected = settled.value.candidates.filter((c) => c.status === "REJECTED").length;
  const final = { ...settled.value, metrics: { ...settled.value.metrics, candidatesRejected: rejected } };
  await store.saveRun(final);
  for (const c of final.candidates) await writeCandidateProjection(store, runId, c);
  await writeFileAtomic(path.join(store.runDir(runId), "report.json"), `${JSON.stringify(buildEvidenceMatrix(final), null, 2)}\n`);
  await store.appendEvent(runId, {
    type: "run.completed",
    data: Object.fromEntries(["ELIGIBLE", "REJECTED", "FAILED", "TIMED_OUT"].map((s) => [s.toLowerCase(), final.candidates.filter((c) => c.status === s).map((c) => c.id)])),
  });
  r = await to("COMPLETE");
  return r.ok ? ok(r.value) : r;
}
