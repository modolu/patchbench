import { pbError, type PatchBenchError } from "@/domain/errors";
import { DEFAULT_ENV_ALLOW_LIST } from "@/domain/policy";
import { err, ok, type Result } from "@/lib/result";
import { buildCommandEnv, runCommand, type CommandResult } from "../runner/command-runner";

export interface NumstatEntry {
  path: string;
  /** null for binary files. */
  insertions: number | null;
  deletions: number | null;
}

export interface GitAdapterOptions {
  /** Every Git cwd must resolve beneath one of these. */
  allowedRoots: readonly string[];
  timeoutMs?: number;
}

const SHA = /^[0-9a-f]{40}$/;

export function parseNumstat(output: string): NumstatEntry[] {
  return output
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [ins = "-", del = "-", ...rest] = line.split("\t");
      return {
        path: rest.join("\t"),
        insertions: ins === "-" ? null : Number(ins),
        deletions: del === "-" ? null : Number(del),
      };
    });
}

/**
 * Typed wrapper over native `git`. Read-only/basic operations only here;
 * worktree lifecycle lives behind `WorktreeManager` (worktrees.ts).
 * Never modifies Git config, resets, merges, or pushes.
 */
export class GitAdapter {
  private readonly env = buildCommandEnv(DEFAULT_ENV_ALLOW_LIST, {
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
  });

  constructor(private readonly opts: GitAdapterOptions) {}

  private async git(cwd: string, args: string[]): Promise<Result<CommandResult, PatchBenchError>> {
    return runCommand(
      { command: "git", args, cwd, timeoutMs: this.opts.timeoutMs ?? 15_000, env: this.env },
      { allowedRoots: this.opts.allowedRoots },
    );
  }

  private async gitOk(cwd: string, args: string[]): Promise<Result<string, PatchBenchError>> {
    const r = await this.git(cwd, args);
    if (!r.ok) return r;
    if (r.value.exitCode !== 0) {
      return err(pbError("COMMAND_FAILED", `git ${args[0]} failed.`, { detail: r.value.stderr.trim() }));
    }
    return ok(r.value.stdout);
  }

  async isRepository(cwd: string): Promise<boolean> {
    const r = await this.git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return r.ok && r.value.exitCode === 0 && r.value.stdout.trim() === "true";
  }

  async root(cwd: string): Promise<Result<string, PatchBenchError>> {
    if (!(await this.isRepository(cwd))) {
      return err(pbError("REPO_NOT_GIT", "The selected folder is not a Git repository.", { detail: cwd, nextAction: "Choose a Git repository root." }));
    }
    const r = await this.gitOk(cwd, ["rev-parse", "--show-toplevel"]);
    return r.ok ? ok(r.value.trim()) : r;
  }

  /** Branch name, or null when HEAD is detached. */
  async currentBranch(cwd: string): Promise<Result<string | null, PatchBenchError>> {
    const r = await this.git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
    if (!r.ok) return r;
    if (r.value.exitCode === 0) return ok(r.value.stdout.trim());
    if (r.value.exitCode === 1) return ok(null);
    return err(pbError("COMMAND_FAILED", "Could not read current branch.", { detail: r.value.stderr.trim() }));
  }

  async currentSha(cwd: string): Promise<Result<string, PatchBenchError>> {
    const r = await this.gitOk(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!r.ok) return err(pbError("REPO_NOT_GIT", "Repository has no commits yet.", { detail: r.error.detail, nextAction: "Commit a baseline first." }));
    const sha = r.value.trim();
    return SHA.test(sha) ? ok(sha) : err(pbError("COMMAND_FAILED", "Unexpected SHA format.", { detail: sha }));
  }

  /** Tracked modifications or untracked (non-ignored) files. */
  async isDirty(cwd: string): Promise<Result<boolean, PatchBenchError>> {
    const r = await this.gitOk(cwd, ["status", "--porcelain", "--untracked-files=normal"]);
    return r.ok ? ok(r.value.trim().length > 0) : r;
  }

  /**
   * Per-file line counts. With `head`, compares `base...head` (commits);
   * without, compares `base` to the working tree (tracked files).
   */
  async diffNumstat(cwd: string, base: string, head?: string): Promise<Result<NumstatEntry[], PatchBenchError>> {
    if (!SHA.test(base)) return err(pbError("COMMAND_FAILED", "Diff base must be a full commit SHA."));
    const range = head ? [`${base}...${head}`] : [base];
    const r = await this.gitOk(cwd, ["diff", "--numstat", "--no-renames", ...range, "--"]);
    return r.ok ? ok(parseNumstat(r.value)) : r;
  }
}
