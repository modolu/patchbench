import type { CandidateResult, CandidateStatus } from "@/domain/candidate";
import type { CheckResult, EvidenceMatrix, EvidenceMatrixRow } from "@/domain/evidence";
import type { RunEvent } from "@/domain/events";
import type { PatchBenchRun, RunStatus } from "@/domain/run";

/**
 * Pure projections of persisted run state for the UI. No I/O, no clocks:
 * every value is derived from run.json / events.jsonl / report.json.
 */

export type Tone = "pass" | "fail" | "running" | "neutral";

export function runStatusTone(status: RunStatus): Tone {
  if (status === "COMPLETE") return "pass";
  if (status === "FAILED" || status === "BLOCKED_BASELINE" || status === "UNVERIFIED") return "fail";
  if (status === "CANCELLED" || status === "CREATED") return "neutral";
  return "running";
}

export function candidateStatusTone(status: CandidateStatus): Tone {
  if (status === "ELIGIBLE") return "pass";
  if (status === "REJECTED" || status === "FAILED" || status === "TIMED_OUT") return "fail";
  if (status === "PENDING") return "neutral";
  return "running";
}

export const shortSha = (sha: string): string => sha.slice(0, 7);

/** `mm:ss` (or `h:mm:ss`); null for unknown durations so the UI can show a neutral dash. */
export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const msBetween = (from?: string, to?: string): number | null => {
  if (!from || !to) return null;
  const d = Date.parse(to) - Date.parse(from);
  return Number.isFinite(d) && d >= 0 ? d : null;
};

// ---------------------------------------------------------------- timeline

export type StageState = "done" | "active" | "failed" | "todo";

export interface TimelineStage {
  key: string;
  name: string;
  state: StageState;
  detail: string;
  durationMs: number | null;
}

const STAGES: Array<{ status: RunStatus; key: string; name: string }> = [
  { status: "BASELINING", key: "baseline", name: "Baseline" },
  { status: "REPRODUCING", key: "reproduce", name: "Reproduce" },
  { status: "STRATEGIZING", key: "strategies", name: "Strategies" },
  { status: "PREPARING_CANDIDATES", key: "prepare", name: "Prepare" },
  { status: "PATCHING", key: "patch", name: "Patch" },
  { status: "VERIFYING", key: "verify", name: "Verify" },
];

interface StatusSpan {
  status: RunStatus;
  enteredAt: string;
  leftAt?: string;
  next?: RunStatus;
}

/** Status spans reconstructed from `run.status_changed` events, in order. */
export function statusSpans(events: readonly RunEvent[]): StatusSpan[] {
  const spans: StatusSpan[] = [];
  for (const e of events) {
    if (e.type !== "run.status_changed") continue;
    const to = e.data?.to as RunStatus | undefined;
    if (!to) continue;
    const prev = spans.at(-1);
    if (prev) {
      prev.leftAt = e.at;
      prev.next = to;
    }
    spans.push({ status: to, enteredAt: e.at });
  }
  return spans;
}

function stageDetail(key: string, run: PatchBenchRun): string {
  const b = run.baseline;
  switch (key) {
    case "baseline": {
      if (!b) return "clean detached worktree";
      const tests = b.checks.find((c) => c.name === "test")?.summary;
      const pre = b.failures.length ? ` · ${b.failures.length} pre-existing failure${b.failures.length === 1 ? "" : "s"}` : "";
      return `${tests ? `${tests.pass}/${tests.tests} tests · ` : ""}${b.checks.length} checks${pre}`;
    }
    case "reproduce":
      return run.reproduction ? `${run.reproduction.outcome} · ${run.reproduction.testFiles.length} test file${run.reproduction.testFiles.length === 1 ? "" : "s"}` : "regression must fail on baseline";
    case "strategies":
      return run.strategies.length ? `${run.strategies.length} independent strateg${run.strategies.length === 1 ? "y" : "ies"}` : `up to ${run.policy.candidateCount}`;
    case "prepare":
      return run.candidates.length ? `${run.candidates.length} worktrees @ ${shortSha(run.repository.commitSha)}` : "one worktree per candidate";
    case "patch": {
      const done = run.candidates.filter((c) => c.implementation).map((c) => c.id.toUpperCase());
      return done.length ? `${done.join(" · ")} implemented` : "isolated implementations";
    }
    case "verify": {
      const verified = run.candidates.filter((c) => c.verification).length;
      return `sequential · ${verified}/${run.candidates.length || run.policy.candidateCount} verified`;
    }
    default:
      return "";
  }
}

