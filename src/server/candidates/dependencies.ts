import { constants } from "node:fs";
import { cp, lstat, stat } from "node:fs/promises";
import path from "node:path";
import { pbError, type PatchBenchError } from "@/domain/errors";
import { resolveWithinRoots } from "@/lib/paths";
import { err, ok, type Result } from "@/lib/result";

/**
 * Gives a fresh worktree its own copy of an already-installed `node_modules`
 * (copy-on-write clone where the filesystem supports it). A copy, not a
 * symlink, so candidates cannot mutate shared or primary dependencies, and a
 * `node_modules/` ignore rule still matches. No install, no network.
 */
export async function provisionNodeModules(worktree: string, source: string): Promise<Result<void, PatchBenchError>> {
  if (path.basename(source) !== "node_modules") return err(pbError("COMMAND_FAILED", "Dependency source must be a node_modules directory.", { detail: source }));
  try {
    if (!(await stat(source)).isDirectory()) throw new Error("not a directory");
  } catch {
    return err(pbError("COMMAND_FAILED", "Dependency source does not exist.", { detail: source }));
  }
  const target = path.join(worktree, "node_modules");
  if (!(await resolveWithinRoots(target, [worktree]))) return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Dependency target escapes the worktree.", { detail: target }));
  if (await lstat(target).then(() => true, () => false)) return err(pbError("COMMAND_FAILED", "Worktree already has node_modules.", { detail: target }));
  await cp(source, target, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false, mode: constants.COPYFILE_FICLONE });
  return ok(undefined);
}
