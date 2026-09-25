import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pbError, type PatchBenchError } from "@/domain/errors";
import type { PatchBenchRun } from "@/domain/run";
import { err, type Result } from "@/lib/result";
import type { ImplementationInput } from "@/server/bob/adapter";
import { FakeBobAdapter } from "@/server/bob/fake-adapter";
import type { ImplementationResult } from "@/server/bob/schemas";
import { GitWorktreeManager, reproductionWorkspacePath } from "@/server/git/worktrees";
import { buildCommandEnv, runCommand } from "@/server/runner/command-runner";
import { sha256 } from "@/server/reproduction/regression-artifact";
import { runDeterministicPipeline } from "@/server/runs/orchestrator";
import { FileRunStore } from "@/server/runs/store";
import { makeBaselineRepo, treeFingerprint } from "../helpers/baseline-repo";
import { makeRun, makeTempDir } from "../helpers/factories";
import { git } from "../helpers/git";
import { FAKE_SCENARIO_DIR, FIXTURE_DIR, REPO_ROOT } from "../helpers/scenario";

const RUN = "run-20260925120000-abc123";
const TEST_FILE = "test/refresh-expired.test.ts";
const FIXTURE_NODE_MODULES = path.join(FIXTURE_DIR, "node_modules");
const hasFixtureDeps = await access(path.join(FIXTURE_NODE_MODULES, "typescript")).then(() => true, () => false);

let tmp: Awaited<ReturnType<typeof makeTempDir>>;
let primary: string;
let sha: string;
let runtime: string;
let store: FileRunStore;
let worktrees: GitWorktreeManager;

beforeEach(async () => {
  tmp = await makeTempDir();
  ({ primary, sha } = await makeBaselineRepo(tmp.dir));
  runtime = path.join(tmp.dir, ".patchbench");
  store = new FileRunStore(runtime);
  worktrees = new GitWorktreeManager(runtime);
  const base = makeRun();
  const created = await store.createRun(makeRun({ repository: { ...base.repository, root: primary, commitSha: sha } }));
  if (!created.ok) throw new Error(created.error.message);
});
afterEach(() => tmp.cleanup());