/**
 * Pipeline rail. A stage is done once the run left it for a non-exceptional
 * status, failed if the run ended there exceptionally, active if the run is
 * in it now. Durations come only from event timestamps; the active stage has
 * none (no fake clocks).
 */
export function buildTimeline(run: PatchBenchRun, events: readonly RunEvent[]): TimelineStage[] {
  const spans = statusSpans(events);
  const exceptional: RunStatus[] = ["BLOCKED_BASELINE", "UNVERIFIED", "FAILED", "CANCELLED"];
  const stages: TimelineStage[] = STAGES.map(({ status, key, name }) => {
    const span = spans.find((s) => s.status === status);
    let state: StageState = "todo";
    if (span?.next) state = exceptional.includes(span.next) ? "failed" : "done";
    else if (span && run.status === status) state = "active";
    else if (!span && run.status === status) state = "active";
    return { key, name, state, detail: stageDetail(key, run), durationMs: span?.leftAt ? msBetween(span.enteredAt, span.leftAt) : null };
  });

  const eligible = run.candidates.filter((c) => c.status === "ELIGIBLE").length;
  const rejected = run.candidates.filter((c) => c.status === "REJECTED").length;
  if (exceptional.includes(run.status)) {
    stages.push({ key: "outcome", name: run.status.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), state: "failed", detail: run.failure?.message ?? run.status, durationMs: null });
  } else {
    stages.push({
      key: "complete",
      name: "Complete",
      state: run.status === "COMPLETE" ? "done" : "todo",
      detail: run.status === "COMPLETE" ? `${eligible} eligible · ${rejected} rejected` : "awaiting evidence",
      durationMs: null,
    });
  }
  return stages;
}

/** Recorded wall time: run creation → last persisted event (terminal runs only). */
export function recordedWallTimeMs(run: PatchBenchRun, events: readonly RunEvent[]): number | null {
  const terminal = ["COMPLETE", "BLOCKED_BASELINE", "UNVERIFIED", "FAILED", "CANCELLED"].includes(run.status);
  if (!terminal) return null;
  return msBetween(run.createdAt, events.at(-1)?.at ?? run.updatedAt);
}

// ---------------------------------------------------------------- candidates

export type CheckState = "pass" | "fail" | "skipped" | "not_configured" | "pending";

export interface CheckLine {
  key: string;
  name: string;
  state: CheckState;
  /** Hard gate under the persisted policy. */
  gate: boolean;
  result: string;
}

const requiredByPolicy = (run: PatchBenchRun, name: string): boolean => {
  const cmd = run.policy.verificationCommands.find((c) => c.name === name);
  if (!cmd) return false;
  return cmd.required || (name === "typecheck" && run.policy.requireTypecheck) || (name === "build" && run.policy.requireBuild);
};

const checkState = (c: CheckResult | undefined, verified: boolean): CheckState => {
  if (!verified) return "pending";
  if (!c) return "not_configured";
  if (c.skipped) return "skipped";
  return c.passed ? "pass" : "fail";
};

const checkResultText = (c: CheckResult | undefined, state: CheckState): string => {
  if (state === "pending") return "pending";
  if (state === "not_configured") return "not configured";
  if (state === "skipped") return "not run";
  const d = formatDuration(c?.durationMs);
  return `${c?.timedOut ? "timeout" : state}${d ? ` · ${d}` : ""}`;
};

