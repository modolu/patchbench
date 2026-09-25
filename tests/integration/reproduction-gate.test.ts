import { access, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PatchBenchError } from "@/domain/errors";
import { defaultRunPolicy, type RunPolicy } from "@/domain/policy";
import type { PatchBenchRun } from "@/domain/run";
import { ok, type Result } from "@/lib/result";
import type { BobAdapter, ReproductionInput } from "@/server/bob/adapter";
import { FakeBobAdapter } from "@/server/bob/fake-adapter";
import type { ReproductionProposal } from "@/server/bob/schemas";
import { GitAdapter } from "@/server/git/git-adapter";
import { buildCommandEnv, runCommand } from "@/server/runner/command-runner";
import { parseNodeTap } from "@/server/runner/test-output";
import { classifyReproduction } from "@/server/reproduction/classify";
import {
  applyFrozenRegression,
  loadFrozenArtifact,
  reproductionDir,
  sha256,
  verifyFrozenRegression,
  writeFrozenArtifact,
} from "@/server/reproduction/regression-artifact";
import { runReproductionGate } from "@/server/reproduction/reproduction-service";
import { FileRunStore } from "@/server/runs/store";
import { addDetachedWorktree, makeBaselineRepo, treeFingerprint } from "../helpers/baseline-repo";
import { makeRun, makeTempDir } from "../helpers/factories";
import { git } from "../helpers/git";
import { FAKE_SCENARIO_DIR, REPO_ROOT } from "../helpers/scenario";

const SCENARIOS = path.join(REPO_ROOT, "tests", "fixtures", "fake-bob");
const TEST_FILE = "test/refresh-expired.test.ts";
const RUN_ID = "run-20260925120000-abc123";

let tmp: Awaited<ReturnType<typeof makeTempDir>>;
let primary: string;
let sha: string;
let store: FileRunStore;
let workspace: string;

beforeEach(async () => {
  tmp = await makeTempDir();
  ({ primary, sha } = await makeBaselineRepo(tmp.dir));
  store = new FileRunStore(path.join(tmp.dir, ".patchbench"));
  workspace = addDetachedWorktree(primary, path.join(tmp.dir, ".patchbench", "worktrees", RUN_ID, "reproduction"), sha);
});
afterEach(() => tmp.cleanup());

async function createRun(overrides: Partial<PatchBenchRun> = {}, policy: Partial<RunPolicy> = {}) {
  const base = makeRun();
  const run = makeRun({
    status: "REPRODUCING",
    repository: { ...base.repository, root: primary, commitSha: sha },
    policy: defaultRunPolicy(policy),
    ...overrides,
  });
  const created = await store.createRun(run);
  if (!created.ok) throw new Error(created.error.message);
  return run;
}

const gate = (bob: BobAdapter, extra: { signal?: AbortSignal; workspace?: string } = {}) =>
  runReproductionGate({ store, bob }, { runId: RUN_ID, workspace: extra.workspace ?? workspace, primaryRoot: primary, signal: extra.signal });

const exists = (p: string) => access(p).then(() => true, () => false);
const artifact = (name: string) => path.join(reproductionDir(store, RUN_ID), name);

