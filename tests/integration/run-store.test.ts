import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pbError } from "@/domain/errors";
import { transitionCandidate, transitionRun } from "@/server/runs/lifecycle";
import { FileRunStore } from "@/server/runs/store";
import { fixedClock } from "@/lib/time";
import { makeRun, makeTempDir } from "../helpers/factories";

let tmp: Awaited<ReturnType<typeof makeTempDir>>;
let store: FileRunStore;
const clock = fixedClock("2026-09-25T12:00:00.000Z");

beforeEach(async () => {
  tmp = await makeTempDir();
  store = new FileRunStore(path.join(tmp.dir, ".patchbench"), clock);
});
afterEach(() => tmp.cleanup());

describe("FileRunStore", () => {
  it("creates run.json and an initial run.created event", async () => {
    const run = makeRun();
    const created = await store.createRun(run);
    expect(created.ok).toBe(true);
    const loaded = await store.loadRun(run.id);
    expect(loaded).toEqual({ ok: true, value: run });
    const events = await store.readEvents(run.id);
    expect(events).toEqual([
      { seq: 1, runId: run.id, type: "run.created", at: "2026-09-25T12:00:00.000Z", data: { status: "CREATED" } },
    ]);
  });

  it("refuses to create the same run twice", async () => {
    await store.createRun(makeRun());
    const again = await store.createRun(makeRun());
    expect(again.ok).toBe(false);
  });

  it("appends events with strictly increasing seq under concurrency", async () => {
    const run = makeRun();
    await store.createRun(run);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.appendEvent(run.id, { type: "test.tick", data: { i } })));
    const seqs = (await store.readEvents(run.id)).map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });

  it("continues seq from disk after reload with a fresh store", async () => {
    const run = makeRun();
    await store.createRun(run);
    await store.appendEvent(run.id, { type: "baseline.started" });
    const reopened = new FileRunStore(store.runtimeRoot, clock);
    const next = await reopened.appendEvent(run.id, { type: "baseline.completed" });
    expect(next.seq).toBe(3);
  });

  it("ignores a torn trailing event line", async () => {
    const run = makeRun();
    await store.createRun(run);
    await appendFile(path.join(store.runDir(run.id), "events.jsonl"), '{"seq":2,"runId"');
    expect(await store.readEvents(run.id)).toHaveLength(1);
  });

  it("reports missing and corrupt runs as typed errors", async () => {
    const missing = await store.loadRun("run-missing");
    expect(missing.ok || missing.error.code).toBe("RUN_NOT_FOUND");
    const run = makeRun();
    await store.createRun(run);
    await writeFile(path.join(store.runDir(run.id), "run.json"), '{"id": 1}');
    const corrupt = await store.loadRun(run.id);
    expect(corrupt.ok || corrupt.error.code).toBe("RUN_CORRUPT");
  });

  it("rejects unsafe run ids before touching the filesystem", () => {
    expect(() => store.runDir("../../etc")).toThrow(/Unsafe run id/);
  });

  it("saveRun leaves no temp files behind", async () => {
    const run = makeRun();
    await store.createRun(run);
    await store.saveRun({ ...run, status: "BASELINING" });
    const raw = await readFile(path.join(store.runDir(run.id), "run.json"), "utf8");
    expect(JSON.parse(raw).status).toBe("BASELINING");
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(store.runDir(run.id))).sort()).toEqual(["events.jsonl", "run.json"]);
  });
});

describe("transitionRun", () => {
  it("persists status and logs the transition event", async () => {
    const run = makeRun();
    await store.createRun(run);
    const moved = await transitionRun(store, run.id, "BASELINING", { clock });
    expect(moved.ok).toBe(true);
    expect((await store.loadRun(run.id)).ok && (await store.loadRun(run.id))).toMatchObject({ value: { status: "BASELINING" } });
    const last = (await store.readEvents(run.id)).at(-1);
    expect(last).toMatchObject({ type: "run.status_changed", data: { from: "CREATED", to: "BASELINING" } });
  });

  it("rejects invalid transitions without writing anything", async () => {
    const run = makeRun();
    await store.createRun(run);
    const moved = await transitionRun(store, run.id, "PATCHING", { clock });
    expect(moved.ok || moved.error.code).toBe("INVALID_TRANSITION");
    expect(await store.readEvents(run.id)).toHaveLength(1);
    expect((await store.loadRun(run.id)).ok && (await store.loadRun(run.id))).toMatchObject({ value: { status: "CREATED" } });
  });

  it("records cancellation and failure details", async () => {
    const run = makeRun();
    await store.createRun(run);
    await transitionRun(store, run.id, "BASELINING", { clock });
    const failed = await transitionRun(store, run.id, "BLOCKED_BASELINE", {
      clock,
      failure: pbError("REPO_DIRTY", "Working tree has uncommitted changes."),
    });
    expect(failed.ok && failed.value.failure?.code).toBe("REPO_DIRTY");
    const cancelAfterTerminal = await transitionRun(store, run.id, "CANCELLED", { clock });
    expect(cancelAfterTerminal.ok).toBe(false);
  });
});

describe("transitionCandidate", () => {
  const withCandidate = () =>
    makeRun({ candidates: [{ id: "a", strategyId: "a", worktreePath: "/w/a", branchName: "patchbench/run-20260925120000-abc123/a", status: "PENDING" }] });

  it("persists the candidate status and logs a candidate event", async () => {
    const run = withCandidate();
    await store.createRun(run);
    const moved = await transitionCandidate(store, run.id, "a", "IMPLEMENTING", {}, { clock });
    expect(moved.ok && moved.value.status).toBe("IMPLEMENTING");
    expect((await store.readEvents(run.id)).at(-1)).toMatchObject({ type: "candidate.status_changed", candidateId: "a", data: { from: "PENDING", to: "IMPLEMENTING" } });
  });

  it("rejects invalid candidate transitions and unknown candidates without writing", async () => {
    const run = withCandidate();
    await store.createRun(run);
    const skip = await transitionCandidate(store, run.id, "a", "REJECTED", {}, { clock });
    expect(skip.ok || skip.error.code).toBe("INVALID_TRANSITION");
    const missing = await transitionCandidate(store, run.id, "z", "IMPLEMENTING", {}, { clock });
    expect(missing.ok || missing.error.code).toBe("RUN_CORRUPT");
    expect(await store.readEvents(run.id)).toHaveLength(1);
  });
});
