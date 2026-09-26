import { access, chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultRunPolicy } from "@/domain/policy";
import { detectBobIntegration } from "@/server/bob/detect";
import { ManualBobAdapter, type ManualBobAdapterOptions } from "@/server/bob/manual-adapter";
import { REPRODUCTION_RESULT_PATH } from "@/server/bob/schemas";
import { reproductionDir } from "@/server/reproduction/regression-artifact";
import { runReproductionGate } from "@/server/reproduction/reproduction-service";
import { FileRunStore } from "@/server/runs/store";
import { addDetachedWorktree, makeBaselineRepo } from "../helpers/baseline-repo";
import { makeRun, makeTempDir } from "../helpers/factories";
import { git } from "../helpers/git";
import { FAKE_SCENARIO_DIR } from "../helpers/scenario";

/** Manual Bob IDE hand-off, simulated at the file boundary. Zero Bobcoins. */
const RUN_ID = "run-20260926120000-abc123";
const TEST_FILE = "test/refresh-expired.test.ts";

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
  const base = makeRun();
  const created = await store.createRun(
    makeRun({ id: RUN_ID, status: "REPRODUCING", repository: { ...base.repository, root: primary, commitSha: sha }, policy: defaultRunPolicy() }),
  );
  if (!created.ok) throw new Error(created.error.message);
});
afterEach(() => tmp.cleanup());

const handoffDir = (id: string) => path.join(store.runDir(id), "handoff");
const exists = (p: string) => access(p).then(() => true, () => false);

type BobAction = (ws: string) => Promise<void>;

/** Simulates the user running the packet in Bob IDE after it is written. */
function manualBob(action: BobAction | null, opts: Partial<ManualBobAdapterOptions> = {}) {
  let pending: Promise<void> = Promise.resolve();
  const bob = new ManualBobAdapter({
    handoffDir,
    timeoutMs: 5_000,
    pollIntervalMs: 10,
    onPacketReady: ({ workspace: ws }) => {
      if (action) pending = new Promise((r) => setTimeout(r, 20)).then(() => action(ws));
    },
    ...opts,
  });
  return { bob, settled: () => pending };
}

const writeFileIn = async (ws: string, rel: string, content: string | Buffer) => {
  await mkdir(path.dirname(path.join(ws, rel)), { recursive: true });
  await writeFile(path.join(ws, rel), content);
};
const realTest = () => readFile(path.join(FAKE_SCENARIO_DIR, "files", "reproduction", TEST_FILE));
const result = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 1, status: "completed", testFiles: [TEST_FILE], expectedFailure: "expected 401, received 500", summary: "asserts 401", ...overrides });
/** Bob writes the real regression test plus a result document. */
const bobWrites = (resultJson: string, extra: BobAction = async () => {}): BobAction => async (ws) => {
  await writeFileIn(ws, TEST_FILE, await realTest());
  await extra(ws);
  await writeFileIn(ws, REPRODUCTION_RESULT_PATH, resultJson);
};

const gate = (bob: ManualBobAdapter, signal?: AbortSignal) => runReproductionGate({ store, bob }, { runId: RUN_ID, workspace, primaryRoot: primary, signal });

async function expectFailedWith(bob: ManualBobAdapter, code: string) {
  const r = await gate(bob);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.value.status).toBe("FAILED");
  expect(r.value.failure?.code).toBe(code);
  expect(await exists(path.join(reproductionDir(store, RUN_ID), "frozen"))).toBe(false);
  return r.value;
}