function unwrap<T>(r: Result<T, PatchBenchError>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message} ${r.error.detail ?? ""}`);
  return r.value;
}

/** Writes arbitrary files, bypassing FakeBobAdapter's own checks, and claims `declared`. */
class StubBob implements BobAdapter {
  readonly kind = "fake" as const;
  calls = 0;
  constructor(
    private readonly write: (input: ReproductionInput) => Promise<void>,
    private readonly declared: string[],
  ) {}
  async generateReproduction(input: ReproductionInput): Promise<Result<ReproductionProposal, PatchBenchError>> {
    this.calls++;
    await this.write(input);
    return ok({ testFiles: this.declared, command: "node --test", expectedFailure: "expected 401, received 500", notes: "" });
  }
  generateStrategies(): never {
    throw new Error("unused");
  }
  implementStrategy(): never {
    throw new Error("unused");
  }
}

const realTest = () => readFile(path.join(FAKE_SCENARIO_DIR, "files", "reproduction", TEST_FILE));
const writeInto = (rel: string, content: string | (() => Promise<Buffer>)) => async (input: ReproductionInput) => {
  await mkdir(path.dirname(path.join(input.workspace, rel)), { recursive: true });
  await writeFile(path.join(input.workspace, rel), typeof content === "string" ? content : await content());
};

describe("runReproductionGate — fixture reproduces", () => {
  it("reaches STRATEGIZING with a frozen artifact, leaving the primary worktree untouched", async () => {
    await createRun();
    const before = await treeFingerprint(primary);
    const run = unwrap(await gate(new FakeBobAdapter(FAKE_SCENARIO_DIR)));

    expect(run.status).toBe("STRATEGIZING");
    const repro = run.reproduction!;
    expect(repro.outcome).toBe("REPRODUCED");
    expect(repro.baselineCheck?.failures).toEqual(["expired refresh token returns 401, not 500"]);
    expect(repro.command).toEqual({ command: "node", args: ["--test", "--test-reporter=tap", TEST_FILE] });

    for (const name of ["proposal.json", "regression.patch", "regression.sha256", "result.json", "logs/baseline.log"]) {
      expect(await exists(artifact(name)), name).toBe(true);
    }
    const patch = await readFile(artifact("regression.patch"), "utf8");
    expect(repro.frozenPatchSha256).toBe(sha256(patch));
    expect(await readFile(artifact("regression.sha256"), "utf8")).toBe(`${sha256(patch)}  regression.patch\n`);
    expect(repro.frozenFiles).toEqual([{ path: TEST_FILE, sha256: sha256(await realTest()) }]);
    // Byte-exact: redaction must not have touched the `refreshToken: "rt_expired"` literal.
    expect(patch).toContain('refreshToken: "rt_expired"');
    expect(JSON.parse(await readFile(artifact("result.json"), "utf8"))).toEqual(repro);

    expect(await treeFingerprint(primary)).toEqual(before);
    expect(git(primary, "rev-parse", "HEAD")).toBe(sha);
    expect(git(primary, "status", "--porcelain")).toBe("");

    const events = await store.readEvents(RUN_ID);
    expect(events.map((e) => e.type)).toEqual([
      "run.created",
      "reproduction.started",
      "reproduction.proposal_received",
      "reproduction.command.completed",
      "reproduction.frozen",
      "reproduction.confirmed",
      "run.status_changed",
    ]);
    const raw = await readFile(path.join(store.runDir(RUN_ID), "events.jsonl"), "utf8");
    for (const leak of ["rt_expired", "assert.equal", "TAP version", "diff --git", "not ok"]) expect(raw).not.toContain(leak);
  });

  it("refuses to run twice or overwrite the frozen patch", async () => {
    await createRun();
    unwrap(await gate(new FakeBobAdapter(FAKE_SCENARIO_DIR)));
    const original = await readFile(artifact("regression.patch"), "utf8");
    const again = await writeFrozenArtifact(store, RUN_ID, "diff --git a/x b/x\n");
    expect(again.ok || again.error.code).toBe("REGRESSION_TEST_MUTATED");
    expect(await readFile(artifact("regression.patch"), "utf8")).toBe(original);
    const rerun = await gate(new FakeBobAdapter(FAKE_SCENARIO_DIR));
    expect(rerun.ok || rerun.error.code).toBe("INVALID_TRANSITION");
  });

  it("round-trips into a fresh baseline workspace and detects mutation, deletion, symlinks and tampering", async () => {
    await createRun();
    const run = unwrap(await gate(new FakeBobAdapter(FAKE_SCENARIO_DIR)));
    const frozen = unwrap(await loadFrozenArtifact(store, run));
    const fresh = addDetachedWorktree(primary, path.join(tmp.dir, ".patchbench", "worktrees", RUN_ID, "candidate-a"), sha);
    const wsGit = new GitAdapter({ allowedRoots: [fresh] });
    unwrap(await applyFrozenRegression(wsGit, fresh, frozen));

    // The injected test reproduces identically in the fresh workspace.
    const res = unwrap(
      await runCommand(
        { command: "node", args: ["--test", "--test-reporter=tap", TEST_FILE], cwd: fresh, timeoutMs: 30_000, env: buildCommandEnv(["PATH", "HOME"]) },
        { allowedRoots: [fresh] },
      ),
    );
    const verdict = classifyReproduction({ process: res, report: parseNodeTap(res.stdout), testFiles: [TEST_FILE], expectedFailure: "expected 401, received 500" });
    expect(verdict.outcome).toBe("REPRODUCED");

    const target = path.join(fresh, TEST_FILE);
    const kind = async () => {
      const r = await verifyFrozenRegression(fresh, frozen.files);
      return r.ok ? "ok" : `${r.error.code}:${JSON.parse(r.error.detail!)[0].kind}`;
    };
    await writeFile(target, (await readFile(target, "utf8")).replace("401", "500"));
    expect(await kind()).toBe("REGRESSION_TEST_MUTATED:modified");
    await rm(target);
    expect(await kind()).toBe("REGRESSION_TEST_MUTATED:deleted");
    await writeFile(path.join(tmp.dir, "outside.ts"), await realTest());
    await symlink(path.join(tmp.dir, "outside.ts"), target);
    expect(await kind()).toBe("REGRESSION_TEST_MUTATED:not_regular");

    // A second apply onto an already-patched tree is refused, not silently merged.
    const again = await applyFrozenRegression(wsGit, fresh, frozen);
    expect(again.ok).toBe(false);

    // Tampering with the stored patch or run.json hash is detected on load.
    await writeFile(frozen.patchPath, (await readFile(frozen.patchPath, "utf8")).replace("401", "402"));
    expect((await loadFrozenArtifact(store, run)).ok || "mutated").toBe("mutated");
    const other = { ...run, reproduction: { ...run.reproduction!, frozenPatchSha256: "0".repeat(64) } };
    const r = await loadFrozenArtifact(store, other);
    expect(r.ok || r.error.code).toBe("REGRESSION_TEST_MUTATED");
  });
});

describe("runReproductionGate — rejected reproductions", () => {
  it.each([
    ["repro-passes", "NOT_REPRODUCED", "REPRO_NOT_CONFIRMED", /passes on the untouched baseline/],
    ["repro-malformed", "INVALID_REPRODUCTION", "REPRO_INVALID", /failed to load/],
    ["repro-wrong-reason", "INVALID_REPRODUCTION", "REPRO_INVALID", /expected failure/],
    ["repro-touches-src", "INVALID_REPRODUCTION", "REPRO_INVALID", /src\/errors\.ts modifies an existing file/],
  ])("%s → UNVERIFIED (%s) with no frozen artifact", async (scenario, outcome, code, reason) => {
    await createRun();
    const before = await treeFingerprint(primary);
    const run = unwrap(await gate(new FakeBobAdapter(path.join(SCENARIOS, scenario))));
    expect(run.status).toBe("UNVERIFIED");
    expect(run.failure?.code).toBe(code);
    expect(run.reproduction).toMatchObject({ outcome, reasonCode: code });
    expect(run.reproduction?.reason).toMatch(reason);
    expect(run.reproduction?.frozenPatchSha256).toBeUndefined();
    expect(await exists(artifact("regression.patch"))).toBe(false);
    expect(await exists(artifact("regression.sha256"))).toBe(false);
    expect(await exists(artifact("result.json"))).toBe(true);
    expect((await store.readEvents(RUN_ID)).map((e) => e.type)).toContain("reproduction.rejected");
    expect(await treeFingerprint(primary)).toEqual(before);
    expect((await loadFrozenArtifact(store, run)).ok).toBe(false);
  });

  it("rejects zero tests", async () => {
    await createRun();
    const run = unwrap(await gate(new StubBob(writeInto(TEST_FILE, "// no tests here\n"), [TEST_FILE])));
    expect(run.reproduction).toMatchObject({ outcome: "INVALID_REPRODUCTION", reason: expect.stringMatching(/no tests/) });
  });

  it("rejects a timed-out regression command", async () => {
    await createRun({}, { regressionCommand: { command: process.execPath, args: ["-e", "setTimeout(() => {}, 20000)"] }, commandTimeoutMs: 300 });
    const run = unwrap(await gate(new FakeBobAdapter(FAKE_SCENARIO_DIR)));
    expect(run.status).toBe("UNVERIFIED");
    expect(run.reproduction).toMatchObject({ outcome: "INVALID_REPRODUCTION", reason: expect.stringMatching(/timed out/) });
  });

  it("executes only the policy command, never the proposal's", async () => {
    // The proposal's `node --test <file>` would reproduce; the policy command does not emit TAP.
    await createRun({}, { regressionCommand: { command: process.execPath, args: ["-e", "process.exit(1)"] } });
    const run = unwrap(await gate(new FakeBobAdapter(FAKE_SCENARIO_DIR)));
    expect(run.reproduction?.command).toEqual({ command: process.execPath, args: ["-e", "process.exit(1)", TEST_FILE] });
    expect(run.reproduction).toMatchObject({ outcome: "INVALID_REPRODUCTION", reason: expect.stringMatching(/not complete TAP/) });
    expect((await readFile(artifact("logs/baseline.log"), "utf8")).split("\n")[0]).toBe(`$ ${process.execPath} -e process.exit(1) ${TEST_FILE}`);
  });

  it.each([
    ["an undeclared extra file", [TEST_FILE, "test/extra.test.ts"], [TEST_FILE], /do not match declared/],
    ["a declared file that was never written", [TEST_FILE], [TEST_FILE, "test/ghost.test.ts"], /do not match declared/],
    ["a non-test path", ["lib/helper.ts"], ["lib/helper.ts"], /not a test file/],
    ["an excluded path", ["test/.env.test.ts"], ["test/.env.test.ts"], /excluded path/],
  ])("rejects %s", async (_name, written, declared, reason) => {
    await createRun();
    const bob = new StubBob(async (input) => {
      for (const rel of written) await writeInto(rel, realTest)(input);
    }, declared);
    const run = unwrap(await gate(bob));
    expect(run.status).toBe("UNVERIFIED");
    expect(run.reproduction?.reason).toMatch(reason);
  });

  it("rejects a symlinked test file", async () => {
    await createRun();
    await writeFile(path.join(tmp.dir, "outside.test.ts"), await realTest());
    const bob = new StubBob(async (input) => {
      await symlink(path.join(tmp.dir, "outside.test.ts"), path.join(input.workspace, TEST_FILE));
    }, [TEST_FILE]);
    const run = unwrap(await gate(bob));
    expect(run.reproduction?.reason).toMatch(/not a regular file/);
  });
});

describe("runReproductionGate — guards", () => {
  it("has no side effects when the run is not REPRODUCING", async () => {
    await createRun({ status: "CREATED" });
    const bob = new StubBob(writeInto(TEST_FILE, realTest), [TEST_FILE]);
    const r = await gate(bob);
    expect(r.ok || r.error.code).toBe("INVALID_TRANSITION");
    expect(bob.calls).toBe(0);
    expect(await exists(reproductionDir(store, RUN_ID))).toBe(false);
    expect((await store.readEvents(RUN_ID)).map((e) => e.type)).toEqual(["run.created"]);
    expect(unwrap(await store.loadRun(RUN_ID)).status).toBe("CREATED");
    expect(git(workspace, "status", "--porcelain")).toBe("");
  });

  it("fails with BASELINE_MUTATED (non-recoverable) when the primary worktree changes", async () => {
    await createRun();
    const bob = new StubBob(async (input) => {
      await writeInto(TEST_FILE, realTest)(input);
      await writeFile(path.join(primary, "src", "app.ts"), "// clobbered\n");
    }, [TEST_FILE]);
    const run = unwrap(await gate(bob));
    expect(run.status).toBe("FAILED");
    expect(run.failure).toMatchObject({ code: "BASELINE_MUTATED", recoverable: false });
    expect(await exists(artifact("regression.patch"))).toBe(false);
    // PatchBench never "repairs" the user's repository.
    expect(git(primary, "status", "--porcelain")).toBe("M src/app.ts");
  });

  it("fails when the workspace is dirty, off-baseline, or the primary worktree itself", async () => {
    await createRun();
    await writeFile(path.join(workspace, "stray.txt"), "x");
    const dirty = unwrap(await gate(new FakeBobAdapter(FAKE_SCENARIO_DIR)));
    expect(dirty).toMatchObject({ status: "FAILED", failure: { code: "REPO_DIRTY" } });

    await rm(path.join(tmp.dir, ".patchbench", "runs"), { recursive: true });
    await createRun();
    const self = unwrap(await gate(new FakeBobAdapter(FAKE_SCENARIO_DIR), { workspace: primary }));
    expect(self).toMatchObject({ status: "FAILED", failure: { code: "REPO_DIRTY" } });
    expect(git(primary, "status", "--porcelain")).toBe("");
  });

  it("cancels cleanly when aborted", async () => {
    await createRun();
    const controller = new AbortController();
    controller.abort();
    const run = unwrap(await gate(new FakeBobAdapter(FAKE_SCENARIO_DIR), { signal: controller.signal }));
    expect(run.status).toBe("CANCELLED");
    expect(await exists(artifact("regression.patch"))).toBe(false);
  });
});
