import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CheckResult } from "@/domain/evidence";
import type { RunPolicy } from "@/domain/policy";
import { buildCommandEnv, runCommand } from "../runner/command-runner";
import { locationFile, parseNodeTap, type TapReport } from "../runner/test-output";

export interface CheckSpec {
  name: string;
  command: string;
  args: readonly string[];
}

/** Checks whose output is node:test TAP and yields per-test failure identities. */
const TEST_CHECKS = new Set(["test", "regression"]);

/**
 * Stable identity for a failing test: `<file relative to cwd> > <name>`, so the
 * same test compares equal across baseline and candidate worktrees.
 */
export function failureIdentities(report: TapReport, roots: readonly string[]): string[] {
  const ids = report.failures.map((f) => {
    if (!f.location) return f.name;
    const file = locationFile(f.location);
    const root = roots.find((r) => file.startsWith(`${r}/`));
    if (!root) return f.name;
    const rel = file.slice(root.length + 1);
    return rel === f.name ? rel : `${rel} > ${f.name}`;
  });
  return [...new Set(ids)].sort();
}

/**
 * Runs one verification command through the safe runner (argument array, no
 * shell, timeout, bounded + redacted output, env allow-list, cwd allow-list)
 * and persists its log. Never throws for a failing command: failure is evidence.
 */
export async function runCheck(
  spec: CheckSpec,
  opts: { cwd: string; logFile: string; logPath: string; policy: RunPolicy; signal?: AbortSignal },
): Promise<CheckResult> {
  const command = { command: spec.command, args: [...spec.args] };
  const executed = await runCommand(
    { ...command, cwd: opts.cwd, timeoutMs: opts.policy.commandTimeoutMs, env: buildCommandEnv(opts.policy.envAllowList) },
    { allowedRoots: [opts.cwd], maxOutputBytes: opts.policy.maxOutputBytes, signal: opts.signal },
  );
  await mkdir(path.dirname(opts.logFile), { recursive: true });
  const header = `$ ${[command.command, ...command.args].join(" ")}\n`;

  if (!executed.ok) {
    await writeFile(opts.logFile, `${header}# could not run: ${executed.error.message} ${executed.error.detail ?? ""}\n`, { encoding: "utf8", flag: "wx" });
    return { name: spec.name, passed: false, exitCode: null, durationMs: 0, timedOut: false, failures: [`${spec.name}: could not start`], logPath: opts.logPath, command };
  }

  const res = executed.value;
  await writeFile(
    opts.logFile,
    `${header}# exit=${res.exitCode} signal=${res.signal} timedOut=${res.timedOut} durationMs=${res.durationMs}\n--- stdout${res.stdoutTruncated ? " (truncated)" : ""} ---\n${res.stdout}\n--- stderr${res.stderrTruncated ? " (truncated)" : ""} ---\n${res.stderr}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  const passed = res.exitCode === 0 && !res.timedOut && !res.cancelled;
  const result: CheckResult = { name: spec.name, passed, exitCode: res.exitCode, durationMs: res.durationMs, timedOut: res.timedOut, failures: [], logPath: opts.logPath, command };

  if (TEST_CHECKS.has(spec.name)) {
    const report = parseNodeTap(res.stdout);
    if (report.complete) result.summary = { tests: report.tests, pass: report.pass, fail: report.fail };
    const cwdReal = await realpath(opts.cwd).catch(() => opts.cwd);
    result.failures = failureIdentities(report, [...new Set([opts.cwd, cwdReal])]);
    // A tap-less or truncated failure still needs a comparable identity.
    if (!passed && result.failures.length === 0) result.failures = [`${spec.name}: ${res.timedOut ? "timed out" : `exit ${res.exitCode}`}`];
    // TAP says tests failed although the process exited 0: never report a pass.
    if (passed && report.fail > 0) result.passed = false;
  } else if (!passed && res.timedOut) {
    result.failures = [`${spec.name}: timed out`];
  }
  return result;
}
