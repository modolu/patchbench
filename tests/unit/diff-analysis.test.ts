import { describe, expect, it } from "vitest";
import { summarizeDiff } from "@/server/verification/diff-analysis";

describe("summarizeDiff", () => {
  const entries = [
    { path: "test/refresh-expired.test.ts", insertions: 8, deletions: 0 },
    { path: "src/app.ts", insertions: 3, deletions: 1 },
    { path: "package.json", insertions: 1, deletions: 1 },
    { path: "tsconfig.build.json", insertions: 2, deletions: 0 },
    { path: "assets/logo.png", insertions: null, deletions: null },
  ];

  it("excludes frozen regression paths from implementation metrics", () => {
    const s = summarizeDiff(entries, ["test/refresh-expired.test.ts"]);
    expect(s.files.map((f) => f.path)).toEqual(["assets/logo.png", "package.json", "src/app.ts", "tsconfig.build.json"]);
    expect(s).toMatchObject({ filesChanged: 4, insertions: 6, deletions: 2, dependencyManifestChanged: true, configFilesTouched: ["tsconfig.build.json"] });
  });

  it("reports a clean diff when only the frozen test changed", () => {
    expect(summarizeDiff(entries.slice(0, 1), ["test/refresh-expired.test.ts"])).toEqual({
      filesChanged: 0, insertions: 0, deletions: 0, files: [], dependencyManifestChanged: false, configFilesTouched: [],
    });
  });
});
