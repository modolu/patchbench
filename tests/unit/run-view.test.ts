import { describe, expect, it } from "vitest";
import type { CandidateResult } from "@/domain/candidate";
import type { CheckResult, VerificationResult } from "@/domain/evidence";
import type { RunEvent } from "@/domain/events";
import { defaultRunPolicy } from "@/domain/policy";
import type { PatchBenchRun, RunStatus } from "@/domain/run";
import { buildEvidenceMatrix } from "@/server/verification/evidence-builder";
import { buildTimeline, candidateCheckLines, conciseReason, failingGateRows, formatDuration, recordedWallTimeMs, runStats, splitFailureId } from "@/lib/run-view";
import { makeRun } from "../helpers/factories";

const policy = defaultRunPolicy({
  verificationCommands: [
    { name: "test", command: "pnpm", args: ["run", "test"], required: true },
    { name: "typecheck", command: "pnpm", args: ["run", "typecheck"], required: true },
    { name: "lint", command: "pnpm", args: ["run", "lint"], required: false },
    { name: "build", command: "pnpm", args: ["run", "build"], required: true },
  ],
});

const check = (name: string, passed = true, extra: Partial<CheckResult> = {}): CheckResult => ({ name, passed, exitCode: passed ? 0 : 1, durationMs: 1200, timedOut: false, failures: [], ...extra });

function verification(over: Partial<VerificationResult> = {}): VerificationResult {
  const reasons = over.newFailures?.length ? [`Introduced new test failures (${over.newFailures.length}): ${over.newFailures.join("; ")}`] : [];
  return {
    regressionIntact: true,
    regression: check("regression"),
    tests: check("test", !over.newFailures?.length, { summary: { tests: 13, pass: 13 - (over.newFailures?.length ?? 0), fail: over.newFailures?.length ?? 0 } }),
    typecheck: check("typecheck"),
    lint: check("lint"),
    build: check("build"),
    newFailures: [],
    baselineFailures: [],
    preservedFailures: [],
    diff: { filesChanged: 1, insertions: 2, deletions: 1, files: [{ path: "src/a.ts", insertions: 2, deletions: 1 }], dependencyManifestChanged: false, configFilesTouched: [] },
    hardGatePassed: reasons.length === 0,
    rejectionReasons: reasons,
    ...over,
  };
}

const cand = (id: string, v?: VerificationResult, status?: CandidateResult["status"]): CandidateResult => ({
  id,
  strategyId: id,
  worktreePath: `/x/.patchbench/worktrees/run-1/${id}`,
  branchName: `patchbench/run-1/${id}`,
  status: status ?? (v ? (v.hardGatePassed ? "ELIGIBLE" : "REJECTED") : "PENDING"),
  ...(v ? { verification: v } : {}),
});

function statusEvents(statuses: RunStatus[], startMs = Date.parse("2026-09-26T07:00:00.000Z")): RunEvent[] {
  let prev: RunStatus = "CREATED";
  return statuses.map((to, i) => {
    const e: RunEvent = { seq: i + 1, runId: "run-1", type: "run.status_changed", at: new Date(startMs + i * 10_000).toISOString(), data: { from: prev, to } };
    prev = to;
    return e;
  });
}

const FULL: RunStatus[] = ["BASELINING", "REPRODUCING", "STRATEGIZING", "PREPARING_CANDIDATES", "PATCHING", "VERIFYING", "COMPLETE"];

