import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeBobAdapter } from "@/server/bob/fake-adapter";
import { ReproductionProposalSchema, StrategiesSchema, isCanonicalRelativePath } from "@/server/bob/schemas";
import { makeRun, makeTempDir } from "../helpers/factories";
import { FAKE_SCENARIO_DIR } from "../helpers/scenario";

let tmp: Awaited<ReturnType<typeof makeTempDir>>;
beforeEach(async () => {
  tmp = await makeTempDir();
});
afterEach(() => tmp.cleanup());

const run = makeRun();
const bob = new FakeBobAdapter(FAKE_SCENARIO_DIR);

async function workspace(name: string): Promise<string> {
  const dir = path.join(tmp.dir, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function reproduce(ws: string) {
  const r = await bob.generateReproduction({ runId: run.id, workspace: ws, repository: run.repository, issue: run.issue });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("FakeBobAdapter", () => {
  it("is deterministic across invocations", async () => {
    const [w1, w2] = [await workspace("one"), await workspace("two")];
    expect(await reproduce(w1)).toEqual(await reproduce(w2));
    const test1 = await readFile(path.join(w1, "test/refresh-expired.test.ts"), "utf8");
    expect(await readFile(path.join(w2, "test/refresh-expired.test.ts"), "utf8")).toBe(test1);
    const s1 = await bob.generateStrategies({ runId: run.id, workspace: w1, issue: run.issue, reproduction: await reproduce(w1), maxStrategies: 3 });
    const s2 = await bob.generateStrategies({ runId: run.id, workspace: w2, issue: run.issue, reproduction: await reproduce(w2), maxStrategies: 3 });
    expect(s1).toEqual(s2);
  });

  it("reproduction only writes the declared test files", async () => {
    const ws = await workspace("repro");
    const proposal = await reproduce(ws);
    expect(proposal.testFiles).toEqual(["test/refresh-expired.test.ts"]);
    expect(await readdir(ws)).toEqual(["test"]);
  });

  it("returns three distinct strategies and honours maxStrategies", async () => {
    const ws = await workspace("s");
    const reproduction = await reproduce(ws);
    const all = await bob.generateStrategies({ runId: run.id, workspace: ws, issue: run.issue, reproduction, maxStrategies: 3 });
    expect(all.ok && all.value.map((s) => s.id)).toEqual(["a", "b", "c"]);
    const two = await bob.generateStrategies({ runId: run.id, workspace: ws, issue: run.issue, reproduction, maxStrategies: 2 });
    expect(two.ok && two.value).toHaveLength(2);
  });

  it("implements one strategy into the candidate workspace", async () => {
    const ws = await workspace("cand-a");
    const reproduction = await reproduce(ws);
    const strategies = await bob.generateStrategies({ runId: run.id, workspace: ws, issue: run.issue, reproduction, maxStrategies: 3 });
    if (!strategies.ok) throw new Error("strategies");
    const r = await bob.implementStrategy({
      runId: run.id,
      candidateId: "a",
      workspace: ws,
      issue: run.issue,
      reproduction,
      strategy: strategies.value[0]!,
      frozenTestPaths: reproduction.testFiles,
    });
    expect(r).toEqual({
      ok: true,
      value: { changedFiles: ["src/http-errors.ts"], summary: expect.any(String), bobTaskId: `fake-${run.id}-a` },
    });
    expect(await readFile(path.join(ws, "src/http-errors.ts"), "utf8")).toContain("TokenExpiredError");
  });

  it("refuses to overwrite a frozen regression test", async () => {
    const ws = await workspace("frozen");
    const reproduction = await reproduce(ws);
    const strategies = await bob.generateStrategies({ runId: run.id, workspace: ws, issue: run.issue, reproduction, maxStrategies: 3 });
    if (!strategies.ok) throw new Error("strategies");
    const r = await bob.implementStrategy({
      runId: run.id,
      candidateId: "a",
      workspace: ws,
      issue: run.issue,
      reproduction,
      strategy: strategies.value[0]!,
      frozenTestPaths: ["src/http-errors.ts"],
    });
    expect(r.ok || r.error.code).toBe("REGRESSION_TEST_MUTATED");
  });

  it("rejects non-canonical frozen path spellings instead of letting them bypass the check", async () => {
    const ws = await workspace("frozen-alias");
    const reproduction = await reproduce(ws);
    const strategies = await bob.generateStrategies({ runId: run.id, workspace: ws, issue: run.issue, reproduction, maxStrategies: 3 });
    if (!strategies.ok) throw new Error("strategies");
    for (const alias of ["./src/http-errors.ts", "src//http-errors.ts", "src\\http-errors.ts"]) {
      const r = await bob.implementStrategy({
        runId: run.id,
        candidateId: "a",
        workspace: ws,
        issue: run.issue,
        reproduction,
        strategy: strategies.value[0]!,
        frozenTestPaths: [alias],
      });
      expect(r.ok).toBe(false);
    }
  });

  it("reports malformed scenario output as BOB_OUTPUT_INVALID", async () => {
    const scenario = await workspace("bad-scenario");
    await writeFile(path.join(scenario, "strategies.json"), JSON.stringify([{ id: "a" }]));
    const bad = new FakeBobAdapter(scenario);
    const r = await bad.generateStrategies({
      runId: run.id,
      workspace: scenario,
      issue: run.issue,
      reproduction: { testFiles: ["t.ts"], command: "", expectedFailure: "x", notes: "" },
      maxStrategies: 3,
    });
    expect(r.ok || r.error.code).toBe("BOB_OUTPUT_INVALID");
  });
});

describe("Bob output schemas", () => {
  it("reject test paths that escape the workspace", () => {
    const base = { command: "x", expectedFailure: "x", notes: "" };
    expect(ReproductionProposalSchema.safeParse({ ...base, testFiles: ["../evil.ts"] }).success).toBe(false);
    expect(ReproductionProposalSchema.safeParse({ ...base, testFiles: ["/etc/x"] }).success).toBe(false);
    expect(ReproductionProposalSchema.safeParse({ ...base, testFiles: [] }).success).toBe(false);
  });

  it("require canonical POSIX-relative spellings", () => {
    const base = { command: "x", expectedFailure: "x", notes: "" };
    for (const bad of ["./test/foo.ts", "test//foo.ts", "test\\foo.ts", "test/./foo.ts", "test/", "C:/x.ts", "test/../x.ts"]) {
      expect(ReproductionProposalSchema.safeParse({ ...base, testFiles: [bad] }).success, bad).toBe(false);
    }
    expect(isCanonicalRelativePath("test/foo.test.ts")).toBe(true);
  });

  it("require 2–3 strategies", () => {
    const s = { id: "a", title: "t", rationale: "r", likelyFiles: [], tradeoffs: [], implementationBrief: "b" };
    expect(StrategiesSchema.safeParse([s]).success).toBe(false);
    expect(StrategiesSchema.safeParse([s, s, s, s]).success).toBe(false);
    expect(StrategiesSchema.safeParse([s, { ...s, id: "b" }]).success).toBe(true);
  });
});
