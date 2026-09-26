import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PatchBenchRun } from "@/domain/run";
import { FileRunStore } from "@/server/runs/store";
import { uiConfig, type UiConfig } from "@/server/ui/config";
import { listRunSummaries, loadRunView, type RunView } from "@/server/ui/run-reader";
import { findAbsolutePaths } from "@/server/ui/sanitize";
import { makeRun, makeTempDir } from "../helpers/factories";
import { REPO_ROOT } from "../helpers/scenario";

const SHOWCASE_ROOT = path.join(REPO_ROOT, "showcase");
let RUN_ID: string;
let tmp: Awaited<ReturnType<typeof makeTempDir>>;
let local: UiConfig;
let showcase: UiConfig;

const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];

beforeAll(async () => {
  RUN_ID = (await readdir(path.join(SHOWCASE_ROOT, "runs")))[0]!;
  tmp = await makeTempDir();
  const env = { PATCHBENCH_RUNTIME_ROOT: path.join(tmp.dir, ".patchbench"), PATCHBENCH_SHOWCASE_ROOT: SHOWCASE_ROOT };
  local = uiConfig({ ...env, PATCHBENCH_MODE: "local" }, tmp.dir);
  showcase = uiConfig({ ...env, PATCHBENCH_MODE: "showcase" }, tmp.dir);
});
afterAll(() => tmp.cleanup());

async function view(id = RUN_ID, config = showcase): Promise<RunView> {
  const r = await loadRunView(id, config);
  if (!r.ok) throw new Error(r.message);
  return r.view;
}

describe("captured fixture run (showcase)", () => {
  it("renders A eligible, B rejected for exactly two new failures, C eligible, run COMPLETE", async () => {
    const v = await view();
    expect(v.run.status).toBe("COMPLETE");
    expect(v.matrixSource).toBe("report");
    expect(v.matrix.candidates.map((c) => [c.id, c.status])).toEqual([["a", "ELIGIBLE"], ["b", "REJECTED"], ["c", "ELIGIBLE"]]);
    const b = v.run.candidates.find((c) => c.id === "b")!.verification!;
    expect(b.newFailures).toHaveLength(2);
    expect(v.matrix.rows.find((r) => r.key === "new_failures")!.candidateValues.b).toMatchObject({ status: "fail", display: "2", detail: b.newFailures });
  });

  it("uses real fixture counts: 12 baseline tests, 13 candidate tests incl. the frozen regression", async () => {
    const v = await view();
    expect(v.run.baseline!.checks.find((c) => c.name === "test")!.summary!.tests).toBe(12);
    for (const c of v.run.candidates) expect(c.verification!.tests!.summary!.tests).toBe(13);
  });

  it("classifies lint as informational (not required) and typecheck/build as hard gates", async () => {
    const v = await view();
    const kind = (key: string) => v.matrix.rows.find((r) => r.key === key)!.kind;
    expect(kind("lint")).toBe("informational");
    expect(kind("typecheck")).toBe("hard-gate");
    expect(kind("build")).toBe("hard-gate");
    expect(kind("new_failures")).toBe("hard-gate");
    expect(kind("preserved_failures")).toBe("informational");
  });

  it("exposes persisted diffs, regression patch, and redacted logs only at declared paths", async () => {
    const v = await view();
    expect(v.diffs.b).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(v.regressionPatch).toContain("test/refresh-expired.test.ts");
    expect(v.logs.find((l) => l.key === "candidate:b:test")).toMatchObject({ failed: true });
    expect(v.logs.find((l) => l.key === "candidate:b:test")!.content).toContain("not ok");
    expect(v.logs.every((l) => l.content !== null)).toBe(true);
  });

  it("contains no absolute local filesystem paths anywhere in the view", async () => {
    const v = await view();
    const leaks = strings(v).flatMap(findAbsolutePaths);
    expect(leaks).toEqual([]);
    expect(JSON.stringify(v)).not.toContain(REPO_ROOT);
  });

  it("is listed as a recent run", async () => {
    const runs = await listRunSummaries(showcase);
    expect(runs[0]).toMatchObject({ id: RUN_ID, source: "showcase", status: "COMPLETE", eligible: 2, rejected: 1, repoName: "auth-expiry-bug" });
  });
});

