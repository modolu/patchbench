import { z } from "zod";

export const CheckResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().nonnegative(),
  timedOut: z.boolean(),
  /** Normalized failing test identifiers, when the runner can extract them. */
  failures: z.array(z.string()),
  logPath: z.string().optional(),
  /** The exact executable + args PatchBench ran (never a shell string). */
  command: z.object({ command: z.string(), args: z.array(z.string()) }).optional(),
  /** Parsed test counts, when the output is TAP. */
  summary: z.object({ tests: z.number().int().nonnegative(), pass: z.number().int().nonnegative(), fail: z.number().int().nonnegative() }).optional(),
  /** Not executed because an earlier hard gate already failed. */
  skipped: z.boolean().optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const DiffSummarySchema = z.object({
  filesChanged: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  files: z.array(
    z.object({
      path: z.string(),
      insertions: z.number().int().nonnegative().nullable(),
      deletions: z.number().int().nonnegative().nullable(),
    }),
  ),
  dependencyManifestChanged: z.boolean(),
  configFilesTouched: z.array(z.string()),
});
export type DiffSummary = z.infer<typeof DiffSummarySchema>;

/**
 * Optional checks (tests/typecheck/lint/build) are absent when the repository
 * has no such script: "not configured", never a fabricated pass.
 */
export const VerificationResultSchema = z.object({
  /** Frozen regression files still match their frozen SHA-256. */
  regressionIntact: z.boolean(),
  regression: CheckResultSchema,
  tests: CheckResultSchema.optional(),
  typecheck: CheckResultSchema.optional(),
  lint: CheckResultSchema.optional(),
  build: CheckResultSchema.optional(),
  /** Candidate test failures absent on baseline. */
  newFailures: z.array(z.string()),
  /** All test failures recorded on the untouched baseline. */
  baselineFailures: z.array(z.string()),
  /** Candidate test failures that already failed on baseline (not held against it). */
  preservedFailures: z.array(z.string()),
  diff: DiffSummarySchema,
  hardGatePassed: z.boolean(),
  rejectionReasons: z.array(z.string()),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const EvidenceStatusSchema = z.enum(["pass", "fail", "not_configured", "not_run", "info"]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

export const EvidenceValueSchema = z.object({
  status: EvidenceStatusSchema,
  display: z.string(),
  detail: z.array(z.string()).optional(),
});
export type EvidenceValue = z.infer<typeof EvidenceValueSchema>;

/** One comparable fact across candidates (architecture §16). No scores. */
export const EvidenceMatrixRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(["hard-gate", "informational"]),
  candidateValues: z.record(z.string(), EvidenceValueSchema),
});
export type EvidenceMatrixRow = z.infer<typeof EvidenceMatrixRowSchema>;

export const EvidenceMatrixSchema = z.object({
  runId: z.string(),
  baselineSha: z.string(),
  baselineFailures: z.array(z.string()),
  candidates: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      rejectionReasons: z.array(z.string()),
    }),
  ),
  rows: z.array(EvidenceMatrixRowSchema),
});
export type EvidenceMatrix = z.infer<typeof EvidenceMatrixSchema>;
