import { access, appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pbError, type PatchBenchError } from "@/domain/errors";
import type { EvidenceMatrix } from "@/domain/evidence";
import type { PatchBenchRun } from "@/domain/run";
import { err, type Result } from "@/lib/result";
import type { ImplementationInput } from "@/server/bob/adapter";
import { FakeBobAdapter } from "@/server/bob/fake-adapter";
import type { ImplementationResult } from "@/server/bob/schemas";
import { GitWorktreeManager, workspacePath } from "@/server/git/worktrees";
import { sha256 } from "@/server/reproduction/regression-artifact";
import { runDeterministicPipeline } from "@/server/runs/orchestrator";
import { FileRunStore } from "@/server/runs/store";
import { buildEvidenceMatrix } from "@/server/verification/evidence-builder";
import { makeBaselineRepo, treeFingerprint } from "../helpers/baseline-repo";
import { makeRun, makeTempDir } from "../helpers/factories";
import { git } from "../helpers/git";
import { FAKE_SCENARIO_DIR, FIXTURE_DIR, REPO_ROOT } from "../helpers/scenario";

const RUN = "run-20260925120000-abc123";
const TEST_FILE = "test/refresh-expired.test.ts";
const FIXTURE_NODE_MODULES = path.join(FIXTURE_DIR, "node_modules");
const PIPELINE_TIMEOUT = 180_000;
const DISABLED = "test/account-policy.test.ts > refresh for a disabled account returns 403 account_disabled";
const OUTAGE = "test/account-policy.test.ts > refresh during a token-store outage returns 503, not an auth error";

const exists = (p: string) => access(p).then(() => true, () => false);

interface Ctx {
  tmp: Awaited<ReturnType<typeof makeTempDir>>;
  primary: string;
  sha: string;
  runtime: string;
  store: FileRunStore;
  worktrees: GitWorktreeManager;
}

async function setup(extraFiles: Record<string, string> = {}): Promise<Ctx> {
  if (!(await exists(path.join(FIXTURE_NODE_MODULES, "typescript")))) {
    throw new Error("Fixture dependencies missing: run `pnpm --dir fixtures/auth-expiry-bug install` first.");
  }
  const tmp = await makeTempDir();
  const { primary, sha } = await makeBaselineRepo(tmp.dir, extraFiles);
  const runtime = path.join(tmp.dir, ".patchbench");
  const store = new FileRunStore(runtime);
  const base = makeRun();
  const created = await store.createRun(makeRun({ repository: { ...base.repository, root: primary, commitSha: sha } }));
  if (!created.ok) throw new Error(created.error.message);
  return { tmp, primary, sha, runtime, store, worktrees: new GitWorktreeManager(runtime) };
}

