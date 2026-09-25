import { z } from "zod";
import { DiffSummarySchema, VerificationResultSchema } from "./evidence";
import { PatchBenchErrorSchema } from "./errors";

export const CANDIDATE_STATUSES = [
  "PENDING",
  "IMPLEMENTING",
  "IMPLEMENTED",
  "VERIFYING",
  "ELIGIBLE",
  "REJECTED",
  "FAILED",
  "TIMED_OUT",
] as const;
export const CandidateStatusSchema = z.enum(CANDIDATE_STATUSES);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

export const CandidateStrategySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  rationale: z.string().min(1),
  likelyFiles: z.array(z.string()),
  tradeoffs: z.array(z.string()),
  implementationBrief: z.string().min(1),
});
export type CandidateStrategy = z.infer<typeof CandidateStrategySchema>;

export const CandidateResultSchema = z.object({
  id: z.string(),
  strategyId: z.string(),
  worktreePath: z.string(),
  branchName: z.string(),
  status: CandidateStatusSchema,
  implementation: z
    .object({
      startedAt: z.string(),
      finishedAt: z.string(),
      bobTaskId: z.string().optional(),
    })
    .optional(),
  diff: DiffSummarySchema.optional(),
  verification: VerificationResultSchema.optional(),
  failure: PatchBenchErrorSchema.optional(),
});
export type CandidateResult = z.infer<typeof CandidateResultSchema>;
