import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pbError, type ErrorCode, type PatchBenchError } from "@/domain/errors";
import { assertSafeId, isSafeId } from "@/lib/ids";
import { resolveWithinRoots } from "@/lib/paths";
import { err, ok, type Result } from "@/lib/result";
import { runCommand, type CommandResult } from "../runner/command-runner";
import { gitEnv } from "./git-adapter";

/**
 * Candidate worktree lifecycle (architecture §10): one native Git worktree per
 * candidate under `<runtime>/worktrees/<run-id>/<candidate-id>` on branch
 * `patchbench/<run-id>/<candidate-id>`, plus a detached, branchless
 * reproduction workspace at `<runtime>/worktrees/<run-id>/reproduction`.
 */
export interface CandidateWorktree {
  runId: string;
  candidateId: string;
  path: string;
  branchName: string;
  baseSha: string;
}

export interface ReproductionWorkspace {
  runId: string;
  path: string;
  baseSha: string;
}

export interface WorktreeManager {
  /** `git worktree add -b patchbench/<run>/<cand> <path> <baseSha>`. */
  create(input: { repoRoot: string; runId: string; candidateId: string; baseSha: string }): Promise<
    Result<CandidateWorktree, PatchBenchError>
  >;
  /** Removes the worktree and its PatchBench branch only. */
  remove(worktree: CandidateWorktree, repoRoot: string): Promise<Result<void, PatchBenchError>>;
  list(repoRoot: string, runId: string): Promise<Result<CandidateWorktree[], PatchBenchError>>;
  /** `git worktree add --detach <runtime>/worktrees/<run>/reproduction <baseSha>`. */
  createReproduction(input: { repoRoot: string; runId: string; baseSha: string }): Promise<Result<ReproductionWorkspace, PatchBenchError>>;
  removeReproduction(workspace: ReproductionWorkspace, repoRoot: string): Promise<Result<void, PatchBenchError>>;
}

/** Reserved directory name; never usable as a candidate id. */
export const REPRODUCTION_WORKSPACE_ID = "reproduction";

const BRANCH_PREFIX = "patchbench/";

export function candidateBranchName(runId: string, candidateId: string): string {
  if (candidateId === REPRODUCTION_WORKSPACE_ID) throw new Error(`Reserved candidate id: ${candidateId}`);
  return `${BRANCH_PREFIX}${assertSafeId(runId, "run id")}/${assertSafeId(candidateId, "candidate id")}`;
}

export function candidateWorktreePath(runtimeRoot: string, runId: string, candidateId: string): string {
  return path.join(path.resolve(runtimeRoot), "worktrees", assertSafeId(runId, "run id"), assertSafeId(candidateId, "candidate id"));
}

/** Guard for any branch deletion: only branches PatchBench itself created. */
export function isPatchBenchBranch(name: string): boolean {
  const parts = name.split("/");
  return parts.length === 3 && parts[0] === "patchbench" && name === candidateBranchNameSafe(parts[1], parts[2]);
}

function candidateBranchNameSafe(runId = "", candidateId = ""): string | null {
  try {
    return candidateBranchName(runId, candidateId);
  } catch {
    return null;
  }
}

export function reproductionWorkspacePath(runtimeRoot: string, runId: string): string {
  return path.join(path.resolve(runtimeRoot), "worktrees", assertSafeId(runId, "run id"), REPRODUCTION_WORKSPACE_ID);
}

const SHA = /^[0-9a-f]{40}$/;

const exists = (p: string) => lstat(p).then(() => true, () => false);

/**
 * Native-Git implementation. Only ever adds/removes worktrees beneath
 * `<runtime>/worktrees/` and creates/deletes `patchbench/<run>/<cand>`
 * branches; never touches the primary worktree's HEAD, index or files.
 * Worktrees are preserved until PatchBench explicitly removes them.
 */
export class GitWorktreeManager implements WorktreeManager {
  private readonly worktreesRoot: string;

  constructor(
    private readonly runtimeRoot: string,
    private readonly opts: { timeoutMs?: number } = {},
  ) {
    this.worktreesRoot = path.join(path.resolve(runtimeRoot), "worktrees");
  }

