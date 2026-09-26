import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pbError, type PatchBenchError } from "@/domain/errors";
import type { CheckResult } from "@/domain/evidence";
import type { FrozenFile, PatchBenchRun, ReproductionResult, RunStatus } from "@/domain/run";
import { err, ok, type Result } from "@/lib/result";
import { systemClock, type Clock } from "@/lib/time";
import type { BobAdapter } from "../bob/adapter";
import type { ReproductionProposal } from "../bob/schemas";
import { GitAdapter, type StatusEntry } from "../git/git-adapter";
import { buildCommandEnv, runCommand } from "../runner/command-runner";
import { parseNodeTap } from "../runner/test-output";
import { transitionRun } from "../runs/lifecycle";
import type { FileRunStore } from "../runs/store";
import { classifyReproduction } from "./classify";
import { buildNewFilesPatch, hashWorkspaceFile, reproductionDir, writeFileExclusive, writeFrozenArtifact, type NewFile } from "./regression-artifact";

export interface ReproductionGateDeps {
  store: FileRunStore;
  bob: BobAdapter;
  clock?: Clock;
}

export interface ReproductionGateInput {
  runId: string;
  /** PatchBench-owned, clean checkout of the baseline SHA. Bob writes here. */
  workspace: string;
  /** The user's repository. Only ever read; must be unchanged afterwards. */
  primaryRoot: string;
  signal?: AbortSignal;
}

const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

export const isTestPath = (p: string): boolean => TEST_PATH.test(p);

/** Segment-wise glob match against policy.excludePaths (`*` wildcard only). */
export function isExcludedPath(p: string, patterns: readonly string[]): boolean {
  const regexes = patterns.map((pat) => new RegExp(`^${pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`));
  return p.split("/").some((seg) => regexes.some((r) => r.test(seg)));
}

interface PrimaryState {
  sha: string;
  status: StatusEntry[];
}

async function readPrimary(git: GitAdapter, root: string): Promise<Result<PrimaryState, PatchBenchError>> {
  const [sha, status] = await Promise.all([git.currentSha(root), git.statusEntries(root)]);
  if (!sha.ok) return sha;
  if (!status.ok) return status;
  return ok({ sha: sha.value, status: status.value });
}

type Validated = { files: NewFile[]; frozen: FrozenFile[] };

/**
 * Independently inspects the workspace: the only changes allowed are the
 * declared, new, regular test files. Never trusts the adapter's claims.
 */
async function validateChangedFiles(
  git: GitAdapter,
  workspace: string,
  proposal: ReproductionProposal,
  excludePaths: readonly string[],
): Promise<Result<Validated, string>> {
  const status = await git.statusEntries(workspace);
  if (!status.ok) return err(`Could not inspect the reproduction workspace: ${status.error.message}`);
  const declared = [...proposal.testFiles].sort();
  if (new Set(declared).size !== declared.length) return err("Proposal declares duplicate test files.");
  const actual = status.value.map((e) => e.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(declared)) {
    return err(`Changed files [${actual.join(", ")}] do not match declared test files [${declared.join(", ")}].`);
  }
  const files: NewFile[] = [];
  const frozen: FrozenFile[] = [];
  for (const entry of status.value) {
    if (entry.x !== "?" || entry.y !== "?") return err(`${entry.path} modifies an existing file; only new test files are allowed.`);
    if (!isTestPath(entry.path)) return err(`${entry.path} is not a test file.`);
    if (isExcludedPath(entry.path, excludePaths)) return err(`${entry.path} is in an excluded path.`);
    const hash = await hashWorkspaceFile(workspace, entry.path);
    if (!hash.ok) return err(`${entry.path} is not a regular file inside the workspace (${hash.error.kind}).`);
    const full = path.join(workspace, entry.path);
    const st = await lstat(full);
    files.push({ path: entry.path, content: await readFile(full), executable: (st.mode & 0o111) !== 0 });
    frozen.push({ path: entry.path, sha256: hash.value });
  }
  frozen.sort((a, b) => (a.path < b.path ? -1 : 1));
  return ok({ files, frozen });
}

/**
 * The reproduction gate (architecture §9.2–9.3). Requires REPRODUCING and
 * ends in STRATEGIZING (REPRODUCED + frozen artifact), UNVERIFIED, FAILED or
 * CANCELLED. Returns err only when nothing was touched (wrong state, missing
 * run, gate already ran). Never resets, checks out, or cleans anything.
 */
