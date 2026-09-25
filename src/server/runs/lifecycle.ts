import type { CandidateResult, CandidateStatus } from "@/domain/candidate";
import { pbError, type PatchBenchError } from "@/domain/errors";
import type { PatchBenchRun, RunStatus } from "@/domain/run";
import { err, ok, type Result } from "@/lib/result";
import { isoNow, systemClock, type Clock } from "@/lib/time";
import { applyRunTransition, canTransitionCandidate } from "./state-machine";
import type { FileRunStore } from "./store";

/**
 * Validates, records, and persists one run status transition.
 * The event is appended before run.json is rewritten so the log never lags state.
 */
export async function transitionRun(
  store: FileRunStore,
  runId: string,
  to: RunStatus,
  opts: { failure?: PatchBenchError; clock?: Clock } = {},
): Promise<Result<PatchBenchRun, PatchBenchError>> {
  const loaded = await store.loadRun(runId);
  if (!loaded.ok) return loaded;
  const from = loaded.value.status;
  const next = applyRunTransition(loaded.value, to, { at: isoNow(opts.clock ?? systemClock), failure: opts.failure });
  if (!next.ok) return err(next.error);
  await store.appendEvent(runId, {
    type: "run.status_changed",
    data: { from, to, ...(opts.failure ? { failureCode: opts.failure.code } : {}) },
  });
  await store.saveRun(next.value);
  return ok(next.value);
}

/**
 * Validates, records, and persists one candidate status transition, merging
 * `patch` into the candidate record. Event first, then run.json.
 */
export async function transitionCandidate(
  store: FileRunStore,
  runId: string,
  candidateId: string,
  to: CandidateStatus,
  patch: Partial<Omit<CandidateResult, "id" | "status">> = {},
  opts: { clock?: Clock } = {},
): Promise<Result<CandidateResult, PatchBenchError>> {
  const loaded = await store.loadRun(runId);
  if (!loaded.ok) return loaded;
  const run = loaded.value;
  const index = run.candidates.findIndex((c) => c.id === candidateId);
  if (index < 0) return err(pbError("RUN_CORRUPT", `Candidate ${candidateId} not found.`, { detail: `run=${runId}` }));
  const from = run.candidates[index]!.status;
  if (!canTransitionCandidate(from, to)) {
    return err(pbError("INVALID_TRANSITION", `Candidate cannot move from ${from} to ${to}.`, { detail: `run=${runId} candidate=${candidateId}` }));
  }
  const next: CandidateResult = { ...run.candidates[index]!, ...patch, status: to };
  await store.appendEvent(runId, {
    type: "candidate.status_changed",
    candidateId,
    data: { from, to, ...(patch.failure ? { failureCode: patch.failure.code } : {}) },
  });
  const candidates = [...run.candidates];
  candidates[index] = next;
  await store.saveRun({ ...run, candidates, updatedAt: isoNow(opts.clock ?? systemClock) });
  return ok(next);
}