describe("run-store boundary", () => {
  it.each(["../../etc/passwd", "..", "run/../../x", "RUN-UPPER", "%2e%2e", "", "a--b", `/${"x".repeat(10)}`])("rejects unsafe run id %j", async (id) => {
    const r = await loadRunView(id, local);
    expect(r).toMatchObject({ ok: false, kind: "invalid-id" });
  });

  it("returns not-found for a safe but unknown id", async () => {
    expect(await loadRunView("run-20990101000000-ffffff", local)).toMatchObject({ ok: false, kind: "not-found" });
  });

  it("returns a safe corrupt state for invalid run.json, without schema detail", async () => {
    const dir = path.join(local.runtimeRoot, "runs", "run-corrupt-json");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "run.json"), '{"id": "run-corrupt-json", "status": 42}');
    const r = await loadRunView("run-corrupt-json", local);
    expect(r).toMatchObject({ ok: false, kind: "corrupt" });
    if (!r.ok) expect(r.message).not.toMatch(/Expected|invalid_type|\//);
  });

  it("falls back to a derived matrix when report.json is corrupt", async () => {
    const id = "run-bad-report";
    await cp(path.join(SHOWCASE_ROOT, "runs", RUN_ID), path.join(local.runtimeRoot, "runs", id), { recursive: true });
    const store = new FileRunStore(local.runtimeRoot);
    const loaded = await store.loadRun(id);
    if (!loaded.ok) throw new Error(loaded.error.message);
    await store.saveRun({ ...loaded.value, id });
    await writeFile(path.join(store.runDir(id), "report.json"), "{not json");
    const v = await view(id, local);
    expect(v.matrixSource).toBe("derived");
    expect(v.matrix.candidates.map((c) => c.status)).toEqual(["ELIGIBLE", "REJECTED", "ELIGIBLE"]);
  });

  it("never reads a log path that escapes the run directory", async () => {
    const id = "run-evil-logs";
    const store = new FileRunStore(local.runtimeRoot);
    await writeFile(path.join(tmp.dir, "secret.txt"), "TOP SECRET");
    const run: PatchBenchRun = makeRun({
      id,
      status: "BASELINING",
      baseline: {
        commitSha: "a".repeat(40),
        durationMs: 1,
        failures: [],
        checks: [
          { name: "test", passed: true, exitCode: 0, durationMs: 1, timedOut: false, failures: [], logPath: "../../../secret.txt" },
          { name: "lint", passed: true, exitCode: 0, durationMs: 1, timedOut: false, failures: [], logPath: path.join(tmp.dir, "secret.txt") },
        ],
      },
    });
    expect((await store.createRun(run)).ok).toBe(true);
    const v = await view(id, local);
    expect(v.logs.map((l) => l.content)).toEqual([null, null]);
    expect(JSON.stringify(v)).not.toContain("TOP SECRET");
  });

  it("scrubs absolute paths when a local run is served in showcase-style output", async () => {
    const id = "run-local-paths";
    const store = new FileRunStore(local.runtimeRoot);
    const base = makeRun();
    await store.createRun(makeRun({ id, repository: { ...base.repository, root: "/Users/someone/dev/private-repo" } }));
    const localView = await view(id, local);
    expect(localView.run.repository.root).toBe("/Users/someone/dev/private-repo");
    // Showcase mode never reads the local runtime at all.
    expect(await loadRunView(id, showcase)).toMatchObject({ ok: false, kind: "not-found" });
  });
});

describe("mode config", () => {
  it("defaults to local and treats unknown values as showcase", () => {
    expect(uiConfig({}, "/x").mode).toBe("local");
    expect(uiConfig({ PATCHBENCH_MODE: "showcase" }, "/x").mode).toBe("showcase");
    expect(uiConfig({ PATCHBENCH_MODE: "prod" }, "/x").mode).toBe("showcase");
  });
});
