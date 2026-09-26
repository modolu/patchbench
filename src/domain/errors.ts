import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "REPO_NOT_GIT",
  "REPO_DIRTY",
  "SCRIPT_NOT_FOUND",
  "BASELINE_COMMAND_FAILED",
  "BOB_NOT_INSTALLED",
  "BOB_AUTH_REQUIRED",
  "BOB_COST_LIMIT_REACHED",
  "BOB_OUTPUT_INVALID",
  "BOB_OPERATION_UNSUPPORTED",
  "REPRO_NOT_CONFIRMED",
  "REPRO_INVALID",
  "BASELINE_MUTATED",
  "WORKTREE_CREATE_FAILED",
  "COMMAND_TIMEOUT",
  "COMMAND_FAILED",
  "COMMAND_CANCELLED",
  "REGRESSION_TEST_MUTATED",
  "PATH_OUTSIDE_ALLOWED_ROOT",
  "INVALID_TRANSITION",
  "RUN_NOT_FOUND",
  "RUN_CORRUPT",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const PatchBenchErrorSchema = z.object({
  code: ErrorCodeSchema,
  /** Safe, user-facing message. Never contains secrets or raw stack traces. */
  message: z.string(),
  /** Internal detail for logs/debugging. */
  detail: z.string().optional(),
  recoverable: z.boolean(),
  nextAction: z.string().optional(),
});
export type PatchBenchError = z.infer<typeof PatchBenchErrorSchema>;

export function pbError(
  code: ErrorCode,
  message: string,
  opts: { detail?: string; recoverable?: boolean; nextAction?: string } = {},
): PatchBenchError {
  return { code, message, recoverable: opts.recoverable ?? false, detail: opts.detail, nextAction: opts.nextAction };
}
