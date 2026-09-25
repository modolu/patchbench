import { z } from "zod";
import { CandidateStrategySchema } from "@/domain/candidate";

/**
 * Canonical POSIX-relative path: exactly one spelling per file, so string
 * comparison against frozen paths cannot be bypassed (`./x`, `a//x`, `a\\x`).
 */
export function isCanonicalRelativePath(p: string): boolean {
  return (
    p.length > 0 &&
    !p.includes("\\") &&
    !p.includes("\0") &&
    !p.startsWith("/") &&
    !/^[A-Za-z]:/.test(p) &&
    p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..")
  );
}

export const RelativePath = z.string().min(1).refine(isCanonicalRelativePath, "must be a canonical relative path inside the workspace");

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
