import type { ErrorCode } from "@/domain/errors";
import { locationFile, type TapReport, type TapTestPoint } from "../runner/test-output";

export interface ProcessOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
}

export type ReproductionClassification =
  | { outcome: "REPRODUCED"; failingTests: string[] }
  | { outcome: "NOT_REPRODUCED" | "INVALID_REPRODUCTION"; code: Extract<ErrorCode, "REPRO_NOT_CONFIRMED" | "REPRO_INVALID">; reason: string; failingTests: string[] };

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

const invalid = (reason: string, failingTests: string[] = []): ReproductionClassification => ({
  outcome: "INVALID_REPRODUCTION",
  code: "REPRO_INVALID",
  reason,
  failingTests,
});

/**
 * Decides whether a baseline run of the regression test proves the bug.
 * Rules are ordered; only an assertion failure inside the regression files
 * that mentions the expected behaviour counts as REPRODUCED. A generic
 * non-zero exit never does.
 */
export function classifyReproduction(input: {
  process: ProcessOutcome;
  report: TapReport;
  testFiles: readonly string[];
  expectedFailure: string;
}): ReproductionClassification {
  const { process: proc, report, testFiles, expectedFailure } = input;

  // 1. Timeout / cancellation / signal termination.
  if (proc.timedOut) return invalid("Regression command timed out.");
  if (proc.cancelled) return invalid("Regression command was cancelled.");
  if (proc.signal) return invalid(`Regression command was terminated by ${proc.signal}.`);
  if (!report.complete) return invalid("Regression output is not complete TAP (missing summary).");

  // node:test reports a whole file as one test point named after the file
  // when it fails to load or contains no tests.
  const isFileLevel = (p: TapTestPoint) => p.depth === 0 && testFiles.includes(p.name);
  const failingNames = report.failures.map((f) => f.name);

  // 2. Zero tests.
  const realTests = report.points.filter((p) => !isFileLevel(p));
  if (realTests.length === 0) {
    const loadFailure = report.failures.some(isFileLevel);
    return invalid(loadFailure ? "Regression test file failed to load; no tests ran." : "Regression test file contains no tests.", failingNames);
  }

  // 3. Clean pass: the bug is not reproduced on baseline.
  if (proc.exitCode === 0 && report.fail === 0 && report.failures.length === 0) {
    return { outcome: "NOT_REPRODUCED", code: "REPRO_NOT_CONFIRMED", reason: "Regression test passes on the untouched baseline.", failingTests: [] };
  }
  if (proc.exitCode === 0 || report.failures.length === 0) {
    return invalid(`Inconsistent result: exit code ${proc.exitCode} with ${report.failures.length} failing test(s).`, failingNames);
  }
  if (report.cancelled > 0) return invalid(`${report.cancelled} test(s) were cancelled.`, failingNames);

  // 4. Load/runtime/non-assertion failures, or failures outside the regression files.
  for (const f of report.failures) {
    if (isFileLevel(f)) return invalid(`Regression test file ${f.name} failed to load.`, failingNames);
    if (f.code !== "ERR_ASSERTION") {
      return invalid(`Test "${f.name}" failed with ${f.errorName ?? f.code ?? "an unknown error"}, not an assertion.`, failingNames);
    }
    if (f.location && !testFiles.some((t) => locationFile(f.location!).endsWith(`/${t}`))) {
      return invalid(`Failing test "${f.name}" is not defined in the regression test files.`, failingNames);
    }
  }

  // 5. The failure must be the expected behavioural one.
  const expected = normalize(expectedFailure);
  if (!expected || !report.failures.some((f) => normalize(f.errorText ?? "").includes(expected))) {
    return invalid(`No failing assertion mentions the expected failure "${expectedFailure}".`, failingNames);
  }

  // 6. Reproduced.
  return { outcome: "REPRODUCED", failingTests: failingNames };
}