describe("ManualBobAdapter — reproduction hand-off", () => {
  it("writes a bounded packet, ingests a valid result, and the gate independently reaches STRATEGIZING", async () => {
    const { bob } = manualBob(bobWrites(result()));
    const r = await gate(bob);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.status).toBe("STRATEGIZING");
    expect(r.value.reproduction).toMatchObject({ outcome: "REPRODUCED", testFiles: [TEST_FILE], baselineCheck: { failures: ["expired refresh token returns 401, not 500"] } });
    expect(r.value.reproduction?.frozenPatchSha256).toMatch(/^[0-9a-f]{64}$/);

    const packet = await readFile(path.join(handoffDir(RUN_ID), "reproduction-task.md"), "utf8");
    expect(packet).toContain(r.value.issue.title);
    expect(packet).toContain(REPRODUCTION_RESULT_PATH);
    expect(packet).toContain("node --test --test-reporter=tap");
    // The packet describes the bug, never the fix or the answer key.
    for (const leak of ["TokenExpiredError", "toErrorResponse", "http-errors", "fake-bob", "refresh-expired"]) expect(packet).not.toContain(leak);

    // The reserved result is consumed from the workspace and kept as evidence.
    expect(await exists(path.join(workspace, ".patchbench-handoff"))).toBe(false);
    expect(JSON.parse(await readFile(path.join(handoffDir(RUN_ID), "reproduction-result.json"), "utf8"))).toMatchObject({ status: "completed" });
    expect(git(primary, "status", "--porcelain")).toBe("");
  });

  it.each([
    ["malformed JSON", "{ not json"],
    ["missing expectedFailure", result({ expectedFailure: undefined })],
    ["unknown key", result({ command: "rm -rf /" })],
    ["wrong schema version", result({ schemaVersion: 2 })],
    ["traversal path", result({ testFiles: ["../escape.test.ts"] })],
    ["absolute path", result({ testFiles: ["/tmp/x.test.ts"] })],
    ["non-canonical path", result({ testFiles: ["./test/refresh-expired.test.ts"] })],
    ["empty test list", result({ testFiles: [] })],
  ])("rejects %s with a typed BOB_OUTPUT_INVALID failure", async (_name, json) => {
    const { bob } = manualBob(bobWrites(json));
    await expectFailedWith(bob, "BOB_OUTPUT_INVALID");
  });

  it("rejects a declared test file that does not exist", async () => {
    const { bob } = manualBob(bobWrites(result({ testFiles: [TEST_FILE, "test/missing.test.ts"] })));
    const run = await expectFailedWith(bob, "BOB_OUTPUT_INVALID");
    expect(run?.failure?.detail).toBe("test/missing.test.ts");
  });

  it("treats a 'blocked' result as a typed failure (Bob could not complete)", async () => {
    const { bob } = manualBob(async (ws) => writeFileIn(ws, REPRODUCTION_RESULT_PATH, JSON.stringify({ schemaVersion: 1, status: "blocked", summary: "cannot reproduce" })));
    await expectFailedWith(bob, "BOB_OUTPUT_INVALID");
  });

  it("rejects a symlinked result file", async () => {
    const outside = path.join(tmp.dir, "outside.json");
    await writeFile(outside, result());
    const { bob } = manualBob(async (ws) => {
      await writeFileIn(ws, TEST_FILE, await realTest());
      await mkdir(path.join(ws, ".patchbench-handoff"), { recursive: true });
      await symlink(outside, path.join(ws, REPRODUCTION_RESULT_PATH));
    });
    await expectFailedWith(bob, "BOB_OUTPUT_INVALID");
  });

  it("rejects a symlinked hand-off directory", async () => {
    const outsideDir = path.join(tmp.dir, "outside-dir");
    await mkdir(outsideDir);
    await writeFile(path.join(outsideDir, "reproduction-result.json"), result());
    const { bob } = manualBob(async (ws) => {
      await writeFileIn(ws, TEST_FILE, await realTest());
      await symlink(outsideDir, path.join(ws, ".patchbench-handoff"));
    });
    await expectFailedWith(bob, "BOB_OUTPUT_INVALID");
  });

  it("times out with COMMAND_TIMEOUT when Bob never writes a result", async () => {
    const { bob } = manualBob(null, { timeoutMs: 100 });
    await expectFailedWith(bob, "COMMAND_TIMEOUT");
  });

  it("cancels the wait and the run when aborted", async () => {
    const controller = new AbortController();
    const { bob } = manualBob(async () => controller.abort());
    const r = await gate(bob, controller.signal);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.status).toBe("CANCELLED");
  });

  it("never executes Bob's proposed command", async () => {
    const marker = path.join(tmp.dir, "pwned");
    const { bob } = manualBob(bobWrites(result({ proposedCommand: `${process.execPath} -e "require('fs').writeFileSync('${marker}','x')"` })));
    const r = await gate(bob);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.status).toBe("STRATEGIZING");
    expect(r.value.reproduction?.command).toEqual({ command: "node", args: ["--test", "--test-reporter=tap", TEST_FILE] });
    expect(await exists(marker)).toBe(false);
  });

  it("redacts secrets in Bob's summary before persisting", async () => {
    const { bob } = manualBob(bobWrites(result({ summary: "used api_key=sk-livesecretvalue1234567890 while testing" })));
    const r = await gate(bob);
    if (!r.ok) throw new Error(r.error.message);
    const persisted = await readFile(path.join(reproductionDir(store, RUN_ID), "proposal.json"), "utf8");
    const handoff = await readFile(path.join(handoffDir(RUN_ID), "reproduction-result.json"), "utf8");
    for (const text of [persisted, handoff]) {
      expect(text).not.toContain("sk-livesecretvalue1234567890");
      expect(text).toContain("[REDACTED]");
    }
  });

  describe("the reproduction gate stays authoritative", () => {
    it("rejects a production-code modification as UNVERIFIED", async () => {
      const { bob } = manualBob(bobWrites(result(), async (ws) => writeFile(path.join(ws, "src/http-errors.ts"), "export {};\n")));
      const r = await gate(bob);
      if (!r.ok) throw new Error(r.error.message);
      expect(r.value.status).toBe("UNVERIFIED");
      expect(r.value.reproduction).toMatchObject({ outcome: "INVALID_REPRODUCTION", reason: expect.stringMatching(/do not match declared/) });
    });

    it("rejects an undeclared extra file left in the hand-off directory", async () => {
      const { bob } = manualBob(bobWrites(result(), async (ws) => writeFileIn(ws, ".patchbench-handoff/notes.md", "scratch")));
      const r = await gate(bob);
      if (!r.ok) throw new Error(r.error.message);
      expect(r.value.status).toBe("UNVERIFIED");
    });

    it("rejects a wrong expected failure even though Bob claims success", async () => {
      const { bob } = manualBob(bobWrites(result({ expectedFailure: "expected 418" })));
      const r = await gate(bob);
      if (!r.ok) throw new Error(r.error.message);
      expect(r.value.status).toBe("UNVERIFIED");
      expect(r.value.reproduction?.reason).toMatch(/expected failure/);
    });

    it("rejects a test that passes on baseline (NOT_REPRODUCED)", async () => {
      const passing = 'import { test } from "node:test";\ntest("ok", () => {});\n';
      const { bob } = manualBob(async (ws) => {
        await writeFileIn(ws, TEST_FILE, passing);
        await writeFileIn(ws, REPRODUCTION_RESULT_PATH, result());
      });
      const r = await gate(bob);
      if (!r.ok) throw new Error(r.error.message);
      expect(r.value.status).toBe("UNVERIFIED");
      expect(r.value.reproduction?.outcome).toBe("NOT_REPRODUCED");
    });
  });

  it("does not support strategies or implementation yet", async () => {
    const { bob } = manualBob(null);
    expect(await bob.generateStrategies()).toMatchObject({ ok: false, error: { code: "BOB_OPERATION_UNSUPPORTED" } });
    expect(await bob.implementStrategy()).toMatchObject({ ok: false, error: { code: "BOB_OPERATION_UNSUPPORTED" } });
  });
});

describe("detectBobIntegration", () => {
  it("selects Bob Shell only for an executable `bob` on PATH, never the IDE launcher", async () => {
    const bin = path.join(tmp.dir, "bin");
    await mkdir(bin);
    await writeFile(path.join(bin, "bobide"), "#!/bin/sh\n");
    await chmod(path.join(bin, "bobide"), 0o755);
    expect(await detectBobIntegration({ PATH: bin })).toMatchObject({ kind: "manual" });

    await writeFile(path.join(bin, "bob"), "#!/bin/sh\n");
    expect(await detectBobIntegration({ PATH: bin })).toMatchObject({ kind: "manual" }); // not executable
    await chmod(path.join(bin, "bob"), 0o755);
    expect(await detectBobIntegration({ PATH: bin })).toEqual({ kind: "shell", executable: path.join(bin, "bob") });
  });
});
