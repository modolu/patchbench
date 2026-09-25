import type { CandidateStrategy } from "@/domain/candidate";
import type { PatchBenchError } from "@/domain/errors";
import type { IssueSpec, RepositorySnapshot } from "@/domain/run";
import type { Result } from "@/lib/result";
import type { ImplementationResult, ReproductionProposal } from "./schemas";

export interface ReproductionInput {
  runId: string;
  /** Directory Bob may write the regression test into (never the user's primary worktree). */
  workspace: string;
  repository: RepositorySnapshot;
  issue: IssueSpec;
}

export interface StrategyInput {
  runId: string;
  workspace: string;
  issue: IssueSpec;
  reproduction: ReproductionProposal;
  maxStrategies: number;
}

export interface ImplementationInput {
  runId: string;
  candidateId: string;
  /** The candidate's isolated worktree. */
  workspace: string;
  issue: IssueSpec;
  reproduction: ReproductionProposal;
  /** Exactly one strategy; candidates never see each other's strategies or diffs. */
  strategy: CandidateStrategy;
  /** Frozen regression-test paths that must not be modified. */
  frozenTestPaths: readonly string[];
}

/**
 * Boundary for every Bob interaction (ADR-006). Implementations:
 * FakeBobAdapter (tests/dev, zero Bobcoins), later a bounded Bob Shell adapter
 * and a manual IDE hand-off adapter.
 */
export interface BobAdapter {
  readonly kind: "fake" | "shell" | "manual";
  generateReproduction(input: ReproductionInput): Promise<Result<ReproductionProposal, PatchBenchError>>;
  generateStrategies(input: StrategyInput): Promise<Result<CandidateStrategy[], PatchBenchError>>;
  implementStrategy(input: ImplementationInput): Promise<Result<ImplementationResult, PatchBenchError>>;
}
