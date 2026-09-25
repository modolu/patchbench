import { describe, expect, it } from "vitest";
import { pbError } from "@/domain/errors";
import { RUN_STATUSES, type RunStatus } from "@/domain/run";
import {
  EXCEPTIONAL_TERMINAL_STATES,
  applyRunTransition,
  canTransitionCandidate,
  canTransitionRun,
  isTerminalCandidateStatus,
  isTerminalRunStatus,
} from "@/server/runs/state-machine";
import { makeRun } from "../helpers/factories";

const HAPPY_PATH: RunStatus[] = [
  "CREATED",
  "BASELINING",
  "REPRODUCING",
  "STRATEGIZING",
  "PREPARING_CANDIDATES",
  "PATCHING",
  "VERIFYING",
  "COMPLETE",
];

describe("run state machine", () => {
  it("walks the happy path in order", () => {
    for (let i = 0; i < HAPPY_PATH.length - 1; i++) {
      expect(canTransitionRun(HAPPY_PATH[i]!, HAPPY_PATH[i + 1]!)).toBe(true);
    }
  });

  it("rejects skipping the reproduction gate", () => {
    expect(canTransitionRun("BASELINING", "STRATEGIZING")).toBe(false);
    expect(canTransitionRun("CREATED", "REPRODUCING")).toBe(false);
    expect(canTransitionRun("BASELINING", "PATCHING")).toBe(false);
    expect(canTransitionRun("REPRODUCING", "PREPARING_CANDIDATES")).toBe(false);
  });

  it("rejects moving backwards", () => {
    expect(canTransitionRun("VERIFYING", "PATCHING")).toBe(false);
    expect(canTransitionRun("REPRODUCING", "BASELINING")).toBe(false);
  });

  it("routes exceptional outcomes only from their owning stage", () => {
    expect(canTransitionRun("BASELINING", "BLOCKED_BASELINE")).toBe(true);
    expect(canTransitionRun("REPRODUCING", "UNVERIFIED")).toBe(true);
    expect(canTransitionRun("REPRODUCING", "BLOCKED_BASELINE")).toBe(false);
    expect(canTransitionRun("PATCHING", "UNVERIFIED")).toBe(false);
  });

  it("treats COMPLETE and every exceptional state as terminal", () => {
    for (const terminal of ["COMPLETE", ...EXCEPTIONAL_TERMINAL_STATES] as RunStatus[]) {
      expect(isTerminalRunStatus(terminal)).toBe(true);
      for (const to of RUN_STATUSES) expect(canTransitionRun(terminal, to)).toBe(false);
    }
  });

  it("allows cancellation and failure from every non-terminal state", () => {
    for (const from of RUN_STATUSES.filter((s) => !isTerminalRunStatus(s))) {
      expect(canTransitionRun(from, "CANCELLED")).toBe(true);
      expect(canTransitionRun(from, "FAILED")).toBe(true);
    }
  });

  it("applyRunTransition returns a new run and records failure", () => {
    const run = makeRun({ status: "REPRODUCING" });
    const failure = pbError("REPRO_NOT_CONFIRMED", "Regression test passed on baseline.");
    const result = applyRunTransition(run, "UNVERIFIED", { at: "2026-09-25T12:05:00.000Z", failure });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("UNVERIFIED");
    expect(result.value.failure?.code).toBe("REPRO_NOT_CONFIRMED");
    expect(result.value.updatedAt).toBe("2026-09-25T12:05:00.000Z");
    expect(run.status).toBe("REPRODUCING");
  });

  it("applyRunTransition returns INVALID_TRANSITION for illegal moves", () => {
    const result = applyRunTransition(makeRun({ status: "COMPLETE" }), "BASELINING", { at: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("candidate state machine", () => {
  it("walks implement → verify → verdict", () => {
    expect(canTransitionCandidate("PENDING", "IMPLEMENTING")).toBe(true);
    expect(canTransitionCandidate("IMPLEMENTING", "IMPLEMENTED")).toBe(true);
    expect(canTransitionCandidate("IMPLEMENTED", "VERIFYING")).toBe(true);
    expect(canTransitionCandidate("VERIFYING", "ELIGIBLE")).toBe(true);
    expect(canTransitionCandidate("VERIFYING", "REJECTED")).toBe(true);
  });

  it("cannot be judged without verification", () => {
    expect(canTransitionCandidate("IMPLEMENTED", "ELIGIBLE")).toBe(false);
    expect(canTransitionCandidate("PENDING", "REJECTED")).toBe(false);
  });

  it("verdicts are final; failures can be retried", () => {
    expect(isTerminalCandidateStatus("ELIGIBLE")).toBe(true);
    expect(isTerminalCandidateStatus("REJECTED")).toBe(true);
    expect(canTransitionCandidate("REJECTED", "PENDING")).toBe(false);
    expect(canTransitionCandidate("FAILED", "PENDING")).toBe(true);
    expect(canTransitionCandidate("TIMED_OUT", "PENDING")).toBe(true);
  });
});
