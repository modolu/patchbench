import { z } from "zod";
import { CandidateStrategySchema } from "@/domain/candidate";

const RelativePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.split(/[\\/]/).includes(".."), "must be a relative path inside the workspace");

/** Structured payload Bob returns after writing the regression test (architecture §12). */
export const ReproductionProposalSchema = z.object({
  testFiles: z.array(RelativePath).min(1),
  /** Informational only: PatchBench owns the command policy and never executes this verbatim. */
  command: z.string(),
  expectedFailure: z.string().min(1),
  notes: z.string(),
});
export type ReproductionProposal = z.infer<typeof ReproductionProposalSchema>;

/** 2–3 materially different approaches; no implementation. */
export const StrategiesSchema = z.array(CandidateStrategySchema).min(2).max(3);

export const ImplementationResultSchema = z.object({
  changedFiles: z.array(RelativePath),
  summary: z.string(),
  bobTaskId: z.string().optional(),
  /** Bobcoin cost when the Bob output exposes it. */
  cost: z.number().nonnegative().optional(),
});
export type ImplementationResult = z.infer<typeof ImplementationResultSchema>;
