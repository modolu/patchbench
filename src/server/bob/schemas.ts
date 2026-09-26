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

/** Reserved workspace-relative path Bob writes its structured result to in a manual IDE hand-off. */
export const REPRODUCTION_RESULT_PATH = ".patchbench-handoff/reproduction-result.json";

/**
 * What a manual (Bob IDE) reproduction task writes to REPRODUCTION_RESULT_PATH.
 * Strict: unknown keys, missing fields, or oversized text are rejected, never coerced.
 */
export const ReproductionHandoffResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    schemaVersion: z.literal(1),
    status: z.literal("completed"),
    testFiles: z.array(RelativePath).min(1).max(5),
    expectedFailure: z.string().trim().min(1).max(200),
    /** Informational only; never executed. */
    proposedCommand: z.string().max(500).optional(),
    summary: z.string().max(2000),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    status: z.literal("blocked"),
    summary: z.string().min(1).max(2000),
  }),
]);
export type ReproductionHandoffResult = z.infer<typeof ReproductionHandoffResultSchema>;

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
