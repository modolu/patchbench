/**
 * Pure parser for Node's `node:test` TAP reporter (`--test-reporter=tap`).
 * Only the subset node emits is supported: test points, YAML diagnostics and
 * the trailing `# key N` summary. Unknown lines are ignored.
 */

export interface TapTestPoint {
  name: string;
  ok: boolean;
  /** Nesting depth (0 = top level). */
  depth: number;
  failureType?: string;
  /** Node error code, e.g. ERR_ASSERTION or ERR_TEST_FAILURE. */
  code?: string;
  /** Error class, e.g. AssertionError or TypeError. */
  errorName?: string;
  errorText?: string;
  /** `path:line:col` of the test definition. */
  location?: string;
}

export interface TapReport {
  /** False when the summary is missing (e.g. truncated or non-TAP output). */
  complete: boolean;
  tests: number;
  pass: number;
  fail: number;
  cancelled: number;
  points: TapTestPoint[];
  /** Failing leaf tests (suite-level "subtestsFailed" wrappers excluded). */
  failures: TapTestPoint[];
}

const POINT = /^((?: {4})*)(ok|not ok) \d+(?: - (.*))?$/;
const SUMMARY = /^# (tests|pass|fail|cancelled) (\d+)$/;

function unescapeName(raw: string): string {
  // Strip a trailing directive, then TAP escapes (`\#`, `\\`).
  const withoutDirective = raw.replace(/ # (?:SKIP|TODO)\b.*$/i, "");
  return withoutDirective.replace(/\\([\\#])/g, "$1").trim();
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}

/** Parses the YAML diagnostic block lines (already de-indented to key level). */
function parseDiagnostics(lines: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_]+):(?: (.*))?$/.exec(lines[i]!);
    if (!m) continue;
    const [, key, rawValue = ""] = m;
    if (/^[|>][-+]?$/.test(rawValue.trim())) {
      const block: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1]!.startsWith("  ") || lines[i + 1]!.trim() === "")) {
        block.push(lines[++i]!.slice(2));
      }
      out[key!] = block.join("\n").trimEnd();
    } else {
      out[key!] = unquote(rawValue);
    }
  }
  return out;
}

export function parseNodeTap(output: string): TapReport {
  const lines = output.split(/\r?\n/);
  const points: TapTestPoint[] = [];
  const summary: Partial<Record<"tests" | "pass" | "fail" | "cancelled", number>> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const sm = SUMMARY.exec(line);
    if (sm) {
      summary[sm[1] as keyof typeof summary] = Number(sm[2]);
      continue;
    }
    const pm = POINT.exec(line);
    if (!pm) continue;
    const indent = pm[1]!;
    const point: TapTestPoint = { name: unescapeName(pm[3] ?? ""), ok: pm[2] === "ok", depth: indent.length / 4 };

    const yamlIndent = `${indent}  `;
    if (lines[i + 1] === `${yamlIndent}---`) {
      const block: string[] = [];
      i += 2;
      while (i < lines.length && lines[i] !== `${yamlIndent}...`) {
        const l = lines[i]!;
        block.push(l.startsWith(yamlIndent) ? l.slice(yamlIndent.length) : l.trimStart());
        i++;
      }
      const diag = parseDiagnostics(block);
      if (diag.failureType) point.failureType = diag.failureType;
      if (diag.code) point.code = diag.code;
      if (diag.name) point.errorName = diag.name;
      if (diag.error) point.errorText = diag.error;
      if (diag.location) point.location = diag.location;
    }
    points.push(point);
  }

  const complete = summary.tests !== undefined && summary.fail !== undefined;
  return {
    complete,
    tests: summary.tests ?? 0,
    pass: summary.pass ?? 0,
    fail: summary.fail ?? 0,
    cancelled: summary.cancelled ?? 0,
    points,
    failures: points.filter((p) => !p.ok && p.failureType !== "subtestsFailed"),
  };
}

/** Strips `:line:col` and a `file://` prefix from a TAP location. */
export function locationFile(location: string): string {
  return location.replace(/^file:\/\//, "").replace(/:\d+:\d+$/, "");
}
