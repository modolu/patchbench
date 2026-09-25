import { execFileSync } from "node:child_process";

/**
 * Test-only Git helper. Identity is passed per-command with -c so tests never
 * read or write the developer's global Git configuration.
 */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=PatchBench Test", "-c", "user.email=test@patchbench.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args],
    { cwd, encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1", HOME: cwd } },
  ).trim();
}
