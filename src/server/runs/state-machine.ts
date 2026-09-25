import type { CandidateStatus } from "@/domain/candidate";
import { pbError, type PatchBenchError } from "@/domain/errors";
import type { PatchBenchRun, RunStatus } from "@/domain/run";
import { err, ok, type Result } from "@/lib/result";

/**
 * Explicit run transition table (docs/PATCHBENCH_ARCHITECTURE.md §7).
 *
 * Beyond the diagram, every non-terminal state may move to FAILED or
 * CANCELLED: an infrastructure fault or user cancel can occur at any stage and
 * must be representable without inventing ad hoc states.
 */
const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  CREATED: ["BASELINING", "FAILED", "CANCELLED"],
  BASELINING: ["REPRODUCING", "BLOCKED_BASELINE", "FAILED", "CANCELLED"],
  REPRODUCING: ["STRATEGIZING", "UNVERIFIED", "FAILED", "CANCELLED"],
  STRATEGIZING: ["PREPARING_CANDIDATES", "FAILED", "CANCELLED"],
  PREPARING_CANDIDATES: ["PATCHING", "FAILED", "CANCELLED"],
  PATCHING: ["VERIFYING", "FAILED", "CANCELLED"],
  VERIFYING: ["COMPLETE", "FAILED", "CANCELLED"],
  COMPLETE: [],
  BLOCKED_BASELINE: [],
  UNVERIFIED: [],
  FAILED: [],
  CANCELLED: [],
};

/** Terminal states that represent an exceptional (non-COMPLETE) outcome. */
export const EXCEPTIONAL_TERMINAL_STATES: readonly RunStatus[] = ["BLOCKED_BASELINE", "UNVERIFIED", "FAILED", "CANCELLED"];

const CANDIDATE_TRANSITIONS: Record<CandidateStatus, readonly CandidateStatus[]> = {
  PENDING: ["IMPLEMENTING", "FAILED"],
  IMPLEMENTING: ["IMPLEMENTED", "FAILED", "TIMED_OUT"],
  IMPLEMENTED: ["VERIFYING", "FAILED"],
  VERIFYING: ["ELIGIBLE", "REJECTED", "FAILED", "TIMED_OUT"],
  ELIGIBLE: [],
  REJECTED: [],
  // Retry restarts a failed candidate from a clean worktree.
  FAILED: ["PENDING"],
  TIMED_OUT: ["PENDING"],
};

export const canTransitionRun = (from: RunStatus, to: RunStatus): boolean => RUN_TRANSITIONS[from].includes(to);

export const isTerminalRunStatus = (status: RunStatus): boolean => RUN_TRANSITIONS[status].length === 0;

export const canTransitionCandidate = (from: CandidateStatus, to: CandidateStatus): boolean =>
  CANDIDATE_TRANSITIONS[from].includes(to);

export const isTerminalCandidateStatus = (status: CandidateStatus): boolean =>
  CANDIDATE_TRANSITIONS[status].length === 0;

export interface TransitionOptions {
  at: string;
  /** Recorded on the run when moving into an exceptional terminal state. */
  failure?: PatchBenchError;
}

/** Pure transition: returns a new run or an INVALID_TRANSITION error. */
export function applyRunTransition(
  run: PatchBenchRun,
  to: RunStatus,
  opts: TransitionOptions,
): Result<PatchBenchRun, PatchBenchError> {
  if (!canTransitionRun(run.status, to)) {
    return err(
      pbError("INVALID_TRANSITION", `Run cannot move from ${run.status} to ${to}.`, {
        detail: `run=${run.id}`,
      }),
    );
  }
  return ok({
    ...run,
    status: to,
    updatedAt: opts.at,
    ...(opts.failure ? { failure: opts.failure } : {}),
  });
}
