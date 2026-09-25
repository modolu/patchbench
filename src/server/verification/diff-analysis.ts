import type { DiffSummary } from "@/domain/evidence";
import type { NumstatEntry } from "../git/git-adapter";

const DEPENDENCY_MANIFESTS = /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|npm-shrinkwrap\.json)$/;
const CONFIG_FILES = /(?:^|\/)(?:tsconfig[^/]*\.json|[^/]+\.config\.[cm]?[jt]s|\.eslintrc[^/]*|\.npmrc|\.nvmrc|\.env[^/]*)$/;

/**
 * Deterministic diff evidence (architecture §15). Frozen regression paths are
 * injected by PatchBench, not written by the candidate, so they are excluded
 * from the implementation metrics; the Git worktree still holds the full diff.
 */
export function summarizeDiff(entries: readonly NumstatEntry[], frozenPaths: readonly string[] = []): DiffSummary {
  const frozen = new Set(frozenPaths);
  const files = entries.filter((e) => !frozen.has(e.path)).sort((a, b) => a.path.localeCompare(b.path));
  return {
    filesChanged: files.length,
    insertions: files.reduce((n, f) => n + (f.insertions ?? 0), 0),
    deletions: files.reduce((n, f) => n + (f.deletions ?? 0), 0),
    files: files.map((f) => ({ path: f.path, insertions: f.insertions, deletions: f.deletions })),
    dependencyManifestChanged: files.some((f) => DEPENDENCY_MANIFESTS.test(f.path)),
    configFilesTouched: files.filter((f) => CONFIG_FILES.test(f.path)).map((f) => f.path),
  };
}
