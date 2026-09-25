import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitWorktreeManager, candidateWorktreePath, reproductionWorkspacePath } from "@/server/git/worktrees";
import { makeBaselineRepo, treeFingerprint } from "../helpers/baseline-repo";
import { makeTempDir } from "../helpers/factories";
import { git } from "../helpers/git";

const RUN = "run-20260925120000-abc123";
let tmp: Awaited<ReturnType<typeof makeTempDir>>;
let primary: string;
let sha: string;
let runtime: string;
let manager: GitWorktreeManager;

beforeEach(async () => {
  tmp = await makeTempDir();
  ({ primary, sha } = await makeBaselineRepo(tmp.dir));
  runtime = path.join(tmp.dir, ".patchbench");
  manager = new GitWorktreeManager(runtime);
});
afterEach(() => tmp.cleanup());

const exists = (p: string) => access(p).then(() => true, () => false);
const branches = () => git(primary, "branch", "--format=%(refname:short)").split("\n").filter(Boolean).sort();

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string; detail?: string } }): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message} ${r.error.detail ?? ""}`);
  return r.value;
}

describe("GitWorktreeManager", () => {
  it("creates isolated candidate worktrees from the identical baseline SHA without touching the primary", async () => {
    const before = await treeFingerprint(primary);
    const a = unwrap(await manager.create({ repoRoot: primary, runId: RUN, candidateId: "a", baseSha: sha }));
    const b = unwrap(await manager.create({ repoRoot: primary, runId: RUN, candidateId: "b", baseSha: sha }));

    expect(a).toEqual({ runId: RUN, candidateId: "a", path: candidateWorktreePath(runtime, RUN, "a"), branchName: `patchbench/${RUN}/a`, baseSha: sha });
    for (const wt of [a, b]) {
      expect(git(wt.path, "rev-parse", "HEAD")).toBe(sha);
      expect(git(wt.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(wt.branchName);
      expect(git(wt.path, "status", "--porcelain")).toBe("");
    }

    // Changing one candidate does not leak into another.
    await writeFile(path.join(a.path, "src", "app.ts"), "// candidate a\n");
    expect(git(b.path, "status", "--porcelain")).toBe("");
    const c = unwrap(await manager.create({ repoRoot: primary, runId: RUN, candidateId: "c", baseSha: sha }));
    expect(git(c.path, "status", "--porcelain")).toBe("");

    expect(git(primary, "rev-parse", "HEAD")).toBe(sha);
    expect(git(primary, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(primary, "status", "--porcelain")).toBe("");
    expect(await treeFingerprint(primary)).toEqual(before);

    expect((unwrap(await manager.list(primary, RUN))).map((w) => w.candidateId)).toEqual(["a", "b", "c"]);
  });

  it("creates a detached, branchless reproduction workspace", async () => {
    const ws = unwrap(await manager.createReproduction({ repoRoot: primary, runId: RUN, baseSha: sha }));
    expect(ws.path).toBe(reproductionWorkspacePath(runtime, RUN));
    expect(git(ws.path, "rev-parse", "HEAD")).toBe(sha);
    expect(git(ws.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    expect(branches()).toEqual(["main"]);
    expect(unwrap(await manager.list(primary, RUN))).toEqual([]);
    unwrap(await manager.removeReproduction(ws, primary));
    expect(await exists(ws.path)).toBe(false);
  });

  it("refuses unsafe, reserved or duplicate ids and existing targets", async () => {
    for (const candidateId of ["..", "A", "reproduction", "a/b"]) {
      const r = await manager.create({ repoRoot: primary, runId: RUN, candidateId, baseSha: sha });
      expect(r.ok, candidateId).toBe(false);
    }
    expect((await manager.create({ repoRoot: primary, runId: "../x", candidateId: "a", baseSha: sha })).ok).toBe(false);
    expect((await manager.create({ repoRoot: primary, runId: RUN, candidateId: "a", baseSha: "main" })).ok).toBe(false);

    unwrap(await manager.create({ repoRoot: primary, runId: RUN, candidateId: "a", baseSha: sha }));
    const dup = await manager.create({ repoRoot: primary, runId: RUN, candidateId: "a", baseSha: sha });
    expect(dup.ok || dup.error.code).toBe("WORKTREE_CREATE_FAILED");

    // A pre-existing branch with the candidate's name is never reused or overwritten.
    git(primary, "branch", `patchbench/${RUN}/b`);
    const clash = await manager.create({ repoRoot: primary, runId: RUN, candidateId: "b", baseSha: sha });
    expect(clash.ok || clash.error.detail).toBe(`patchbench/${RUN}/b`);
  });

  it("refuses worktree paths that escape the runtime directory through a symlink", async () => {
    const outside = path.join(tmp.dir, "outside");
    await mkdir(outside);
    await mkdir(path.join(runtime, "worktrees"), { recursive: true });
    await symlink(outside, path.join(runtime, "worktrees", RUN));
    const r = await manager.create({ repoRoot: primary, runId: RUN, candidateId: "a", baseSha: sha });
    expect(r.ok || r.error.code).toBe("PATH_OUTSIDE_ALLOWED_ROOT");
  });

  it("cleans up only PatchBench-owned worktrees and branches", async () => {
    const a = unwrap(await manager.create({ repoRoot: primary, runId: RUN, candidateId: "a", baseSha: sha }));
    const b = unwrap(await manager.create({ repoRoot: primary, runId: RUN, candidateId: "b", baseSha: sha }));
    git(primary, "branch", "feature/keep");

    // Forged descriptors pointing at user state are rejected before any git call.
    for (const forged of [
      { ...a, branchName: "main" },
      { ...a, branchName: "feature/keep" },
      { ...a, path: primary },
      { ...a, candidateId: "../../x" },
    ]) {
      const r = await manager.remove(forged, primary);
      expect(r.ok || r.error.code).toBe("PATH_OUTSIDE_ALLOWED_ROOT");
    }
    expect(await exists(a.path)).toBe(true);

    await writeFile(path.join(a.path, "src", "app.ts"), "// dirty candidate\n");
    unwrap(await manager.remove(a, primary));
    expect(await exists(a.path)).toBe(false);
    expect(branches()).toEqual(["feature/keep", "main", `patchbench/${RUN}/b`]);
    expect(await exists(b.path)).toBe(true);
    expect(git(primary, "status", "--porcelain")).toBe("");
  });

  it("reports cleanup failures with diagnostics instead of touching other state", async () => {
    const a = unwrap(await manager.create({ repoRoot: primary, runId: RUN, candidateId: "a", baseSha: sha }));
    unwrap(await manager.remove(a, primary));
    const again = await manager.remove(a, primary);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error.code).toBe("COMMAND_FAILED");
      expect(again.error.detail).toMatch(/worktree remove/);
      expect(again.error.nextAction).toMatch(/worktree list/);
    }
    expect(branches()).toEqual(["main"]);
  });
});
