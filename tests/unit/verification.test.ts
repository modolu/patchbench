import { describe, expect, it } from "vitest";
import type { CandidateResult } from "@/domain/candidate";
import type { CheckResult, VerificationResult } from "@/domain/evidence";
import { defaultRunPolicy, type VerificationCommand } from "@/domain/policy";
import { verificationCommandsFor } from "@/server/runner/script-detector";
import { parseNodeTap } from "@/server/runner/test-output";
import { failureIdentities } from "@/server/verification/checks";
import { buildEvidenceMatrix } from "@/server/verification/evidence-builder";
import { compareFailures, hardGateReasons } from "@/server/verification/gates";
import { makeRun } from "../helpers/factories";

const check = (name: string, passed: boolean, extra: Partial<CheckResult> = {}): CheckResult => ({
  name, passed, exitCode: passed ? 0 : 1, durationMs: 1, timedOut: false, failures: [], ...extra,
});
const cmd = (name: string, required: boolean): VerificationCommand => ({ name, command: "pnpm", args: ["run", name], required });

describe("compareFailures", () => {
  it("separates new failures from preserved baseline failures", () => {
    expect(compareFailures(["t > b", "t > known", "t > a"], ["t > known", "t > gone"])).toEqual({ newFailures: ["t > a", "t > b"], preservedFailures: ["t > known"] });
    expect(compareFailures([], ["t > known"])).toEqual({ newFailures: [], preservedFailures: [] });
  });
});

describe("hardGateReasons", () => {
  const policy = defaultRunPolicy();
  const base = { regressionIntact: true, regression: check("regression", true), newFailures: [] as string[], policy };
  const checks = (overrides: Record<string, boolean>) =>
    [cmd("test", true), cmd("typecheck", true), cmd("lint", false), cmd("build", true)].map((c) => ({ command: c, result: check(c.name, overrides[c.name] ?? true) }));

  it("passes when every gate passes, even with a failing lint and failing test exit", () => {
    expect(hardGateReasons({ ...base, checks: checks({ lint: false, test: false }) })).toEqual([]);
  });

  it("applies each rule independently and in order", () => {
    expect(hardGateReasons({ ...base, regressionIntact: false, checks: checks({}) })).toEqual(["Frozen regression test was modified or removed"]);
    expect(hardGateReasons({ ...base, regression: check("regression", false), newFailures: ["x > y"], checks: checks({ typecheck: false, build: false }) })).toEqual([
      "Regression test still fails",
      "Introduced new test failures (1): x > y",
      "Typecheck failed",
      "Build failed",
    ]);
  });

  it("follows policy: requireBuild=false makes build informational; required lint gates", () => {
    const relaxed = defaultRunPolicy({ requireBuild: false });
    const noBuildGate = [cmd("build", false)].map((c) => ({ command: c, result: check("build", false) }));
    expect(hardGateReasons({ ...base, policy: relaxed, checks: noBuildGate })).toEqual([]);
    const strictLint = [cmd("lint", true)].map((c) => ({ command: c, result: check("lint", false) }));
    expect(hardGateReasons({ ...base, checks: strictLint })).toEqual(['Required check "lint" failed']);
  });

  it("ignores skipped checks (not run because an earlier gate failed)", () => {
    const skipped = [cmd("build", true)].map((c) => ({ command: c, result: check("build", false, { skipped: true }) }));
    expect(hardGateReasons({ ...base, regressionIntact: false, checks: skipped })).toEqual(["Frozen regression test was modified or removed"]);
  });
});

describe("failureIdentities", () => {
  it("builds worktree-independent identities from TAP locations", () => {
    const tap = (root: string) => `TAP version 13
not ok 1 - disabled account
  ---
  location: '${root}/test/account-policy.test.ts:10:1'
  failureType: 'testCodeFailure'
  code: 'ERR_ASSERTION'
  ...
not ok 2 - test/broken.test.ts
  ---
  location: '${root}/test/broken.test.ts:1:1'
  failureType: 'testCodeFailure'
  code: 'ERR_TEST_FAILURE'
  ...
1..2
# tests 2
# pass 0
# fail 2
`;
    const a = failureIdentities(parseNodeTap(tap("/w/a")), ["/w/a"]);
    expect(a).toEqual(["test/account-policy.test.ts > disabled account", "test/broken.test.ts"]);
    expect(failureIdentities(parseNodeTap(tap("/w/baseline")), ["/w/baseline"])).toEqual(a);
  });
});

