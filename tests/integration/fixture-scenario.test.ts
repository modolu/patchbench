import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeBobAdapter } from "@/server/bob/fake-adapter";
import type { ReproductionProposal } from "@/server/bob/schemas";
import { buildCommandEnv, runCommand } from "@/server/runner/command-runner";
import type { CandidateStrategy } from "@/domain/candidate";
import { makeRun, makeTempDir } from "../helpers/factories";
import { FAKE_SCENARIO_DIR, copyFixture } from "../helpers/scenario";

/**
 * Proves the demo fixture + fake Bob scenario behave as the benchmark needs:
 * green baseline, regression fails on baseline for the expected reason,
 * candidates a/c pass everything, candidate b fixes the bug but regresses
 * exactly two adjacent auth tests. Zero Bobcoins.
 */
let tmp: Awaited<ReturnType<typeof makeTempDir>>;
const run = makeRun();
const bob = new FakeBobAdapter(FAKE_SCENARIO_DIR);
let reproduction: ReproductionProposal;
let strategies: CandidateStrategy[];

async function nodeTest(cwd: string) {
  const r = await runCommand(
    { command: process.execPath, args: ["--test", "test/**/*.test.ts"], cwd, timeoutMs: 30_000, env: buildCommandEnv(["PATH", "HOME"]) },
    { allowedRoots: [tmp.dir] },
  );
  if (!r.ok) throw new Error(r.error.message);
  const failed = [...r.value.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]!.trim()).sort();
  return { exitCode: r.value.exitCode, stdout: r.value.stdout, failed };
}

async function freshWorkspace(name: string, withRegression: boolean) {
  const ws = await copyFixture(path.join(tmp.dir, name));
  if (withRegression) {
    const r = await bob.generateReproduction({ runId: run.id, workspace: ws, repository: run.repository, issue: run.issue });
    if (!r.ok) throw new Error(r.error.message);
    reproduction = r.value;
  }
  return ws;
}

beforeAll(async () => {
  tmp = await makeTempDir();
  const ws = await freshWorkspace("strategy-ws", true);
  const s = await bob.generateStrategies({ runId: run.id, workspace: ws, issue: run.issue, reproduction, maxStrategies: 3 });
  if (!s.ok) throw new Error(s.error.message);
  strategies = s.value;
});
afterAll(() => tmp.cleanup());

describe("auth-expiry-bug fixture with FakeBobAdapter", () => {
  it("baseline suite is green", async () => {
    const result = await nodeTest(await freshWorkspace("baseline", false));
    expect(result.failed).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it("regression test fails on the untouched baseline for the expected reason", async () => {
    const result = await nodeTest(await freshWorkspace("repro", true));
    expect(result.failed).toEqual(["expired refresh token returns 401, not 500"]);
    expect(result.stdout).toContain(reproduction.expectedFailure);
  });

  it.each([
    ["a", []],
    [
      "b",
      ["refresh during a token-store outage returns 503, not an auth error", "refresh for a disabled account returns 403 account_disabled"],
    ],
    ["c", []],
  ])("candidate %s against the frozen regression test", async (id, expectedFailures) => {
    const ws = await freshWorkspace(`cand-${id}`, true);
    const strategy = strategies.find((s) => s.id === id)!;
    const impl = await bob.implementStrategy({
      runId: run.id,
      candidateId: id,
      workspace: ws,
      issue: run.issue,
      reproduction,
      strategy,
      frozenTestPaths: reproduction.testFiles,
    });
    expect(impl.ok).toBe(true);
    const result = await nodeTest(ws);
    expect(result.failed).toEqual(expectedFailures);
    expect(result.failed).not.toContain("expired refresh token returns 401, not 500");
  });
});
