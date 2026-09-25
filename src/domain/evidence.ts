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

export const VerificationResultSchema = z.object({
  regression: CheckResultSchema,
  tests: CheckResultSchema.optional(),
  typecheck: CheckResultSchema.optional(),
  lint: CheckResultSchema.optional(),
  build: CheckResultSchema.optional(),
  newFailures: z.array(z.string()),
  baselineFailures: z.array(z.string()),
  diff: DiffSummarySchema,
  hardGatePassed: z.boolean(),
  rejectionReasons: z.array(z.string()),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
