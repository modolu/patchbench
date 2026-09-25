import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunId, isSafeId } from "@/lib/ids";
import { resolveRelativeWithin, resolveWithinRoots } from "@/lib/paths";
import { makeTempDir } from "../helpers/factories";

let tmp: Awaited<ReturnType<typeof makeTempDir>>;
beforeEach(async () => {
  tmp = await makeTempDir();
});
afterEach(() => tmp.cleanup());

describe("path safety", () => {
  it("accepts paths beneath an allowed root, including not-yet-created ones", async () => {
    await mkdir(path.join(tmp.dir, "repo"));
    expect(await resolveWithinRoots(path.join(tmp.dir, "repo", "src"), [path.join(tmp.dir, "repo")])).toBe(
      path.join(tmp.dir, "repo", "src"),
    );
  });

  it("rejects traversal and sibling-prefix escapes", async () => {
    const root = path.join(tmp.dir, "repo");
    await mkdir(root);
    await mkdir(path.join(tmp.dir, "repo-evil"));
    expect(await resolveWithinRoots(path.join(root, "..", "outside"), [root])).toBeNull();
    expect(await resolveWithinRoots(path.join(tmp.dir, "repo-evil"), [root])).toBeNull();
  });

  it("rejects symlinks that point outside the root", async () => {
    const root = path.join(tmp.dir, "repo");
    await mkdir(root);
    await symlink(tmp.dir, path.join(root, "link"));
    expect(await resolveWithinRoots(path.join(root, "link", "x"), [root])).toBeNull();
  });

  it("resolveRelativeWithin rejects absolute and dot-dot paths", async () => {
    expect(await resolveRelativeWithin(tmp.dir, "/etc/passwd")).toBeNull();
    expect(await resolveRelativeWithin(tmp.dir, "a/../../b")).toBeNull();
    expect(await resolveRelativeWithin(tmp.dir, "test/a.test.ts")).toBe(path.join(tmp.dir, "test/a.test.ts"));
  });
});

describe("ids", () => {
  it.each(["a", "run-1", "candidate-a"])("accepts %s", (id) => expect(isSafeId(id)).toBe(true));
  it.each(["", "-a", "a-", "A", "a/b", "..", "a--b", "a b", "x".repeat(65)])("rejects %j", (id) =>
    expect(isSafeId(id)).toBe(false),
  );
  it("creates sortable deterministic run ids", () => {
    expect(createRunId(new Date("2026-09-25T12:34:56.000Z"), () => "abc123")).toBe("run-20260925123456-abc123");
  });
});