  private git(repoRoot: string, args: string[]): Promise<Result<CommandResult, PatchBenchError>> {
    return runCommand(
      { command: "git", args, cwd: repoRoot, timeoutMs: this.opts.timeoutMs ?? 30_000, env: gitEnv() },
      { allowedRoots: [repoRoot, this.worktreesRoot] },
    );
  }

  private async gitOk(repoRoot: string, args: string[], code: ErrorCode, message: string): Promise<Result<string, PatchBenchError>> {
    const r = await this.git(repoRoot, args);
    if (!r.ok) return err(pbError(code, message, { detail: r.error.detail ?? r.error.message }));
    if (r.value.exitCode !== 0) return err(pbError(code, message, { detail: `git ${args.join(" ")}: ${r.value.stderr.trim()}` }));
    return ok(r.value.stdout);
  }

  /** Target must resolve beneath the worktrees root (no symlink escape) and not exist yet. */
  private async prepareTarget(target: string): Promise<Result<void, PatchBenchError>> {
    await mkdir(path.dirname(target), { recursive: true });
    if (!(await resolveWithinRoots(target, [this.worktreesRoot]))) {
      return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Worktree path escapes the PatchBench runtime directory.", { detail: target }));
    }
    if (await exists(target)) return err(pbError("WORKTREE_CREATE_FAILED", "Worktree path already exists.", { detail: target }));
    return ok(undefined);
  }

  private async verifyHead(repoRoot: string, target: string, baseSha: string): Promise<Result<void, PatchBenchError>> {
    const head = await runCommand(
      { command: "git", args: ["rev-parse", "HEAD"], cwd: target, timeoutMs: this.opts.timeoutMs ?? 30_000, env: gitEnv() },
      { allowedRoots: [this.worktreesRoot] },
    );
    const sha = head.ok ? head.value.stdout.trim() : "";
    if (sha !== baseSha) {
      return err(pbError("WORKTREE_CREATE_FAILED", "Worktree does not start at the baseline commit.", { detail: `expected ${baseSha}, got ${sha || "?"}`, nextAction: `Inspect with: git -C ${repoRoot} worktree list` }));
    }
    return ok(undefined);
  }

