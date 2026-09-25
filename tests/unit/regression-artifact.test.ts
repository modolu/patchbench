import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildNewFilesPatch,
  hashWorkspaceFile,
  patchPaths,
  sha256,
  writeFileExclusive,
} from "@/server/reproduction/regression-artifact";
import { isExcludedPath, isTestPath } from "@/server/reproduction/reproduction-service";
import { makeTempDir } from "../helpers/factories";

let tmp: Awaited<ReturnType<typeof makeTempDir>>;
beforeEach(async () => {
  tmp = await makeTempDir();
});
afterEach(() => tmp.cleanup());

const file = (p: string, text: string, executable = false) => ({ path: p, content: Buffer.from(text, "utf8"), executable });

describe("buildNewFilesPatch", () => {
  it("is deterministic, sorted, and marks missing trailing newlines", () => {
    const r = buildNewFilesPatch([file("test/b.test.ts", "b\n"), file("test/a.test.ts", "one\ntwo")]);
    expect(r).toEqual({
      ok: true,
      value:
        "diff --git a/test/a.test.ts b/test/a.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/test/a.test.ts\n@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file\n" +
        "diff --git a/test/b.test.ts b/test/b.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/test/b.test.ts\n@@ -0,0 +1,1 @@\n+b\n",
    });
    expect(patchPaths(r.ok ? r.value : "")).toEqual(["test/a.test.ts", "test/b.test.ts"]);
  });

  it("preserves exact bytes (BOM, CRLF, secret-looking literals) and executable mode", () => {
    const r = buildNewFilesPatch([file("t.test.ts", '﻿const refreshToken: "rt_x";\r\n', true)]);
    expect(r.ok && r.value).toContain('+﻿const refreshToken: "rt_x";\r\n');
    expect(r.ok && r.value).toContain("new file mode 100755");
  });

  it("rejects empty, binary, non-UTF-8 and unusual paths", () => {
    expect(buildNewFilesPatch([file("t.test.ts", "")]).ok).toBe(false);
    expect(buildNewFilesPatch([file("t.test.ts", "a\0b")]).ok).toBe(false);
    expect(buildNewFilesPatch([{ path: "t.test.ts", content: Buffer.from([0xff, 0xfe, 0x00]), executable: false }]).ok).toBe(false);
    expect(buildNewFilesPatch([file("a b.test.ts", "x\n")]).ok).toBe(false);
    expect(buildNewFilesPatch([file("./t.test.ts", "x\n")]).ok).toBe(false);
  });
});

describe("hashWorkspaceFile", () => {
  it("hashes regular files and flags symlinks, missing files and escapes", async () => {
    const ws = path.join(tmp.dir, "ws");
    await mkdir(path.join(ws, "test"), { recursive: true });
    await writeFile(path.join(ws, "test", "a.ts"), "a");
    expect(await hashWorkspaceFile(ws, "test/a.ts")).toEqual({ ok: true, value: sha256("a") });
    expect(await hashWorkspaceFile(ws, "test/missing.ts")).toMatchObject({ ok: false, error: { kind: "deleted" } });

    await writeFile(path.join(tmp.dir, "outside.ts"), "o");
    await symlink(path.join(tmp.dir, "outside.ts"), path.join(ws, "test", "link.ts"));
    expect(await hashWorkspaceFile(ws, "test/link.ts")).toMatchObject({ ok: false, error: { kind: "not_regular" } });

    await mkdir(path.join(tmp.dir, "elsewhere"));
    await writeFile(path.join(tmp.dir, "elsewhere", "x.ts"), "x");
    await symlink(path.join(tmp.dir, "elsewhere"), path.join(ws, "linked-dir"));
    expect(await hashWorkspaceFile(ws, "linked-dir/x.ts")).toMatchObject({ ok: false, error: { kind: "outside_workspace" } });
    expect(await hashWorkspaceFile(ws, "../outside.ts")).toMatchObject({ ok: false, error: { kind: "outside_workspace" } });
  });
});

describe("writeFileExclusive", () => {
  it("writes once and refuses to overwrite", async () => {
    const target = path.join(tmp.dir, "a", "regression.patch");
    expect((await writeFileExclusive(target, "one")).ok).toBe(true);
    const second = await writeFileExclusive(target, "two");
    expect(second.ok || second.error.code).toBe("REGRESSION_TEST_MUTATED");
    expect(await readFile(target, "utf8")).toBe("one");
  });
});

describe("test path policy", () => {
  it.each([
    ["test/foo.ts", true],
    ["tests/unit/foo.ts", true],
    ["src/__tests__/foo.ts", true],
    ["src/foo.test.ts", true],
    ["src/foo.spec.tsx", true],
    ["src/foo.ts", false],
    ["testing/foo.ts", false],
    ["src/contest.ts", false],
  ])("isTestPath(%s) = %s", (p, expected) => {
    expect(isTestPath(p)).toBe(expected);
  });

  it("matches excluded path segments", () => {
    const patterns = [".git", "node_modules", ".env", ".env.*"];
    expect(isExcludedPath("test/.env.local", patterns)).toBe(true);
    expect(isExcludedPath("node_modules/x/test/a.test.ts", patterns)).toBe(true);
    expect(isExcludedPath("test/env.test.ts", patterns)).toBe(false);
  });
});
