import { z } from "zod";

export const VerificationCommandSchema = z.object({
  /** Stable key, e.g. "test" | "lint" | "typecheck" | "build". */
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  required: z.boolean(),
});
export type VerificationCommand = z.infer<typeof VerificationCommandSchema>;

/**
 * The trusted command PatchBench runs to prove the reproduction. Frozen test
 * paths are appended as arguments. Bob's proposed command is never executed.
 */
export const RegressionCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
});
export type RegressionCommand = z.infer<typeof RegressionCommandSchema>;

export const RunPolicySchema = z.object({
  candidateCount: z.number().int().min(1).max(3),
  verificationCommands: z.array(VerificationCommandSchema),
  regressionCommand: RegressionCommandSchema,
  commandTimeoutMs: z.number().int().positive(),
  maxOutputBytes: z.number().int().positive(),
  /** Only these environment variables are forwarded to repository commands. */
  envAllowList: z.array(z.string()),
  bob: z.object({
    maxCostPerTask: z.number().positive(),
    maxTurnsPerTask: z.number().int().positive(),
  }),
  excludePaths: z.array(z.string()),
  requireBuild: z.boolean(),
  requireTypecheck: z.boolean(),
});
export type RunPolicy = z.infer<typeof RunPolicySchema>;

export const DEFAULT_ENV_ALLOW_LIST = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TERM", "CI"] as const;

export function defaultRunPolicy(overrides: Partial<RunPolicy> = {}): RunPolicy {
  return RunPolicySchema.parse({
    candidateCount: 3,
    verificationCommands: [],
    // node:test with explicit TAP output: the reproduction classifier parses TAP.
    regressionCommand: { command: "node", args: ["--test", "--test-reporter=tap"] },
    commandTimeoutMs: 120_000,
    maxOutputBytes: 256 * 1024,
    envAllowList: [...DEFAULT_ENV_ALLOW_LIST],
    bob: { maxCostPerTask: 1, maxTurnsPerTask: 20 },
    excludePaths: [".git", "node_modules", ".next", "dist", "build", ".env", ".env.*"],
    requireBuild: true,
    requireTypecheck: true,
    ...overrides,
  });
}
