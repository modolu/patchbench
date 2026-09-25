import { describe, expect, it } from "vitest";
import { classifyReproduction, type ProcessOutcome } from "@/server/reproduction/classify";
import { parseNodeTap } from "@/server/runner/test-output";

// Trimmed from real `node --test --test-reporter=tap` output (Node 22).
const summary = (tests: number, pass: number, fail: number, cancelled = 0) =>
  `1..${tests}\n# tests ${tests}\n# suites 0\n# pass ${pass}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped 0\n# todo 0\n`;

const ASSERTION_FAIL = `TAP version 13
# Subtest: expired refresh token returns 401, not 500
not ok 1 - expired refresh token returns 401, not 500
  ---
  duration_ms: 2.18
  type: 'test'
  location: '/w/test/refresh-expired.test.ts:5:1'
  failureType: 'testCodeFailure'
  error: |-
    expected 401, received 500

    500 !== 401

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 401
  actual: 500
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///w/test/refresh-expired.test.ts:7:10)
  ...
${summary(1, 0, 1)}`;

const SYNTAX_FAIL = `TAP version 13
# SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Expression expected
# Subtest: test/bad.test.ts
not ok 1 - test/bad.test.ts
  ---
  duration_ms: 73.7
  type: 'test'
  location: '/w/test/bad.test.ts:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
${summary(1, 0, 1)}`;

const EMPTY_FILE = `TAP version 13
# Subtest: test/empty.test.ts
ok 1 - test/empty.test.ts
  ---
  duration_ms: 62.9
  type: 'test'
  ...
${summary(1, 1, 0)}`;

const TYPE_ERROR = `TAP version 13
# Subtest: boom
not ok 1 - boom
  ---
  duration_ms: 0.6
  type: 'test'
  location: '/w/test/te.test.ts:2:1'
  failureType: 'testCodeFailure'
  error: 'nope'
  code: 'ERR_TEST_FAILURE'
  name: 'TypeError'
  ...
# Subtest: ok
ok 2 - ok
  ---
  duration_ms: 0.1
  type: 'test'
  ...
${summary(2, 1, 1)}`;

const PASS = `TAP version 13
# Subtest: expired refresh token returns 401, not 500
ok 1 - expired refresh token returns 401, not 500
  ---
  duration_ms: 1.2
  type: 'test'
  ...
${summary(1, 1, 0)}`;

const NESTED = `TAP version 13
# Subtest: suite \\# one
    # Subtest: inner
    not ok 1 - inner
      ---
      duration_ms: 1
      location: '/w/test/refresh-expired.test.ts:6:3'
      failureType: 'testCodeFailure'
      error: 'expected 401, received 500'
      code: 'ERR_ASSERTION'
      name: 'AssertionError'
      ...
    1..1
not ok 1 - suite \\# one
  ---
  duration_ms: 2
  type: 'suite'
  location: '/w/test/refresh-expired.test.ts:5:1'
  failureType: 'subtestsFailed'
  error: '1 subtest failed'
  code: 'ERR_TEST_FAILURE'
  ...
${summary(1, 0, 1)}`;

const proc = (o: Partial<ProcessOutcome> = {}): ProcessOutcome => ({ exitCode: 1, signal: null, timedOut: false, cancelled: false, ...o });
const REPRO = { testFiles: ["test/refresh-expired.test.ts"], expectedFailure: "expected 401, received 500" };

describe("parseNodeTap", () => {
  it("extracts assertion failures with code, type and message", () => {
    const r = parseNodeTap(ASSERTION_FAIL);
    expect(r).toMatchObject({ complete: true, tests: 1, pass: 0, fail: 1 });
    expect(r.failures).toEqual([
      {
        name: "expired refresh token returns 401, not 500",
        ok: false,
        depth: 0,
        failureType: "testCodeFailure",
        code: "ERR_ASSERTION",
        errorName: "AssertionError",
        errorText: "expected 401, received 500\n\n500 !== 401",
        location: "/w/test/refresh-expired.test.ts:5:1",
      },
    ]);
  });

  it("reports file-level load failures", () => {
    const r = parseNodeTap(SYNTAX_FAIL);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ name: "test/bad.test.ts", code: "ERR_TEST_FAILURE", errorText: "test failed" });
  });

  it("keeps nested leaf failures and drops subtestsFailed wrappers; unescapes names", () => {
    const r = parseNodeTap(NESTED);
    expect(r.points.map((p) => [p.name, p.depth])).toEqual([["inner", 1], ["suite # one", 0]]);
    expect(r.failures.map((f) => f.name)).toEqual(["inner"]);
  });

  it("marks output without a summary as incomplete", () => {
    expect(parseNodeTap(ASSERTION_FAIL.split("1..1")[0]!).complete).toBe(false);
    expect(parseNodeTap("random noise\nexit 1").complete).toBe(false);
  });
});