async function pipeline(ctx: Ctx, bob: FakeBobAdapter, dependencySource: string | undefined = FIXTURE_NODE_MODULES): Promise<PatchBenchRun> {
  const r = await runDeterministicPipeline({ store: ctx.store, bob, worktrees: ctx.worktrees }, { runId: RUN, dependencySource });
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message} ${r.error.detail ?? ""}`);
  return r.value;
}

type Behaviour = "fixture" | "none" | "overwrite-frozen" | "adapter-refused" | { as: string; then?: (workspace: string) => Promise<void> };

/** FakeBobAdapter with per-candidate scripted behaviour (deterministic, zero Bobcoins). */
class ScriptedBob extends FakeBobAdapter {
  constructor(private readonly behaviour: Record<string, Behaviour>) {
    super(FAKE_SCENARIO_DIR);
  }
  override async implementStrategy(input: ImplementationInput): Promise<Result<ImplementationResult, PatchBenchError>> {
    const b = this.behaviour[input.candidateId] ?? "fixture";
    if (b === "none") return { ok: true, value: { changedFiles: [], summary: "no change" } };
    if (b === "adapter-refused") return err(pbError("REGRESSION_TEST_MUTATED", "Candidate attempted to modify the frozen regression test.", { detail: TEST_FILE }));
    if (b === "fixture" || b === "overwrite-frozen") {
      const r = await super.implementStrategy(input);
      if (b === "overwrite-frozen") {
        const target = path.join(input.workspace, TEST_FILE);
        await writeFile(target, (await readFile(target, "utf8")).replace("assert.equal(res.status, 401", "assert.ok(res.status"));
      }
      return r;
    }
    const r = await super.implementStrategy({ ...input, strategy: { ...input.strategy, id: b.as } });
    await b.then?.(input.workspace);
    return r;
  }
}

const cell = (m: EvidenceMatrix, key: string, id: string) => m.rows.find((r) => r.key === key)!.candidateValues[id]!;

describe("deterministic benchmark end-to-end (dirty primary)", () => {
  let ctx: Ctx;
  let run: PatchBenchRun;
  let before: Record<string, string>;
  let statusBefore: string;

  beforeAll(async () => {
    ctx = await setup();
    // Uncommitted primary edits that would change every result if baseline ran here.
    const pkg = path.join(ctx.primary, "package.json");
    await writeFile(pkg, (await readFile(pkg, "utf8")).replace('"test": "node --test', '"test": "node -e process.exit(3) --test'));
    await appendFile(path.join(ctx.primary, "src", "app.ts"), '\nexport const broken: number = "not a number";\n');
    await writeFile(path.join(ctx.primary, "test", "dirty.test.ts"), 'import { test } from "node:test";\ntest("dirty", () => { throw new Error("x"); });\n');
    before = await treeFingerprint(ctx.primary);
    statusBefore = git(ctx.primary, "status", "--porcelain");
    run = await pipeline(ctx, new FakeBobAdapter(FAKE_SCENARIO_DIR));
  }, PIPELINE_TIMEOUT);
  afterAll(() => ctx?.tmp.cleanup());

  it("completes with A eligible, B rejected for exactly two new failures, C eligible", () => {
    expect(run.status).toBe("COMPLETE");
    expect(run.candidates.map((c) => [c.id, c.status])).toEqual([["a", "ELIGIBLE"], ["b", "REJECTED"], ["c", "ELIGIBLE"]]);
    const b = run.candidates[1]!.verification!;
    expect(b.newFailures).toEqual([OUTAGE, DISABLED]);
    expect(b.rejectionReasons).toEqual([`Introduced new test failures (2): ${OUTAGE}; ${DISABLED}`]);
    for (const c of run.candidates) {
      const v = c.verification!;
      expect(v.regressionIntact).toBe(true);
      expect(v.regression.passed).toBe(true);
      expect([v.typecheck?.passed, v.lint?.passed, v.build?.passed]).toEqual([true, true, true]);
      expect(v.hardGatePassed).toBe(c.id !== "b");
      if (c.id !== "b") expect(v.newFailures).toEqual([]);
    }
    expect(run.metrics.candidatesRejected).toBe(1);
  });

  it("runs baseline checks in a clean detached worktree, unaffected by the dirty primary", async () => {
    const baseline = run.baseline!;
    expect(baseline.commitSha).toBe(ctx.sha);
    expect(baseline.failures).toEqual([]);
    expect(baseline.checks.map((c) => [c.name, c.passed])).toEqual([["test", true], ["typecheck", true], ["lint", true], ["build", true]]);
    // Commands come from the committed package.json, not the edited one.
    expect(baseline.checks[0]!.command).toEqual({ command: "pnpm", args: ["run", "test"] });
    expect(run.policy.verificationCommands.map((c) => [c.name, c.required])).toEqual([["test", true], ["typecheck", true], ["lint", false], ["build", true]]);
    const log = await readFile(path.join(ctx.store.runDir(RUN), "baseline", "logs", "test.log"), "utf8");
    expect(log).not.toContain("process.exit(3)");
    expect(log).not.toContain("dirty");
    const ws = workspacePath(ctx.runtime, RUN, "baseline");
    expect(git(ws, "rev-parse", "HEAD")).toBe(ctx.sha);
    expect(git(ws, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    expect(JSON.parse(await readFile(path.join(ctx.store.runDir(RUN), "baseline", "result.json"), "utf8"))).toEqual(baseline);
  });

  it("leaves the dirty primary worktree byte-for-byte unchanged", async () => {
    expect(git(ctx.primary, "rev-parse", "HEAD")).toBe(ctx.sha);
    expect(git(ctx.primary, "status", "--porcelain")).toBe(statusBefore);
    expect(await treeFingerprint(ctx.primary)).toEqual(before);
  });

  it("gives every candidate the identical frozen regression and command set, in isolation", async () => {
    const frozen = sha256(await readFile(path.join(FAKE_SCENARIO_DIR, "files", "reproduction", TEST_FILE)));
    for (const c of run.candidates) {
      expect(git(c.worktreePath, "rev-parse", "HEAD")).toBe(ctx.sha);
      expect(sha256(await readFile(path.join(c.worktreePath, TEST_FILE)))).toBe(frozen);
      const v = c.verification!;
      expect(v.regression.command).toEqual({ command: "node", args: ["--test", "--test-reporter=tap", TEST_FILE] });
      expect([v.tests, v.typecheck, v.lint, v.build].map((x) => x?.command)).toEqual(run.baseline!.checks.map((x) => x.command));
      expect(v.diff.files.map((f) => f.path)).not.toContain(TEST_FILE);
    }
    expect(run.candidates.map((c) => c.verification!.diff.files.map((f) => f.path))).toEqual([["src/http-errors.ts"], ["src/app.ts"], ["src/app.ts"]]);
  });

  it("persists artifacts and a report.json evidence matrix derived from run.json", async () => {
    const dir = ctx.store.runDir(RUN);
    for (const rel of [
      "baseline/result.json", "baseline/logs/test.log", "baseline/logs/lint.log",
      "reproduction/regression.patch", "reproduction/result.json", "report.json",
      ...["a", "b", "c"].flatMap((id) => [`candidates/${id}/result.json`, `candidates/${id}/logs/regression.log`, `candidates/${id}/logs/build.log`]),
    ]) {
      expect(await exists(path.join(dir, rel)), rel).toBe(true);
    }
    for (const c of run.candidates) {
      expect(JSON.parse(await readFile(path.join(dir, "candidates", c.id, "result.json"), "utf8"))).toEqual(c);
    }
    const report = JSON.parse(await readFile(path.join(dir, "report.json"), "utf8")) as EvidenceMatrix;
    expect(report).toEqual(buildEvidenceMatrix(run));
    expect(report.candidates.map((c) => [c.id, c.status])).toEqual([["a", "ELIGIBLE"], ["b", "REJECTED"], ["c", "ELIGIBLE"]]);
    expect(cell(report, "new_failures", "b")).toEqual({ status: "fail", display: "2", detail: [OUTAGE, DISABLED] });
    expect(cell(report, "existing_tests", "b").display).toBe("11/13");
    expect(cell(report, "existing_tests", "a")).toEqual({ status: "pass", display: "13/13" });
    expect(run.baseline!.checks[0]!.summary).toEqual({ tests: 12, pass: 12, fail: 0 });
  });

  it("emits a deterministic, output-free timeline", async () => {
    const events = await ctx.store.readEvents(RUN);
    const types = events.map((e) => e.type);
    const order = ["baseline.started", "baseline.completed", "reproduction.frozen", "strategies.generated", "candidate.created", "candidate.verification_started", "run.completed"];
    const positions = order.map((t) => types.indexOf(t));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
    expect(types.filter((t) => t === "baseline.check_completed")).toHaveLength(4);
    expect(events.filter((e) => e.type === "candidate.eligible").map((e) => e.candidateId)).toEqual(["a", "c"]);
    expect(events.find((e) => e.type === "candidate.rejected")).toMatchObject({ candidateId: "b", data: { newFailures: 2, rejectionReasons: ["Introduced new test failures"] } });
    expect(events.find((e) => e.type === "run.completed")?.data).toEqual({ eligible: ["a", "c"], rejected: ["b"], failed: [], timed_out: [] });
    expect(types.at(-1)).toBe("run.status_changed");
    const raw = await readFile(path.join(ctx.store.runDir(RUN), "events.jsonl"), "utf8");
    for (const leak of ["TAP version", "not ok", "rt_expired", "diff --git"]) expect(raw).not.toContain(leak);
  });
});

describe("hard gates", () => {
  let ctx: Ctx;
  let run: PatchBenchRun;
  beforeAll(async () => {
    ctx = await setup();
    run = await pipeline(
      ctx,
      new ScriptedBob({
        // Real fix + an unused helper: lint fails, typecheck/build pass.
        a: { as: "a", then: (ws) => appendFile(path.join(ws, "src", "http-errors.ts"), "\nfunction unusedHelper(): void {}\n") },
        // No change: the regression still fails.
        b: "none",
        // Real fix + a type error: typecheck and build fail.
        c: { as: "a", then: (ws) => appendFile(path.join(ws, "src", "app.ts"), '\nexport const broken: number = "x";\n') },
      }),
    );
  }, PIPELINE_TIMEOUT);
  afterAll(() => ctx?.tmp.cleanup());

  it("records lint failure as evidence without rejecting", () => {
    const a = run.candidates[0]!;
    expect(a.status).toBe("ELIGIBLE");
    expect(a.verification!.lint?.passed).toBe(false);
    const m = buildEvidenceMatrix(run);
    expect(m.rows.find((r) => r.key === "lint")!.kind).toBe("informational");
    expect(cell(m, "lint", "a").status).toBe("fail");
  });

  it("rejects a candidate whose regression still fails", () => {
    const b = run.candidates[1]!;
    expect(b.status).toBe("REJECTED");
    expect(b.verification!.rejectionReasons).toEqual(["Regression test still fails"]);
    expect(b.verification!.newFailures).toEqual([]);
  });

  it("rejects required typecheck and build failures; the run still completes", () => {
    const c = run.candidates[2]!;
    expect(c.status).toBe("REJECTED");
    expect(c.verification!.rejectionReasons).toEqual(["Typecheck failed", "Build failed"]);
    expect(run.status).toBe("COMPLETE");
    const m = buildEvidenceMatrix(run);
    expect(["typecheck", "build", "regression", "new_failures", "frozen_regression"].map((k) => m.rows.find((r) => r.key === k)!.kind)).toEqual(Array(5).fill("hard-gate"));
    expect(["files_changed", "diff_size", "dependency_manifest", "existing_tests"].map((k) => m.rows.find((r) => r.key === k)!.kind)).toEqual(Array(4).fill("informational"));
  });
});

describe("baseline subtraction and build-only failure", () => {
  const KNOWN = "test/known-broken.test.ts > pre-existing unrelated failure";
  let ctx: Ctx;
  let run: PatchBenchRun;
  beforeAll(async () => {
    ctx = await setup({
      "test/known-broken.test.ts": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\n\ntest("pre-existing unrelated failure", () => {\n  assert.equal(1, 2);\n});\n',
    });
    run = await pipeline(
      ctx,
      new ScriptedBob({
        a: "fixture",
        b: {
          as: "a",
          then: async (ws) => {
            const p = path.join(ws, "tsconfig.build.json");
            await writeFile(p, (await readFile(p, "utf8")).replace('"include": ["src"]', '"include": ["src"],\n  "files": ["src/missing.ts"]'));
          },
        },
        c: { as: "b" },
      }),
    );
  }, PIPELINE_TIMEOUT);
  afterAll(() => ctx?.tmp.cleanup());

  it("records the pre-existing failure on baseline without failing the run", () => {
    expect(run.baseline!.failures).toEqual([KNOWN]);
    expect(run.baseline!.checks.find((c) => c.name === "test")!.passed).toBe(false);
    expect(run.status).toBe("COMPLETE");
  });

  it("does not hold a preserved baseline failure against a candidate", () => {
    const a = run.candidates[0]!;
    expect(a.status).toBe("ELIGIBLE");
    expect(a.verification).toMatchObject({ newFailures: [], preservedFailures: [KNOWN], baselineFailures: [KNOWN] });
    expect(a.verification!.tests!.passed).toBe(false);
  });

  it("counts only genuinely introduced failures as new", () => {
    const c = run.candidates[2]!;
    expect(c.status).toBe("REJECTED");
    expect(c.verification).toMatchObject({ newFailures: [OUTAGE, DISABLED], preservedFailures: [KNOWN] });
  });

  it("rejects a required build failure even when typecheck passes", () => {
    const b = run.candidates[1]!;
    expect(b.status).toBe("REJECTED");
    expect(b.verification!.typecheck!.passed).toBe(true);
    expect(b.verification!.rejectionReasons).toEqual(["Build failed"]);
    expect(b.verification!.diff.configFilesTouched).toEqual(["tsconfig.build.json"]);
  });
});

describe("frozen regression and early exits", () => {
  it("rejects only the candidates that mutate the frozen regression and still completes", async () => {
    const ctx = await setup();
    try {
      const run = await pipeline(ctx, new ScriptedBob({ b: "overwrite-frozen", c: "adapter-refused" }));
      expect(run.status).toBe("COMPLETE");
      expect(run.candidates.map((c) => [c.id, c.status, c.failure?.code])).toEqual([
        ["a", "ELIGIBLE", undefined],
        ["b", "REJECTED", "REGRESSION_TEST_MUTATED"],
        ["c", "REJECTED", "REGRESSION_TEST_MUTATED"],
      ]);
      expect(JSON.parse(run.candidates[1]!.failure!.detail!)).toEqual([{ path: TEST_FILE, kind: "modified" }]);
      const m = buildEvidenceMatrix(run);
      expect(["a", "b", "c"].map((id) => cell(m, "frozen_regression", id).status)).toEqual(["pass", "fail", "fail"]);
      expect(cell(m, "regression", "b").status).toBe("not_run");
    } finally {
      await ctx.tmp.cleanup();
    }
  }, PIPELINE_TIMEOUT);

  it("stops at UNVERIFIED without creating candidate worktrees when the bug is not reproduced", async () => {
    const ctx = await setup();
    try {
      const run = await pipeline(ctx, new FakeBobAdapter(path.join(REPO_ROOT, "tests", "fixtures", "fake-bob", "repro-passes")));
      expect(run.status).toBe("UNVERIFIED");
      expect(run.baseline?.failures).toEqual([]);
      expect(run.strategies).toEqual([]);
      expect(run.candidates).toEqual([]);
      const listed = await ctx.worktrees.list(ctx.primary, RUN);
      expect(listed.ok && listed.value).toEqual([]);
      expect(git(ctx.primary, "branch", "--format=%(refname:short)")).toBe("main");
    } finally {
      await ctx.tmp.cleanup();
    }
  }, PIPELINE_TIMEOUT);

  it("blocks the baseline when HEAD moved after the run was created", async () => {
    const ctx = await setup();
    try {
      await writeFile(path.join(ctx.primary, "later.txt"), "x");
      git(ctx.primary, "add", "later.txt");
      git(ctx.primary, "commit", "-q", "-m", "later");
      const run = await pipeline(ctx, new FakeBobAdapter(FAKE_SCENARIO_DIR));
      expect(run).toMatchObject({ status: "BLOCKED_BASELINE", failure: { code: "REPO_DIRTY" } });
      expect(run.baseline).toBeUndefined();
      expect(await exists(path.join(ctx.runtime, "worktrees"))).toBe(false);
    } finally {
      await ctx.tmp.cleanup();
    }
  });
});
