import type { CheckResult } from "@/domain/evidence";
import type { RunPolicy, VerificationCommand } from "@/domain/policy";

/** Set difference/intersection on stable failure identities. */
export function compareFailures(candidate: readonly string[], baseline: readonly string[]): { newFailures: string[]; preservedFailures: string[] } {
  const base = new Set(baseline);
  return {
    newFailures: candidate.filter((f) => !base.has(f)).sort(),
    preservedFailures: candidate.filter((f) => base.has(f)).sort(),
  };
}

export const isRequired = (cmd: VerificationCommand, policy: RunPolicy): boolean =>
  cmd.required || (cmd.name === "typecheck" && policy.requireTypecheck) || (cmd.name === "build" && policy.requireBuild);

const GATE_LABELS: Record<string, string> = { typecheck: "Typecheck failed", build: "Build failed" };

/**
 * Pure hard-gate policy (architecture §16, brief §10). Test-suite pass/fail
 * is judged only by failures new relative to baseline; lint and other
 * non-required checks are evidence, never a rejection. No scores.
 */
export function hardGateReasons(input: {
  regressionIntact: boolean;
  regression: CheckResult;
  newFailures: readonly string[];
  checks: ReadonlyArray<{ command: VerificationCommand; result: CheckResult }>;
  policy: RunPolicy;
}): string[] {
  const reasons: string[] = [];
  if (!input.regressionIntact) reasons.push("Frozen regression test was modified or removed");
  else if (!input.regression.passed) reasons.push("Regression test still fails");
  if (input.newFailures.length > 0) reasons.push(`Introduced new test failures (${input.newFailures.length}): ${input.newFailures.join("; ")}`);
  for (const { command, result } of input.checks) {
    if (command.name === "test" || result.skipped || result.passed || !isRequired(command, input.policy)) continue;
    reasons.push(GATE_LABELS[command.name] ?? `Required check "${command.name}" failed`);
  }
  return reasons;
}