describe("verificationCommandsFor", () => {
  it("maps detected scripts to argument arrays in canonical order, skipping absent ones", () => {
    const cmds = verificationCommandsFor({ packageManager: "pnpm", detectedScripts: { build: "tsc", test: "node --test" } }, defaultRunPolicy());
    expect(cmds).toEqual([
      { name: "test", command: "pnpm", args: ["run", "test"], required: true },
      { name: "build", command: "pnpm", args: ["run", "build"], required: true },
    ]);
    expect(verificationCommandsFor({ packageManager: "unknown", detectedScripts: { lint: "eslint" } }, defaultRunPolicy())).toEqual([
      { name: "lint", command: "npm", args: ["run", "lint"], required: false },
    ]);
  });
});

describe("buildEvidenceMatrix", () => {
  const diff = { filesChanged: 1, insertions: 3, deletions: 1, files: [{ path: "src/a.ts", insertions: 3, deletions: 1 }], dependencyManifestChanged: false, configFilesTouched: [] };
  const verification = (v: Partial<VerificationResult>): VerificationResult => ({
    regressionIntact: true,
    regression: check("regression", true),
    tests: check("test", true, { summary: { tests: 5, pass: 5, fail: 0 } }),
    typecheck: check("typecheck", true),
    build: check("build", true),
    newFailures: [],
    baselineFailures: [],
    preservedFailures: [],
    diff,
    hardGatePassed: true,
    rejectionReasons: [],
    ...v,
  });
  const cand = (id: string, status: CandidateResult["status"], v?: VerificationResult, extra: Partial<CandidateResult> = {}): CandidateResult => ({
    id, strategyId: id, worktreePath: `/w/${id}`, branchName: `patchbench/r/${id}`, status, ...(v ? { verification: v } : {}), ...extra,
  });
  const run = makeRun({
    policy: defaultRunPolicy({ verificationCommands: [cmd("test", true), cmd("typecheck", true), cmd("build", true)] }),
    candidates: [
      cand("a", "ELIGIBLE", verification({})),
      cand("b", "REJECTED", verification({ newFailures: ["t > x"], hardGatePassed: false, rejectionReasons: ["Introduced new test failures (1): t > x"], tests: check("test", false, { summary: { tests: 5, pass: 4, fail: 1 } }) })),
      cand("c", "FAILED", undefined, { failure: { code: "WORKTREE_CREATE_FAILED", message: "no worktree", recoverable: false } }),
    ],
  });
  const m = buildEvidenceMatrix(run);
  const value = (key: string, id: string) => m.rows.find((r) => r.key === key)!.candidateValues[id];

  it("mirrors stored verification results without scoring", () => {
    expect(m.candidates).toEqual([
      { id: "a", title: "a", status: "ELIGIBLE", rejectionReasons: [] },
      { id: "b", title: "b", status: "REJECTED", rejectionReasons: ["Introduced new test failures (1): t > x"] },
      { id: "c", title: "c", status: "FAILED", rejectionReasons: ["no worktree"] },
    ]);
    expect(value("new_failures", "b")).toEqual({ status: "fail", display: "1", detail: ["t > x"] });
    expect(value("existing_tests", "b")).toEqual({ status: "fail", display: "4/5" });
    expect(value("lint", "a")).toEqual({ status: "not_configured", display: "NOT CONFIGURED" });
    expect(value("regression", "c")).toEqual({ status: "not_run", display: "NOT RUN" });
    expect(value("diff_size", "a")).toEqual({ status: "info", display: "+3 / -1" });
    expect(JSON.stringify(m)).not.toMatch(/score|winner|rank/i);
  });

  it("classifies hard-gate vs informational rows from policy", () => {
    const kinds = Object.fromEntries(m.rows.map((r) => [r.key, r.kind]));
    expect(kinds).toEqual({
      frozen_regression: "hard-gate",
      regression: "hard-gate",
      new_failures: "hard-gate",
      existing_tests: "informational",
      preserved_failures: "informational",
      typecheck: "hard-gate",
      lint: "informational",
      build: "hard-gate",
      files_changed: "informational",
      diff_size: "informational",
      dependency_manifest: "informational",
      config_touched: "informational",
    });
    const relaxed = buildEvidenceMatrix({ ...run, policy: defaultRunPolicy({ requireBuild: false, verificationCommands: [cmd("build", false)] }) });
    expect(relaxed.rows.find((r) => r.key === "build")!.kind).toBe("informational");
  });
});