export async function runReproductionGate(
  deps: ReproductionGateDeps,
  input: ReproductionGateInput,
): Promise<Result<PatchBenchRun, PatchBenchError>> {
  const { store, bob } = deps;
  const clock = deps.clock ?? systemClock;
  const { runId, signal } = input;

  const loaded = await store.loadRun(runId);
  if (!loaded.ok) return loaded;
  const run = loaded.value;
  if (run.status !== "REPRODUCING") {
    return err(pbError("INVALID_TRANSITION", `Reproduction requires REPRODUCING, run is ${run.status}.`));
  }
  const dir = reproductionDir(store, runId);
  try {
    await mkdir(dir); // exclusive: the gate runs at most once per run
  } catch (cause) {
    return err(pbError("RUN_CORRUPT", "Reproduction artifacts already exist for this run.", { detail: String(cause) }));
  }

  const started = clock.now().getTime();
  const policy = run.policy;
  const primaryGit = new GitAdapter({ allowedRoots: [input.primaryRoot] });
  const wsGit = new GitAdapter({ allowedRoots: [input.workspace] });
  let commandsExecuted = 0;
  const guard: { primaryBefore?: PrimaryState } = {};

  /** Persists the outcome and advances state; primary-worktree mutation overrides everything. */
  const finish = async (
    to: RunStatus,
    opts: { failure?: PatchBenchError; reproduction?: ReproductionResult },
  ): Promise<Result<PatchBenchRun, PatchBenchError>> => {
    let { failure, reproduction } = opts;
    const primaryBefore = guard.primaryBefore;
    if (primaryBefore) {
      const after = await readPrimary(primaryGit, input.primaryRoot);
      if (!after.ok || JSON.stringify(after.value) !== JSON.stringify(primaryBefore)) {
        to = "FAILED";
        failure = pbError("BASELINE_MUTATED", "The primary worktree changed during reproduction.", {
          detail: after.ok ? `before=${JSON.stringify(primaryBefore)} after=${JSON.stringify(after.value)}` : after.error.message,
          recoverable: false,
          nextAction: "Inspect your repository manually; PatchBench will not modify it.",
        });
        if (reproduction?.outcome === "REPRODUCED") reproduction = { ...reproduction, outcome: "INVALID_REPRODUCTION", reasonCode: "BASELINE_MUTATED", reason: failure.message };
      }
    }
    if (reproduction) await writeFileExclusive(path.join(dir, "result.json"), `${JSON.stringify(reproduction, null, 2)}\n`);
    const current = await store.loadRun(runId);
    if (!current.ok) return current;
    await store.saveRun({
      ...current.value,
      ...(reproduction ? { reproduction } : {}),
      metrics: {
        ...current.value.metrics,
        commandsExecuted: current.value.metrics.commandsExecuted + commandsExecuted,
        stageDurationsMs: { ...current.value.metrics.stageDurationsMs, reproduction: Math.max(0, clock.now().getTime() - started) },
      },
    });
    if (to === "STRATEGIZING" && reproduction) {
      await store.appendEvent(runId, {
        type: "reproduction.confirmed",
        data: { testFiles: reproduction.testFiles, sha256: reproduction.frozenPatchSha256, failingTests: reproduction.baselineCheck?.failures ?? [] },
      });
    } else if (reproduction && to === "UNVERIFIED") {
      await store.appendEvent(runId, { type: "reproduction.rejected", data: { outcome: reproduction.outcome, code: reproduction.reasonCode, reason: reproduction.reason } });
    } else {
      await store.appendEvent(runId, { type: "reproduction.failed", data: { status: to, code: failure?.code } });
    }
    return transitionRun(store, runId, to, { failure, clock });
  };
  const failed = (failure: PatchBenchError) => finish("FAILED", { failure });
  const cancelled = () => finish("CANCELLED", { failure: pbError("COMMAND_CANCELLED", "Reproduction was cancelled.", { recoverable: true }) });

  // Preconditions: an owned, clean baseline workspace distinct from the primary worktree.
  const [wsReal, primaryReal] = await Promise.all([realpath(input.workspace).catch(() => null), realpath(input.primaryRoot).catch(() => null)]);
  if (!wsReal || !primaryReal || wsReal === primaryReal) {
    return failed(pbError("REPO_DIRTY", "Reproduction workspace must be a PatchBench-owned directory, not the primary worktree."));
  }
  const before = await readPrimary(primaryGit, input.primaryRoot);
  if (!before.ok) return failed(before.error);
  guard.primaryBefore = before.value;
  const [wsSha, wsStatus] = await Promise.all([wsGit.currentSha(input.workspace), wsGit.statusEntries(input.workspace)]);
  if (!wsSha.ok || wsSha.value !== run.repository.commitSha || !wsStatus.ok || wsStatus.value.length > 0) {
    return failed(pbError("REPO_DIRTY", "Reproduction workspace is not a clean checkout of the baseline commit.", { detail: wsSha.ok ? wsSha.value : wsSha.error.message }));
  }

  await store.appendEvent(runId, { type: "reproduction.started", data: { baseSha: run.repository.commitSha, adapter: bob.kind } });
  if (signal?.aborted) return cancelled();

  const generated = await bob.generateReproduction({ runId, workspace: input.workspace, repository: run.repository, issue: run.issue, signal });
  if (!generated.ok) return generated.error.code === "COMMAND_CANCELLED" ? cancelled() : failed(generated.error);
  const proposal = generated.value;
  await writeFileExclusive(path.join(dir, "proposal.json"), `${JSON.stringify(proposal, null, 2)}\n`);
  await store.appendEvent(runId, { type: "reproduction.proposal_received", data: { testFiles: proposal.testFiles } });

  const base: ReproductionResult = { outcome: "INVALID_REPRODUCTION", testFiles: proposal.testFiles, expectedFailure: proposal.expectedFailure };
  const reject = (reason: string, extra: Partial<ReproductionResult> = {}) =>
    finish("UNVERIFIED", {
      failure: pbError("REPRO_INVALID", "The generated regression test is not a valid reproduction.", { detail: reason, recoverable: true }),
      reproduction: { ...base, ...extra, reasonCode: "REPRO_INVALID", reason },
    });

  const validated = await validateChangedFiles(wsGit, input.workspace, proposal, policy.excludePaths);
  if (!validated.ok) return reject(validated.error);
  const patch = buildNewFilesPatch(validated.value.files);
  if (!patch.ok) return reject(patch.error);
  if (signal?.aborted) return cancelled();

  // Only the policy-owned command runs; proposal.command is informational.
  const command = { command: policy.regressionCommand.command, args: [...policy.regressionCommand.args, ...proposal.testFiles] };
  const executed = await runCommand(
    { ...command, cwd: input.workspace, timeoutMs: policy.commandTimeoutMs, env: buildCommandEnv(policy.envAllowList) },
    { allowedRoots: [input.workspace], maxOutputBytes: policy.maxOutputBytes, signal },
  );
  if (!executed.ok) return executed.error.code === "COMMAND_CANCELLED" ? cancelled() : failed(executed.error);
  commandsExecuted++;
  const res = executed.value;
  const logPath = path.join(dir, "logs", "baseline.log");
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(
    logPath,
    `$ ${[command.command, ...command.args].join(" ")}\n# exit=${res.exitCode} signal=${res.signal} timedOut=${res.timedOut} durationMs=${res.durationMs}\n--- stdout${res.stdoutTruncated ? " (truncated)" : ""} ---\n${res.stdout}\n--- stderr${res.stderrTruncated ? " (truncated)" : ""} ---\n${res.stderr}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  if (res.cancelled) return cancelled();

  const report = parseNodeTap(res.stdout);
  const verdict = classifyReproduction({ process: res, report, testFiles: proposal.testFiles, expectedFailure: proposal.expectedFailure });
  await store.appendEvent(runId, {
    type: "reproduction.command.completed",
    data: { exitCode: res.exitCode, timedOut: res.timedOut, durationMs: res.durationMs, tests: report.tests, fail: report.fail, failingTests: verdict.failingTests },
  });

  const baselineCheck: CheckResult = {
    name: "regression",
    passed: res.exitCode === 0 && !res.timedOut,
    exitCode: res.exitCode,
    durationMs: res.durationMs,
    timedOut: res.timedOut,
    failures: verdict.failingTests,
    logPath: path.relative(store.runDir(runId), logPath),
  };
  const withCheck = { command, baselineCheck };

  if (verdict.outcome === "NOT_REPRODUCED") {
    return finish("UNVERIFIED", {
      failure: pbError("REPRO_NOT_CONFIRMED", "The regression test passes on the untouched baseline; the bug was not reproduced.", { recoverable: true }),
      reproduction: { ...base, ...withCheck, outcome: "NOT_REPRODUCED", reasonCode: verdict.code, reason: verdict.reason },
    });
  }
  if (verdict.outcome === "INVALID_REPRODUCTION") return reject(verdict.reason, withCheck);

  // Confirm the primary worktree before freezing anything.
  const primaryNow = await readPrimary(primaryGit, input.primaryRoot);
  if (!primaryNow.ok || JSON.stringify(primaryNow.value) !== JSON.stringify(guard.primaryBefore)) return finish("FAILED", {});

  const frozen = await writeFrozenArtifact(store, runId, patch.value);
  if (!frozen.ok) return failed(frozen.error);
  await store.appendEvent(runId, {
    type: "reproduction.frozen",
    data: { sha256: frozen.value.patchSha256, bytes: Buffer.byteLength(patch.value), files: validated.value.frozen },
  });
  return finish("STRATEGIZING", {
    reproduction: {
      ...base,
      ...withCheck,
      outcome: "REPRODUCED",
      frozenPatchSha256: frozen.value.patchSha256,
      frozenFiles: validated.value.frozen,
    },
  });
}
