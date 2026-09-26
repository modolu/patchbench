export type DiffLineKind = "hunk" | "add" | "del" | "ctx" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

/** Parses `git diff` output into per-file line lists with old/new line numbers. Pure. */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(raw);
    if (header) {
      file = { path: header[2]!, additions: 0, deletions: 0, lines: [] };
      files.push(file);
      continue;
    }
    if (!file) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      file.lines.push({ kind: "hunk", oldNo: null, newNo: null, text: raw });
      continue;
    }
    if (file.lines.length === 0) continue; // index/---/+++ preamble
    if (raw.startsWith("+")) {
      file.additions += 1;
      file.lines.push({ kind: "add", oldNo: null, newNo: newNo++, text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      file.deletions += 1;
      file.lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text: raw.slice(1) });
    } else if (raw.startsWith(" ")) {
      file.lines.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: raw.slice(1) });
    } else if (raw.startsWith("\\")) {
      file.lines.push({ kind: "meta", oldNo: null, newNo: null, text: raw });
    }
  }
  return files;
}

export type LogLineKind = "cmd" | "meta" | "ok" | "bad" | "redacted" | "plain";

/** Classifies a persisted log line for restrained highlighting. */
export function classifyLogLine(line: string): LogLineKind {
  if (line.startsWith("$ ")) return "cmd";
  if (/^(# exit=|--- (stdout|stderr))/.test(line)) return "meta";
  if (line.includes("[REDACTED]")) return "redacted";
  if (/^\s*not ok \d+/.test(line) || /^# fail [1-9]/.test(line)) return "bad";
  if (/^\s*ok \d+/.test(line) || /^# pass \d+/.test(line)) return "ok";
  return "plain";
}