async function pipeline(bob: FakeBobAdapter, dependencySource?: string): Promise<PatchBenchRun> {
  const r = await runDeterministicPipeline({ store, bob, worktrees }, { runId: RUN, dependencySource });
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message} ${r.error.detail ?? ""}`);
  return r.value;
}

const frozenHash = async () => sha256(await readFile(path.join(FAKE_SCENARIO_DIR, "files", "reproduction", TEST_FILE)));

/** FakeBobAdapter whose candidates misbehave on purpose. */
class CheatingBob extends FakeBobAdapter {
  constructor(private readonly behaviour: Record<string, "overwrite" | "adapter-refused">) {
    super(FAKE_SCENARIO_DIR);
  }
  override async implementStrategy(input: ImplementationInput): Promise<Result<ImplementationResult, PatchBenchError>> {
    const b = this.behaviour[input.candidateId];
    if (b === "adapter-refused") return err(pbError("REGRESSION_TEST_MUTATED", "Candidate attempted to modify the frozen regression test.", { detail: TEST_FILE }));
    const r = await super.implementStrategy(input);
    if (b === "overwrite") {
      // Weakens the benchmark directly on disk, bypassing the adapter's own guard.
      const target = path.join(input.workspace, TEST_FILE);
      await writeFile(target, (await readFile(target, "utf8")).replace("assert.equal(res.status, 401", "assert.ok(res.status"));
    }
    return r;
  }
}

describe("deterministic pipeline", () => {
  it("baseline → reproduce → freeze → strategies → isolated candidates → integrity check", async () => {
    const before = await treeFingerprint(primary);
    const run = await pipeline(new FakeBobAdapter(FAKE_SCENARIO_DIR));

    expect(run.status).toBe("VERIFYING");
    expect(run.reproduction?.outcome).toBe("REPRODUCED");
    expect(run.strategies.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(run.candidates.map((c) => [c.id, c.status])).toEqual([["a", "VERIFYING"], ["b", "VERIFYING"], ["c", "VERIFYING"]]);

    const expectedHash = await frozenHash();
    for (const c of run.candidates) {
      expect(c.branchName).toBe(`patchbench/${RUN}/${c.id}`);
      expect(git(c.worktreePath, "rev-parse", "HEAD")).toBe(sha);
      expect(sha256(await readFile(path.join(c.worktreePath, TEST_FILE)))).toBe(expectedHash);
      // Frozen test is excluded from implementation metrics but still present in Git's view.
      expect(c.diff?.files.map((f) => f.path)).not.toContain(TEST_FILE);
      expect(git(c.worktreePath, "status", "--porcelain")).toContain(TEST_FILE);
    }
    expect(run.candidates.map((c) => c.diff?.files.map((f) => f.path))).toEqual([["src/http-errors.ts"], ["src/app.ts"], ["src/app.ts"]]);

    // Isolation: candidate a never sees b/c's change to src/app.ts.
    expect(await readFile(path.join(run.candidates[0]!.worktreePath, "src/app.ts"), "utf8")).toBe(await readFile(path.join(primary, "src/app.ts"), "utf8"));

    // The reproduction workspace is detached and preserved for inspection.
    expect(git(reproductionWorkspacePath(runtime, RUN), "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");

    // The frozen regression now passes in candidate a (it fixes the bug).
    const res = await runCommand(
      { command: "node", args: ["--test", "--test-reporter=tap", TEST_FILE], cwd: run.candidates[0]!.worktreePath, timeoutMs: 30_000, env: buildCommandEnv(["PATH", "HOME"]) },
      { allowedRoots: [runtime] },
    );
    expect(res.ok && res.value.exitCode).toBe(0);

    expect(git(primary, "rev-parse", "HEAD")).toBe(sha);
    expect(git(primary, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(primary, "status", "--porcelain")).toBe("");
    expect(await treeFingerprint(primary)).toEqual(before);

    const types = (await store.readEvents(RUN)).map((e) => e.type);
    expect(types.filter((t) => t === "candidate.regression_injected")).toHaveLength(3);
    expect(types.filter((t) => t === "candidate.regression_verified")).toHaveLength(3);
    expect(types.indexOf("reproduction.frozen")).toBeLessThan(types.indexOf("strategies.generated"));
    expect(types.indexOf("strategies.generated")).toBeLessThan(types.indexOf("candidate.created"));
  });

  it("rejects only the candidates that mutate the frozen regression", async () => {
    const run = await pipeline(new CheatingBob({ b: "overwrite", c: "adapter-refused" }));
    expect(run.status).toBe("VERIFYING");
    expect(run.candidates.map((c) => [c.id, c.status, c.failure?.code])).toEqual([
      ["a", "VERIFYING", undefined],
      ["b", "REJECTED", "REGRESSION_TEST_MUTATED"],
      ["c", "REJECTED", "REGRESSION_TEST_MUTATED"],
    ]);
    expect(JSON.parse(run.candidates[1]!.failure!.detail!)).toEqual([{ path: TEST_FILE, kind: "modified" }]);
    const events = await store.readEvents(RUN);
    expect(events.filter((e) => e.type === "candidate.regression_mutated").map((e) => e.candidateId)).toEqual(["b", "c"]);
  });

  it("stops at UNVERIFIED without creating candidate worktrees when the bug is not reproduced", async () => {
    const run = await pipeline(new FakeBobAdapter(path.join(REPO_ROOT, "tests", "fixtures", "fake-bob", "repro-passes")));
    expect(run.status).toBe("UNVERIFIED");
    expect(run.strategies).toEqual([]);
    expect(run.candidates).toEqual([]);
    const listed = await worktrees.list(primary, RUN);
    expect(listed.ok && listed.value).toEqual([]);
    expect(git(primary, "branch", "--format=%(refname:short)")).toBe("main");
  });

  it("blocks the baseline when HEAD moved after the run was created", async () => {
    await writeFile(path.join(primary, "later.txt"), "x");
    git(primary, "add", "later.txt");
    git(primary, "commit", "-q", "-m", "later");
    const run = await pipeline(new FakeBobAdapter(FAKE_SCENARIO_DIR));
    expect(run).toMatchObject({ status: "BLOCKED_BASELINE", failure: { code: "REPO_DIRTY" } });
    expect(await access(path.join(runtime, "worktrees")).then(() => true, () => false)).toBe(false);
  });

  it.skipIf(!hasFixtureDeps)("provisions private node_modules so typecheck and build run in a fresh worktree", async () => {
    const run = await pipeline(new FakeBobAdapter(FAKE_SCENARIO_DIR), FIXTURE_NODE_MODULES);
    const wt = run.candidates[0]!.worktreePath;
    const tsc = path.join(wt, "node_modules", "typescript", "bin", "tsc");
    for (const args of [[tsc, "--noEmit"], [tsc, "-p", "tsconfig.build.json", "--outDir", path.join(tmp.dir, "dist-a")]]) {
      const r = await runCommand(
        { command: process.execPath, args, cwd: wt, timeoutMs: 60_000, env: buildCommandEnv(["PATH", "HOME"]) },
        { allowedRoots: [runtime] },
      );
      expect(r.ok && r.value.exitCode, r.ok ? r.value.stdout + r.value.stderr : "").toBe(0);
    }
    // Copied, ignored dependencies: not a symlink, and invisible to candidate status.
    expect(git(wt, "status", "--porcelain")).not.toContain("node_modules");
    expect(git(wt, "status", "--porcelain").split("\n").map((l) => l.trim()).sort()).toEqual(["A test/refresh-expired.test.ts", "M src/http-errors.ts"]);
  });
});
