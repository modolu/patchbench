import { createHash, randomBytes } from "node:crypto";
import { link, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pbError, type PatchBenchError } from "@/domain/errors";
import type { FrozenFile, PatchBenchRun } from "@/domain/run";
import { resolveRelativeWithin } from "@/lib/paths";
import { err, ok, type Result } from "@/lib/result";
import { isCanonicalRelativePath } from "../bob/schemas";
import type { GitAdapter } from "../git/git-adapter";
import type { FileRunStore } from "../runs/store";

export const PATCH_FILE = "regression.patch";
export const PATCH_HASH_FILE = "regression.sha256";

export interface FrozenRegression {
  patchPath: string;
  patchSha256: string;
  files: FrozenFile[];
}

export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

export const reproductionDir = (store: FileRunStore, runId: string): string => path.join(store.runDir(runId), "reproduction");

/** `sha256sum`-compatible line. */
export const formatHashFile = (hash: string): string => `${hash}  ${PATCH_FILE}\n`;

/** Paths named in `diff --git a/<p> b/<p>` headers, in patch order. */
export function patchPaths(patch: string): string[] {
  return [...patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map((m) => m[2]!);
}

export interface NewFile {
  path: string;
  content: Buffer;
  executable: boolean;
}

/**
 * Builds a `git apply`-compatible patch that creates `files`, directly from
 * their bytes. Deliberately not `git diff`: runner output is secret-redacted
 * (e.g. `refreshToken: "..."`), which would corrupt a byte-exact artifact, and
 * this keeps the patch independent of user Git config. Text (UTF-8) only.
 */
export function buildNewFilesPatch(files: readonly NewFile[]): Result<string, string> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let out = "";
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (!isCanonicalRelativePath(f.path) || /[\s"]/.test(f.path)) return err(`${f.path}: unsupported path`);
    if (f.content.length === 0) return err(`${f.path}: empty file`);
    let text: string;
    try {
      text = decoder.decode(f.content);
    } catch {
      return err(`${f.path}: not UTF-8 text`);
    }
    if (text.includes("\0")) return err(`${f.path}: binary content`);
    const endsWithNewline = text.endsWith("\n");
    const lines = (endsWithNewline ? text.slice(0, -1) : text).split("\n");
    out += `diff --git a/${f.path} b/${f.path}\n`;
    out += `new file mode ${f.executable ? "100755" : "100644"}\n`;
    out += `--- /dev/null\n+++ b/${f.path}\n`;
    out += `@@ -0,0 +1,${lines.length} @@\n`;
    out += lines.map((l) => `+${l}\n`).join("");
    if (!endsWithNewline) out += "\\ No newline at end of file\n";
  }
  return ok(out);
}

/** Atomic + exclusive: the destination either does not exist or is complete. */
export async function writeFileExclusive(filePath: string, contents: string): Promise<Result<void, PatchBenchError>> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, contents, "utf8");
  try {
    await link(tmp, filePath);
    return ok(undefined);
  } catch (cause) {
    return err(pbError("REGRESSION_TEST_MUTATED", "Refusing to overwrite an existing frozen artifact.", { detail: `${path.basename(filePath)}: ${String(cause)}` }));
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

export type FileViolation = { path: string; kind: "deleted" | "modified" | "not_regular" | "outside_workspace" };

/** SHA-256 of a workspace file that must be a regular file resolving inside the workspace. */
export async function hashWorkspaceFile(workspace: string, rel: string): Promise<Result<string, FileViolation>> {
  if (!isCanonicalRelativePath(rel)) return err({ path: rel, kind: "outside_workspace" });
  const resolved = await resolveRelativeWithin(workspace, rel);
  const lexical = path.join(workspace, rel);
  let st;
  try {
    st = await lstat(lexical);
  } catch {
    return err({ path: rel, kind: "deleted" });
  }
  if (!st.isFile()) return err({ path: rel, kind: "not_regular" });
  if (!resolved) return err({ path: rel, kind: "outside_workspace" });
  return ok(sha256(await readFile(lexical)));
}

/** Persists the frozen patch and its hash exactly once. */
export async function writeFrozenArtifact(
  store: FileRunStore,
  runId: string,
  patch: string,
): Promise<Result<{ patchPath: string; patchSha256: string }, PatchBenchError>> {
  const dir = reproductionDir(store, runId);
  const patchPath = path.join(dir, PATCH_FILE);
  const patchSha256 = sha256(patch);
  const written = await writeFileExclusive(patchPath, patch);
  if (!written.ok) return written;
  const hashed = await writeFileExclusive(path.join(dir, PATCH_HASH_FILE), formatHashFile(patchSha256));
  if (!hashed.ok) return hashed;
  return ok({ patchPath, patchSha256 });
}

/**
 * Loads the frozen regression for a run, re-hashing the stored patch and
 * cross-checking it against both `regression.sha256` and run.json.
 */
export async function loadFrozenArtifact(store: FileRunStore, run: PatchBenchRun): Promise<Result<FrozenRegression, PatchBenchError>> {
  const repro = run.reproduction;
  if (repro?.outcome !== "REPRODUCED" || !repro.frozenPatchSha256 || !repro.frozenFiles?.length) {
    return err(pbError("REPRO_NOT_CONFIRMED", "Run has no frozen regression artifact."));
  }
  const dir = reproductionDir(store, run.id);
  const patchPath = path.join(dir, PATCH_FILE);
  let patch: string;
  let hashLine: string;
  try {
    [patch, hashLine] = await Promise.all([readFile(patchPath, "utf8"), readFile(path.join(dir, PATCH_HASH_FILE), "utf8")]);
  } catch (cause) {
    return err(pbError("REGRESSION_TEST_MUTATED", "Frozen regression artifact is missing.", { detail: String(cause) }));
  }
  const actual = sha256(patch);
  if (hashLine !== formatHashFile(repro.frozenPatchSha256) || actual !== repro.frozenPatchSha256) {
    return err(
      pbError("REGRESSION_TEST_MUTATED", "Frozen regression artifact does not match its recorded hash.", {
        detail: `run.json=${repro.frozenPatchSha256} file=${hashLine.trim()} actual=${actual}`,
      }),
    );
  }
  const declared = repro.frozenFiles.map((f) => f.path).sort();
  if (JSON.stringify(patchPaths(patch).sort()) !== JSON.stringify(declared)) {
    return err(pbError("REGRESSION_TEST_MUTATED", "Frozen patch touches files other than the frozen tests.", { detail: patchPaths(patch).join(", ") }));
  }
  return ok({ patchPath, patchSha256: actual, files: repro.frozenFiles });
}

/** Checks every frozen test file still has its frozen bytes. */
export async function verifyFrozenRegression(workspace: string, files: readonly FrozenFile[]): Promise<Result<void, PatchBenchError>> {
  const violations: FileViolation[] = [];
  for (const f of files) {
    const h = await hashWorkspaceFile(workspace, f.path);
    if (!h.ok) violations.push(h.error);
    else if (h.value !== f.sha256) violations.push({ path: f.path, kind: "modified" });
  }
  if (violations.length === 0) return ok(undefined);
  return err(
    pbError("REGRESSION_TEST_MUTATED", "The frozen regression test was modified or removed.", {
      detail: JSON.stringify(violations),
      nextAction: "Reject this candidate; the benchmark must stay identical for every candidate.",
    }),
  );
}

/** Injects the frozen regression into a clean baseline workspace, then verifies it. */
export async function applyFrozenRegression(git: GitAdapter, workspace: string, frozen: FrozenRegression): Promise<Result<void, PatchBenchError>> {
  if (sha256(await readFile(frozen.patchPath, "utf8")) !== frozen.patchSha256) {
    return err(pbError("REGRESSION_TEST_MUTATED", "Frozen patch changed on disk before injection."));
  }
  const check = await git.applyPatch(workspace, frozen.patchPath, { check: true });
  if (!check.ok) return err(pbError("COMMAND_FAILED", "Frozen regression patch does not apply to this workspace.", { detail: check.error.detail }));
  const applied = await git.applyPatch(workspace, frozen.patchPath, { check: false });
  if (!applied.ok) return err(pbError("COMMAND_FAILED", "Applying the frozen regression patch failed.", { detail: applied.error.detail }));
  return verifyFrozenRegression(workspace, frozen.files);
}
