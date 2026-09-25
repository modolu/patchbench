import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { git } from "./git";
import { copyFixture } from "./scenario";

/** Fixture (plus optional extra files) copied into `<dir>/primary` and committed as the baseline. */
export async function makeBaselineRepo(dir: string, extraFiles: Record<string, string> = {}): Promise<{ primary: string; sha: string }> {
  const primary = await copyFixture(path.join(dir, "primary"));
  for (const [rel, content] of Object.entries(extraFiles)) await writeFile(path.join(primary, rel), content);
  git(primary, "init", "-q");
  git(primary, "add", "-A");
  git(primary, "commit", "-q", "-m", "baseline");
  return { primary, sha: git(primary, "rev-parse", "HEAD") };
}

/** Test-only detached worktree at `sha` (mirrors a PatchBench-owned workspace). */
export function addDetachedWorktree(primary: string, dest: string, sha: string): string {
  git(primary, "worktree", "add", "-q", "--detach", dest, sha);
  return dest;
}

/** Content hash of every file outside .git, for byte-level "untouched" checks. */
export async function treeFingerprint(root: string, rel = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(path.join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.name === ".git") continue;
    if (entry.isDirectory()) Object.assign(out, await treeFingerprint(root, p));
    else out[p] = createHash("sha256").update(await readFile(path.join(root, p))).digest("hex");
  }
  return out;
}
