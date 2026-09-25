/**
 * Materialises fixtures/auth-expiry-bug as a standalone Git repository at
 * .patchbench/fixture-repos/auth-expiry-bug with a deterministic baseline SHA.
 *
 *   node scripts/prepare-fixture.mts
 *
 * Identity and dates are passed per-command; global Git config is never touched.
 * Only the target directory inside .patchbench/ is replaced.
 */
import { execFileSync } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "fixtures", "auth-expiry-bug");
const target = path.join(root, ".patchbench", "fixture-repos", "auth-expiry-bug");

const FIXED_DATE = "2026-09-25T00:00:00Z";
const env = {
  NODE_ENV: "production" as const,
  PATH: process.env.PATH ?? "",
  HOME: target,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_DATE: FIXED_DATE,
  GIT_COMMITTER_DATE: FIXED_DATE,
};
const git = (...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.name=Shipyard Fixture", "-c", "user.email=fixture@patchbench.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", "-c", "core.autocrlf=false", ...args],
    { cwd: target, env, encoding: "utf8" },
  ).trim();

await rm(target, { recursive: true, force: true });
await cp(source, target, {
  recursive: true,
  filter: (src) => !/[\\/](node_modules|dist)$/.test(src),
});
git("init", "-q");
git("add", "-A");
git("commit", "-q", "-m", "auth-expiry-bug fixture baseline");
console.log(`fixture repo: ${target}`);
console.log(`baseline sha: ${git("rev-parse", "HEAD")}`);
