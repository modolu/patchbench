import { describe, expect, it } from "vitest";
import { candidateBranchName, candidateWorktreePath, isPatchBenchBranch } from "@/server/git/worktrees";

describe("worktree naming", () => {
  it("builds namespaced branch names and paths", () => {
    expect(candidateBranchName("run-1", "a")).toBe("patchbench/run-1/a");
    expect(candidateWorktreePath("/x/.patchbench", "run-1", "a")).toBe("/x/.patchbench/worktrees/run-1/a");
  });

  it("refuses unsafe ids that could escape the runtime directory", () => {
    expect(() => candidateWorktreePath("/x/.patchbench", "..", "a")).toThrow();
    expect(() => candidateBranchName("run-1", "a/../../main")).toThrow();
  });

  it("only recognises branches PatchBench created", () => {
    expect(isPatchBenchBranch("patchbench/run-1/a")).toBe(true);
    expect(isPatchBenchBranch("main")).toBe(false);
    expect(isPatchBenchBranch("patchbench/run-1")).toBe(false);
    expect(isPatchBenchBranch("patchbench/run-1/a/b")).toBe(false);
    expect(isPatchBenchBranch("patchbench/RUN/a")).toBe(false);
  });
});
