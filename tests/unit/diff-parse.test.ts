import { describe, expect, it } from "vitest";
import { classifyLogLine, parseUnifiedDiff } from "@/lib/diff-parse";
import { findAbsolutePaths, scrubAbsolutePaths, scrubValue } from "@/server/ui/sanitize";

const PATCH = `diff --git a/src/app.ts b/src/app.ts
index 46531b4..a4f1bdc 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -28,3 +28,4 @@ export function x() {
 keep
-old
+new
+more
`;

describe("parseUnifiedDiff", () => {
  it("parses files, counts, and line numbers", () => {
    const [f] = parseUnifiedDiff(PATCH);
    expect(f).toMatchObject({ path: "src/app.ts", additions: 2, deletions: 1 });
    expect(f!.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([["hunk", null, null], ["ctx", 28, 28], ["del", 29, null], ["add", null, 29], ["add", null, 30]]);
  });
  it("returns nothing for empty input", () => expect(parseUnifiedDiff("")).toEqual([]));
});

describe("classifyLogLine", () => {
  it("classifies TAP and runner lines", () => {
    expect(classifyLogLine("$ pnpm run test")).toBe("cmd");
    expect(classifyLogLine("not ok 1 - broke")).toBe("bad");
    expect(classifyLogLine("ok 2 - fine")).toBe("ok");
    expect(classifyLogLine("token: [REDACTED]")).toBe("redacted");
  });
});

describe("showcase sanitization", () => {
  it("finds and scrubs absolute machine paths", () => {
    const text = "at file:///Users/ada/dev/repo/test/a.ts:1 and /private/var/folders/x/y and C:\\Users\\ada\\r";
    expect(findAbsolutePaths(text)).toHaveLength(3);
    const scrubbed = scrubAbsolutePaths(text);
    expect(findAbsolutePaths(scrubbed)).toEqual([]);
    expect(scrubbed).toContain("<local>/a.ts:1");
  });
  it("deep-scrubs values and leaves relative paths alone", () => {
    expect(scrubValue({ a: ["/home/u/x"], b: "src/app.ts", n: 3 })).toEqual({ a: ["<local>/x"], b: "src/app.ts", n: 3 });
  });
});