describe("timeline from persisted events", () => {
  it("marks every stage done for a completed run, with durations from event timestamps", () => {
    const run = makeRun({ status: "COMPLETE", policy, createdAt: "2026-09-26T07:00:00.000Z", candidates: [cand("a", verification())] });
    const events = statusEvents(FULL);
    const t = buildTimeline(run, events);
    expect(t.map((s) => [s.key, s.state])).toEqual([
      ["baseline", "done"], ["reproduce", "done"], ["strategies", "done"], ["prepare", "done"], ["patch", "done"], ["verify", "done"], ["complete", "done"],
    ]);
    expect(t[0]!.durationMs).toBe(10_000);
    expect(t.at(-1)!.detail).toBe("1 eligible · 0 rejected");
    expect(recordedWallTimeMs(run, events)).toBe(60_000);
  });

  it("shows the current stage as active with no fabricated duration or wall time", () => {
    const run = makeRun({ status: "PATCHING", policy });
    const events = statusEvents(FULL.slice(0, 5));
    const t = buildTimeline(run, events);
    expect(t.find((s) => s.key === "patch")).toMatchObject({ state: "active", durationMs: null });
    expect(t.find((s) => s.key === "verify")!.state).toBe("todo");
    expect(t.at(-1)).toMatchObject({ key: "complete", state: "todo" });
    expect(recordedWallTimeMs(run, events)).toBeNull();
  });

  it("marks the stage an exceptional run stopped in as failed", () => {
    const run = makeRun({ status: "UNVERIFIED", policy, failure: { code: "REPRO_NOT_CONFIRMED", message: "Regression passed on baseline.", recoverable: false } });
    const t = buildTimeline(run, statusEvents(["BASELINING", "REPRODUCING", "UNVERIFIED"]));
    expect(t.find((s) => s.key === "reproduce")!.state).toBe("failed");
    expect(t.at(-1)).toMatchObject({ key: "outcome", state: "failed", detail: "Regression passed on baseline." });
  });

  it("does not treat recorded baseline failures as a blocker", () => {
    const run = makeRun({ status: "COMPLETE", policy, baseline: { commitSha: "a".repeat(40), checks: [check("test", false)], failures: ["t > old"], durationMs: 5 } });
    const t = buildTimeline(run, statusEvents(FULL));
    expect(t[0]).toMatchObject({ state: "done" });
    expect(t[0]!.detail).toContain("1 pre-existing failure");
  });
});

describe("candidate check lines", () => {
  const run = makeRun({ policy });
  it("treats lint as informational and typecheck/build as gates under the persisted policy", () => {
    const lines = candidateCheckLines(run, cand("a", verification()));
    expect(Object.fromEntries(lines.map((l) => [l.key, l.gate]))).toEqual({ frozen: true, regression: true, new_failures: true, typecheck: true, lint: false, build: true });
  });

  it("marks lint as a gate only when the policy requires it", () => {
    const strict = makeRun({ policy: { ...policy, verificationCommands: policy.verificationCommands.map((c) => (c.name === "lint" ? { ...c, required: true } : c)) } });
    expect(candidateCheckLines(strict, cand("a", verification())).find((l) => l.key === "lint")!.gate).toBe(true);
  });

  it("judges the test suite by new failures, not by preserved baseline failures", () => {
    const preserved = verification({ tests: check("test", false, { summary: { tests: 13, pass: 12, fail: 1 } }), preservedFailures: ["t > old"], baselineFailures: ["t > old"] });
    expect(candidateCheckLines(run, cand("a", preserved)).find((l) => l.key === "new_failures")).toMatchObject({ state: "pass", result: "12/13 · 0 new" });
    const regressed = verification({ newFailures: ["t > x", "t > y"] });
    expect(candidateCheckLines(run, cand("b", regressed)).find((l) => l.key === "new_failures")).toMatchObject({ state: "fail", result: "11/13 · 2 new" });
  });

  it("shows pending checks for an unverified candidate", () => {
    expect(candidateCheckLines(run, cand("a")).every((l) => l.state === "pending")).toBe(true);
  });
});

describe("evidence helpers", () => {
  const run: PatchBenchRun = makeRun({ status: "COMPLETE", policy, candidates: [cand("a", verification()), cand("b", verification({ newFailures: ["f > one", "f > two"] }))] });

  it("finds exactly the failing hard-gate rows behind a rejection", () => {
    const matrix = buildEvidenceMatrix(run);
    expect(failingGateRows(matrix, "b").map((r) => r.key)).toEqual(["new_failures"]);
    expect(failingGateRows(matrix, "a")).toEqual([]);
  });

  it("computes stats without scores", () => {
    const s = runStats(run, statusEvents(FULL));
    expect(s).toMatchObject({ candidates: 2, eligible: 1, rejected: 1, checksRun: 10, checksPlanned: 10, newFailuresCaught: 2, verificationMs: 10_000 });
  });

  it("formats reasons, identities, and durations", () => {
    expect(conciseReason("Introduced new test failures (2): a; b")).toBe("Introduced new test failures (2)");
    expect(splitFailureId("test/x.test.ts > does y")).toEqual({ file: "test/x.test.ts", name: "does y" });
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(12_900)).toBe("12.9s");
    expect(formatDuration(125_000)).toBe("02:05");
  });
});