describe("classifyReproduction", () => {
  const classify = (tap: string, p = proc(), repro = REPRO) => classifyReproduction({ process: p, report: parseNodeTap(tap), ...repro });

  it("accepts an assertion failure with the expected message", () => {
    expect(classify(ASSERTION_FAIL)).toEqual({ outcome: "REPRODUCED", failingTests: ["expired refresh token returns 401, not 500"] });
    expect(classify(NESTED).outcome).toBe("REPRODUCED");
  });

  it("matches expected failure text ignoring whitespace and case", () => {
    expect(classify(ASSERTION_FAIL, proc(), { ...REPRO, expectedFailure: "  Expected 401,\n received 500 " }).outcome).toBe("REPRODUCED");
  });

  it.each([
    ["timeout", proc({ timedOut: true, exitCode: null, signal: "SIGTERM" }), /timed out/],
    ["cancellation", proc({ cancelled: true, exitCode: null }), /cancelled/],
    ["signal", proc({ exitCode: null, signal: "SIGKILL" }), /SIGKILL/],
  ])("rejects %s as invalid even with a matching assertion", (_n, p, reason) => {
    const r = classify(ASSERTION_FAIL, p);
    expect(r).toMatchObject({ outcome: "INVALID_REPRODUCTION", code: "REPRO_INVALID" });
    expect(r.outcome !== "REPRODUCED" && r.reason).toMatch(reason);
  });

  it("rejects a syntax/load failure despite non-zero exit and fail=1", () => {
    const r = classify(SYNTAX_FAIL, proc(), { ...REPRO, testFiles: ["test/bad.test.ts"] });
    expect(r).toMatchObject({ outcome: "INVALID_REPRODUCTION", code: "REPRO_INVALID" });
    expect(r.outcome !== "REPRODUCED" && r.reason).toMatch(/failed to load/);
  });

  it("rejects zero tests", () => {
    const r = classify(EMPTY_FILE, proc({ exitCode: 0 }), { ...REPRO, testFiles: ["test/empty.test.ts"] });
    expect(r).toMatchObject({ outcome: "INVALID_REPRODUCTION", reason: expect.stringMatching(/no tests/) });
  });

  it("reports a clean pass as NOT_REPRODUCED, not invalid", () => {
    expect(classify(PASS, proc({ exitCode: 0 }))).toMatchObject({ outcome: "NOT_REPRODUCED", code: "REPRO_NOT_CONFIRMED" });
  });

  it("rejects non-assertion runtime errors", () => {
    const r = classify(TYPE_ERROR, proc(), { ...REPRO, testFiles: ["test/te.test.ts"] });
    expect(r).toMatchObject({ outcome: "INVALID_REPRODUCTION", reason: expect.stringMatching(/TypeError/) });
  });

  it("rejects a failure defined outside the regression files", () => {
    const r = classify(ASSERTION_FAIL.replace("/w/test/refresh-expired.test.ts:5:1", "/w/test/login.test.ts:5:1"));
    expect(r).toMatchObject({ outcome: "INVALID_REPRODUCTION", reason: expect.stringMatching(/not defined in the regression/) });
  });

  it("rejects an assertion failure for the wrong reason", () => {
    const r = classify(ASSERTION_FAIL, proc(), { ...REPRO, expectedFailure: "expected 418" });
    expect(r).toMatchObject({ outcome: "INVALID_REPRODUCTION", reason: expect.stringMatching(/expected failure/) });
  });

  it("rejects incomplete output and inconsistent exit codes", () => {
    expect(classify("garbage").outcome).toBe("INVALID_REPRODUCTION");
    expect(classify(ASSERTION_FAIL, proc({ exitCode: 0 })).outcome).toBe("INVALID_REPRODUCTION");
    expect(classify(PASS, proc({ exitCode: 1 })).outcome).toBe("INVALID_REPRODUCTION");
  });
});
