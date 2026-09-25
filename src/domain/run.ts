import { z } from "zod";
import { CandidateResultSchema, CandidateStrategySchema } from "./candidate";
import { CheckResultSchema } from "./evidence";
import { PatchBenchErrorSchema } from "./errors";
import { RunPolicySchema } from "./policy";

export const RUN_STATUSES = [
  "CREATED",
  "BASELINING",
  "REPRODUCING",
  "STRATEGIZING",
  "PREPARING_CANDIDATES",
  "PATCHING",
  "VERIFYING",
  "COMPLETE",
  "BLOCKED_BASELINE",
  "UNVERIFIED",
  "FAILED",
  "CANCELLED",
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const PackageManagerSchema = z.enum(["pnpm", "npm", "yarn", "unknown"]);
export type PackageManager = z.infer<typeof PackageManagerSchema>;

export const RepositorySnapshotSchema = z.object({
  root: z.string(),
  branch: z.string().nullable(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  isDirty: z.boolean(),
  packageManager: PackageManagerSchema,
  detectedScripts: z.object({
    test: z.string().optional(),
    lint: z.string().optional(),
    typecheck: z.string().optional(),
    build: z.string().optional(),
  }),
});
export type RepositorySnapshot = z.infer<typeof RepositorySnapshotSchema>;

export const IssueSpecSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  expectedBehavior: z.string().trim().min(1),
  actualBehavior: z.string().optional(),
  reproductionHints: z.string().optional(),
  evidence: z.string().optional(),
});
export type IssueSpec = z.infer<typeof IssueSpecSchema>;

export const BaselineResultSchema = z.object({
  commitSha: z.string(),
  checks: z.array(CheckResultSchema),
  failures: z.array(z.string()),
  durationMs: z.number().nonnegative(),
});
export type BaselineResult = z.infer<typeof BaselineResultSchema>;

export const ReproductionOutcomeSchema = z.enum(["REPRODUCED", "NOT_REPRODUCED", "INVALID_REPRODUCTION", "MANUAL_REVIEW"]);
export type ReproductionOutcome = z.infer<typeof ReproductionOutcomeSchema>;

export const ReproductionResultSchema = z.object({
  outcome: ReproductionOutcomeSchema,
  testFiles: z.array(z.string()),
  expectedFailure: z.string(),
  baselineCheck: CheckResultSchema.optional(),
  /** SHA-256 of the frozen regression patch; set once REPRODUCED. */
  frozenPatchSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type ReproductionResult = z.infer<typeof ReproductionResultSchema>;

export const RunMetricsSchema = z.object({
  stageDurationsMs: z.record(z.string(), z.number().nonnegative()),
  commandsExecuted: z.number().int().nonnegative(),
  candidatesRejected: z.number().int().nonnegative(),
});
export type RunMetrics = z.infer<typeof RunMetricsSchema>;

export const PatchBenchRunSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  repository: RepositorySnapshotSchema,
  issue: IssueSpecSchema,
  policy: RunPolicySchema,
  status: RunStatusSchema,
  baseline: BaselineResultSchema.optional(),
  reproduction: ReproductionResultSchema.optional(),
  strategies: z.array(CandidateStrategySchema),
  candidates: z.array(CandidateResultSchema),
  metrics: RunMetricsSchema,
  failure: PatchBenchErrorSchema.optional(),
});
export type PatchBenchRun = z.infer<typeof PatchBenchRunSchema>;

export function emptyMetrics(): RunMetrics {
  return { stageDurationsMs: {}, commandsExecuted: 0, candidatesRejected: 0 };
}
