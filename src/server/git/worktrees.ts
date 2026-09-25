import path from "node:path";
import type { PatchBenchError } from "@/domain/errors";
import { assertSafeId } from "@/lib/ids";
import type { Result } from "@/lib/result";

/**
 * Candidate worktree lifecycle (architecture §10). Interface + naming rules
 * only in Milestone 1; the Git-backed implementation lands with Milestone 3.
 */
export interface CandidateWorktree {
  runId: string;
  candidateId: string;
  path: string;
  branchName: string;
  baseSha: string;
}

export interface WorktreeManager {
  /** `git worktree add -b patchbench/<run>/<cand> <path> <baseSha>`. */
  create(input: { repoRoot: string; runId: string; candidateId: string; baseSha: string }): Promise<
    Result<CandidateWorktree, PatchBenchError>
  >;
  /** Removes the worktree and its PatchBench branch only. */
  remove(worktree: CandidateWorktree, repoRoot: string): Promise<Result<void, PatchBenchError>>;
  list(repoRoot: string, runId: string): Promise<Result<CandidateWorktree[], PatchBenchError>>;
}

const BRANCH_PREFIX = "patchbench/";

export function candidateBranchName(runId: string, candidateId: string): string {
  return `${BRANCH_PREFIX}${assertSafeId(runId, "run id")}/${assertSafeId(candidateId, "candidate id")}`;
}

export function candidateWorktreePath(runtimeRoot: string, runId: string, candidateId: string): string {
  return path.join(path.resolve(runtimeRoot), "worktrees", assertSafeId(runId, "run id"), assertSafeId(candidateId, "candidate id"));
}

/** Guard for any branch deletion: only branches PatchBench itself created. */
export function isPatchBenchBranch(name: string): boolean {
  const parts = name.split("/");
  return parts.length === 3 && parts[0] === "patchbench" && name === candidateBranchNameSafe(parts[1], parts[2]);
}

function candidateBranchNameSafe(runId = "", candidateId = ""): string | null {
  try {
    return candidateBranchName(runId, candidateId);
  } catch {
    return null;
  }
}
