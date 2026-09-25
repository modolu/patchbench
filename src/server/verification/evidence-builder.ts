import type { CandidateResult } from "@/domain/candidate";
import type { CheckResult, EvidenceMatrix, EvidenceMatrixRow, EvidenceValue } from "@/domain/evidence";
import type { PatchBenchRun } from "@/domain/run";
import { isRequired } from "./gates";

type Cell = (c: CandidateResult) => EvidenceValue;

const notRun: EvidenceValue = { status: "not_run", display: "NOT RUN" };
const notConfigured: EvidenceValue = { status: "not_configured", display: "NOT CONFIGURED" };
const info = (display: string, detail?: string[]): EvidenceValue => ({ status: "info", display, ...(detail?.length ? { detail } : {}) });

function checkCell(check: CheckResult | undefined, verified: boolean): EvidenceValue {
  if (!verified) return notRun;
  if (!check) return notConfigured;
  if (check.skipped) return notRun;
  return check.passed ? { status: "pass", display: "PASS" } : { status: "fail", display: check.timedOut ? "TIMEOUT" : "FAIL" };
}

/**
 * Pure projection of persisted run state into a candidate comparison
 * (architecture §16). Hard-gate rows mirror the verifier's rejection rules;
 * everything else is informational. It never ranks or picks a winner.
 */
export function buildEvidenceMatrix(run: PatchBenchRun): EvidenceMatrix {
  const candidates = run.candidates;
  const cmd = (name: string) => run.policy.verificationCommands.find((c) => c.name === name);
  const gateKind = (name: string): EvidenceMatrixRow["kind"] => {
    const c = cmd(name);
    return c && isRequired(c, run.policy) ? "hard-gate" : "informational";
  };

  const row = (key: string, label: string, kind: EvidenceMatrixRow["kind"], cell: Cell): EvidenceMatrixRow => ({
    key,
    label,
    kind,
    candidateValues: Object.fromEntries(candidates.map((c) => [c.id, cell(c)])),
  });

  const rows: EvidenceMatrixRow[] = [
    row("frozen_regression", "Frozen regression test intact", "hard-gate", (c) => {
      if (c.failure?.code === "REGRESSION_TEST_MUTATED" || c.verification?.regressionIntact === false) {
        return { status: "fail", display: "MUTATED", ...(c.failure?.detail ? { detail: [c.failure.detail] } : {}) };
      }
      return c.verification ? { status: "pass", display: "INTACT" } : notRun;
    }),
    row("regression", "Regression test", "hard-gate", (c) => checkCell(c.verification?.regression, !!c.verification)),
    row("new_failures", "New test failures vs baseline", "hard-gate", (c) => {
      const v = c.verification;
      if (!v) return notRun;
      if (!v.tests) return notConfigured;
      if (v.tests.skipped) return notRun;
      return v.newFailures.length === 0 ? { status: "pass", display: "0" } : { status: "fail", display: String(v.newFailures.length), detail: v.newFailures };
    }),
    row("existing_tests", "Test suite (pass / total, incl. frozen regression)", "informational", (c) => {
      const t = c.verification?.tests;
      const cell = checkCell(t, !!c.verification);
      return t?.summary && !t.skipped ? { ...cell, display: `${t.summary.pass}/${t.summary.tests}` } : cell;
    }),
    row("preserved_failures", "Pre-existing baseline failures still failing", "informational", (c) =>
      c.verification ? info(String(c.verification.preservedFailures.length), c.verification.preservedFailures) : notRun,
    ),
    row("typecheck", "Typecheck", gateKind("typecheck"), (c) => checkCell(c.verification?.typecheck, !!c.verification)),
    row("lint", "Lint", gateKind("lint"), (c) => checkCell(c.verification?.lint, !!c.verification)),
    row("build", "Build", gateKind("build"), (c) => checkCell(c.verification?.build, !!c.verification)),
    row("files_changed", "Files changed", "informational", (c) => {
      const d = c.verification?.diff ?? c.diff;
      return d ? info(String(d.filesChanged), d.files.map((f) => f.path)) : notRun;
    }),
    row("diff_size", "Lines added / deleted", "informational", (c) => {
      const d = c.verification?.diff ?? c.diff;
      return d ? info(`+${d.insertions} / -${d.deletions}`) : notRun;
    }),
    row("dependency_manifest", "Dependency manifest changed", "informational", (c) => {
      const d = c.verification?.diff ?? c.diff;
      return d ? info(d.dependencyManifestChanged ? "YES" : "NO") : notRun;
    }),
    row("config_touched", "Config files touched", "informational", (c) => {
      const d = c.verification?.diff ?? c.diff;
      return d ? info(String(d.configFilesTouched.length), d.configFilesTouched) : notRun;
    }),
  ];

  return {
    runId: run.id,
    baselineSha: run.repository.commitSha,
    baselineFailures: run.baseline?.failures ?? [],
    candidates: candidates.map((c) => ({
      id: c.id,
      title: run.strategies.find((s) => s.id === c.strategyId)?.title ?? c.strategyId,
      status: c.status,
      rejectionReasons: c.verification?.rejectionReasons ?? (c.failure ? [c.failure.message] : []),
    })),
    rows,
  };
}