/** The bench card's check list, in verifier order, with gate/informational from policy. */
export function candidateCheckLines(run: PatchBenchRun, c: CandidateResult): CheckLine[] {
  const v = c.verification;
  const verified = !!v;
  const lines: CheckLine[] = [];
  const intact = v ? v.regressionIntact && c.failure?.code !== "REGRESSION_TEST_MUTATED" : null;
  lines.push({ key: "frozen", name: "Frozen regression intact", gate: true, state: intact === null ? "pending" : intact ? "pass" : "fail", result: intact === null ? "pending" : intact ? "intact" : "mutated" });
  const reg = checkState(v?.regression, verified);
  lines.push({ key: "regression", name: "Regression test", gate: true, state: reg, result: checkResultText(v?.regression, reg) });
  const tests = v?.tests;
  const tState = checkState(tests, verified);
  if (tests || !verified || run.policy.verificationCommands.some((cmd) => cmd.name === "test")) {
    const newCount = v?.newFailures.length ?? 0;
    const counts = tests?.summary && !tests.skipped ? `${tests.summary.pass}/${tests.summary.tests}` : null;
    lines.push({
      key: "new_failures",
      name: "Test suite · new failures",
      gate: true,
      state: tState === "pass" || tState === "fail" ? (newCount > 0 ? "fail" : "pass") : tState,
      result: tState === "pass" || tState === "fail" ? `${counts ? `${counts} · ` : ""}${newCount} new` : checkResultText(tests, tState),
    });
  }
  for (const name of ["typecheck", "lint", "build"] as const) {
    const configured = run.policy.verificationCommands.some((cmd) => cmd.name === name);
    if (!configured && verified && !v?.[name]) continue;
    const s = checkState(v?.[name], verified);
    lines.push({ key: name, name: name === "build" ? "Build" : name === "lint" ? "Lint" : "Typecheck", gate: requiredByPolicy(run, name), state: s, result: checkResultText(v?.[name], s) });
  }
  return lines;
}

// ---------------------------------------------------------------- evidence

export interface RunStats {
  candidates: number;
  eligible: number;
  rejected: number;
  failed: number;
  checksRun: number;
  checksPlanned: number;
  newFailuresCaught: number;
  verificationMs: number | null;
}

export function runStats(run: PatchBenchRun, events: readonly RunEvent[]): RunStats {
  const perCandidate = 1 + run.policy.verificationCommands.length;
  let checksRun = 0;
  for (const c of run.candidates) {
    const v = c.verification;
    if (!v) continue;
    for (const check of [v.regression, v.tests, v.typecheck, v.lint, v.build]) if (check && !check.skipped) checksRun += 1;
  }
  const verify = statusSpans(events).find((s) => s.status === "VERIFYING");
  return {
    candidates: run.candidates.length,
    eligible: run.candidates.filter((c) => c.status === "ELIGIBLE").length,
    rejected: run.candidates.filter((c) => c.status === "REJECTED").length,
    failed: run.candidates.filter((c) => c.status === "FAILED" || c.status === "TIMED_OUT").length,
    checksRun,
    checksPlanned: perCandidate * run.candidates.length,
    newFailuresCaught: run.candidates.reduce((n, c) => n + (c.verification?.newFailures.length ?? 0), 0),
    verificationMs: verify?.leftAt ? msBetween(verify.enteredAt, verify.leftAt) : null,
  };
}

/** Hard-gate rows whose value for `candidateId` is a failure: the evidence behind a rejection. */
export function failingGateRows(matrix: EvidenceMatrix, candidateId: string): EvidenceMatrixRow[] {
  return matrix.rows.filter((r) => r.kind === "hard-gate" && r.candidateValues[candidateId]?.status === "fail");
}

/** Readable rejection reason: the verifier's text minus the inline identity list (shown separately). */
export const conciseReason = (reason: string): string => reason.replace(/ \((\d+)\):.*$/, " ($1)");

/** `test/file.test.ts > name` → { file, name }. */
export function splitFailureId(id: string): { file: string | null; name: string } {
  const i = id.indexOf(" > ");
  return i < 0 ? { file: null, name: id } : { file: id.slice(0, i), name: id.slice(i + 3) };
}

const TERMINAL: readonly RunStatus[] = ["COMPLETE", "BLOCKED_BASELINE", "UNVERIFIED", "FAILED", "CANCELLED"];
export const isTerminal = (status: RunStatus): boolean => TERMINAL.includes(status);
