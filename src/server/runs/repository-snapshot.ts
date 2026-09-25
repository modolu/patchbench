import { pbError, type PatchBenchError } from "@/domain/errors";
import type { RepositorySnapshot } from "@/domain/run";
import { err, ok, type Result } from "@/lib/result";
import type { GitAdapter } from "../git/git-adapter";
import { detectScripts } from "../runner/script-detector";

/** Captures the baseline facts recorded before any generated code exists. */
export async function captureRepositorySnapshot(git: GitAdapter, repoPath: string): Promise<Result<RepositorySnapshot, PatchBenchError>> {
  const root = await git.root(repoPath);
  if (!root.ok) return root;
  const [branch, sha, dirty, scripts] = await Promise.all([
    git.currentBranch(root.value),
    git.currentSha(root.value),
    git.isDirty(root.value),
    detectScripts(root.value),
  ]);
  if (!branch.ok) return branch;
  if (!sha.ok) return sha;
  if (!dirty.ok) return dirty;
  if (!scripts) {
    return err(pbError("SCRIPT_NOT_FOUND", "No readable package.json at the repository root.", { nextAction: "Select a Node.js/TypeScript repository." }));
  }
  return ok({
    root: root.value,
    branch: branch.value,
    commitSha: sha.value,
    isDirty: dirty.value,
    packageManager: scripts.packageManager,
    detectedScripts: scripts.detectedScripts,
  });
}