  async create(input: { repoRoot: string; runId: string; candidateId: string; baseSha: string }): Promise<Result<CandidateWorktree, PatchBenchError>> {
    const { repoRoot, runId, candidateId, baseSha } = input;
    if (!isSafeId(runId) || !isSafeId(candidateId) || candidateId === REPRODUCTION_WORKSPACE_ID) {
      return err(pbError("WORKTREE_CREATE_FAILED", "Unsafe or reserved run/candidate id.", { detail: `${runId}/${candidateId}` }));
    }
    if (!SHA.test(baseSha)) return err(pbError("WORKTREE_CREATE_FAILED", "Baseline must be a full commit SHA."));
    const target = candidateWorktreePath(this.runtimeRoot, runId, candidateId);
    const branchName = candidateBranchName(runId, candidateId);
    const prepared = await this.prepareTarget(target);
    if (!prepared.ok) return prepared;
    const branchExists = await this.git(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`]);
    if (!branchExists.ok) return err(pbError("WORKTREE_CREATE_FAILED", "Could not inspect branches.", { detail: branchExists.error.detail }));
    if (branchExists.value.exitCode === 0) return err(pbError("WORKTREE_CREATE_FAILED", "Candidate branch already exists.", { detail: branchName }));
    const added = await this.gitOk(repoRoot, ["worktree", "add", "-b", branchName, target, baseSha], "WORKTREE_CREATE_FAILED", "Could not create candidate worktree.");
    if (!added.ok) return added;
    const head = await this.verifyHead(repoRoot, target, baseSha);
    if (!head.ok) return head;
    return ok({ runId, candidateId, path: target, branchName, baseSha });
  }

  async createReproduction(input: { repoRoot: string; runId: string; baseSha: string }): Promise<Result<ReproductionWorkspace, PatchBenchError>> {
    const { repoRoot, runId, baseSha } = input;
    if (!isSafeId(runId)) return err(pbError("WORKTREE_CREATE_FAILED", "Unsafe run id.", { detail: runId }));
    if (!SHA.test(baseSha)) return err(pbError("WORKTREE_CREATE_FAILED", "Baseline must be a full commit SHA."));
    const target = reproductionWorkspacePath(this.runtimeRoot, runId);
    const prepared = await this.prepareTarget(target);
    if (!prepared.ok) return prepared;
    const added = await this.gitOk(repoRoot, ["worktree", "add", "--detach", target, baseSha], "WORKTREE_CREATE_FAILED", "Could not create reproduction workspace.");
    if (!added.ok) return added;
    const head = await this.verifyHead(repoRoot, target, baseSha);
    if (!head.ok) return head;
    return ok({ runId, path: target, baseSha });
  }

  /** Removes the worktree (discarding its changes) and its PatchBench branch only. */
  async remove(worktree: CandidateWorktree, repoRoot: string): Promise<Result<void, PatchBenchError>> {
    let expectedPath: string;
    let expectedBranch: string;
    try {
      expectedPath = candidateWorktreePath(this.runtimeRoot, worktree.runId, worktree.candidateId);
      expectedBranch = candidateBranchName(worktree.runId, worktree.candidateId);
    } catch (cause) {
      return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Refusing to remove a non-PatchBench worktree.", { detail: String(cause) }));
    }
    if (path.resolve(worktree.path) !== expectedPath || worktree.branchName !== expectedBranch || !isPatchBenchBranch(worktree.branchName)) {
      return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Refusing to remove a non-PatchBench worktree or branch.", { detail: `${worktree.path} ${worktree.branchName}` }));
    }
    const removed = await this.removeWorktree(repoRoot, expectedPath);
    if (!removed.ok) return removed;
    const deleted = await this.gitOk(repoRoot, ["branch", "-D", "--", expectedBranch], "COMMAND_FAILED", "Worktree removed, but its branch could not be deleted.");
    return deleted.ok ? ok(undefined) : deleted;
  }

  async removeReproduction(workspace: ReproductionWorkspace, repoRoot: string): Promise<Result<void, PatchBenchError>> {
    let expectedPath: string;
    try {
      expectedPath = reproductionWorkspacePath(this.runtimeRoot, workspace.runId);
    } catch (cause) {
      return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Refusing to remove a non-PatchBench workspace.", { detail: String(cause) }));
    }
    if (path.resolve(workspace.path) !== expectedPath) {
      return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Refusing to remove a non-PatchBench workspace.", { detail: workspace.path }));
    }
    return this.removeWorktree(repoRoot, expectedPath);
  }

  private async removeWorktree(repoRoot: string, target: string): Promise<Result<void, PatchBenchError>> {
    if (!(await resolveWithinRoots(target, [this.worktreesRoot]))) {
      return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Worktree path escapes the PatchBench runtime directory.", { detail: target }));
    }
    const r = await this.gitOk(repoRoot, ["worktree", "remove", "--force", target], "COMMAND_FAILED", "Could not remove PatchBench worktree.");
    if (!r.ok) return err({ ...r.error, nextAction: `Inspect with: git -C ${repoRoot} worktree list --porcelain` });
    return ok(undefined);
  }

  /** Candidate worktrees of one run, as reported by `git worktree list --porcelain`. */
  async list(repoRoot: string, runId: string): Promise<Result<CandidateWorktree[], PatchBenchError>> {
    if (!isSafeId(runId)) return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Unsafe run id.", { detail: runId }));
    const out = await this.gitOk(repoRoot, ["worktree", "list", "--porcelain"], "COMMAND_FAILED", "Could not list worktrees.");
    if (!out.ok) return out;
    const runDir = path.join(await realpath(this.worktreesRoot).catch(() => this.worktreesRoot), runId);
    const result: CandidateWorktree[] = [];
    for (const block of out.value.split(/\n\n+/)) {
      const fields = new Map(block.split("\n").filter(Boolean).map((l) => [l.split(" ")[0]!, l.slice(l.indexOf(" ") + 1)]));
      const wtPath = fields.get("worktree");
      const branch = fields.get("branch")?.replace(/^refs\/heads\//, "");
      const head = fields.get("HEAD");
      if (!wtPath || !branch || !head || path.dirname(wtPath) !== runDir) continue;
      const candidateId = path.basename(wtPath);
      if (!isSafeId(candidateId) || candidateId === REPRODUCTION_WORKSPACE_ID || branch !== candidateBranchName(runId, candidateId)) continue;
      result.push({ runId, candidateId, path: wtPath, branchName: branch, baseSha: head });
    }
    return ok(result.sort((a, b) => a.candidateId.localeCompare(b.candidateId)));
  }
}
