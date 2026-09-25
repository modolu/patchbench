import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitAdapter, parseNumstat } from "@/server/git/git-adapter";
import { captureRepositorySnapshot } from "@/server/runs/repository-snapshot";
import { makeTempDir } from "../helpers/factories";
import { git } from "../helpers/git";

let tmp: Awaited<ReturnType<typeof makeTempDir>>;
let repo: string;
let adapter: GitAdapter;

beforeEach(async () => {
  tmp = await makeTempDir();
  repo = path.join(tmp.dir, "repo");
  await mkdir(repo);
  git(repo, "init", "-q");
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ packageManager: "pnpm@11.0.0", scripts: { test: "node --test", build: "tsc", dev: "x" } }));
  await writeFile(path.join(repo, "a.txt"), "one\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "baseline");
  adapter = new GitAdapter({ allowedRoots: [tmp.dir] });
});
afterEach(() => tmp.cleanup());

describe("GitAdapter", () => {
  it("detects repositories and non-repositories", async () => {
    expect(await adapter.isRepository(repo)).toBe(true);
    const plain = path.join(tmp.dir, "plain");
    await mkdir(plain);
    expect(await adapter.isRepository(plain)).toBe(false);
    const root = await adapter.root(plain);
    expect(root.ok || root.error.code).toBe("REPO_NOT_GIT");
  });

  it("reads branch, SHA and dirty state", async () => {
    expect(await adapter.currentBranch(repo)).toEqual({ ok: true, value: "main" });
    expect(await adapter.currentSha(repo)).toEqual({ ok: true, value: git(repo, "rev-parse", "HEAD") });
    expect(await adapter.isDirty(repo)).toEqual({ ok: true, value: false });
    await writeFile(path.join(repo, "untracked.txt"), "x");
    expect(await adapter.isDirty(repo)).toEqual({ ok: true, value: true });
  });

  it("reports a detached HEAD as null branch", async () => {
    git(repo, "checkout", "-q", "--detach");
    expect(await adapter.currentBranch(repo)).toEqual({ ok: true, value: null });
  });

  it("computes numstat against the baseline for working-tree and committed changes", async () => {
    const base = git(repo, "rev-parse", "HEAD");
    await writeFile(path.join(repo, "a.txt"), "one\ntwo\nthree\n");
    expect(await adapter.diffNumstat(repo, base)).toEqual({ ok: true, value: [{ path: "a.txt", insertions: 2, deletions: 0 }] });
    git(repo, "commit", "-qam", "change");
    expect(await adapter.diffNumstat(repo, base, "HEAD")).toEqual({ ok: true, value: [{ path: "a.txt", insertions: 2, deletions: 0 }] });
  });

  it("rejects a non-SHA diff base (no ref injection)", async () => {
    const r = await adapter.diffNumstat(repo, "--output=/tmp/x");
    expect(r.ok).toBe(false);
  });

  it("refuses repositories outside allowed roots", async () => {
    const narrow = new GitAdapter({ allowedRoots: [path.join(tmp.dir, "elsewhere")] });
    expect(await narrow.isRepository(repo)).toBe(false);
  });

  it("does not mutate the repository", async () => {
    const before = git(repo, "status", "--porcelain=v2", "--branch");
    await adapter.currentBranch(repo);
    await adapter.isDirty(repo);
    await adapter.diffNumstat(repo, git(repo, "rev-parse", "HEAD"));
    expect(git(repo, "status", "--porcelain=v2", "--branch")).toBe(before);
  });
});

describe("captureRepositorySnapshot", () => {
  it("records SHA, branch, package manager and only existing verification scripts", async () => {
    const snap = await captureRepositorySnapshot(adapter, repo);
    expect(snap).toEqual({
      ok: true,
      value: {
        root: repo,
        branch: "main",
        commitSha: git(repo, "rev-parse", "HEAD"),
        isDirty: false,
        packageManager: "pnpm",
        detectedScripts: { test: "node --test", build: "tsc" },
      },
    });
  });
});

describe("parseNumstat", () => {
  it("handles binary files", () => {
    expect(parseNumstat("-\t-\timg.png\n3\t1\tsrc/a.ts\n")).toEqual([
      { path: "img.png", insertions: null, deletions: null },
      { path: "src/a.ts", insertions: 3, deletions: 1 },
    ]);
  });
});
