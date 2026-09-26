import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CandidateStrategy } from "@/domain/candidate";
import { EvidenceMatrixSchema, type EvidenceMatrix } from "@/domain/evidence";
import type { RunEvent } from "@/domain/events";
import type { PatchBenchRun, RunStatus } from "@/domain/run";
import { isSafeId } from "@/lib/ids";
import { resolveRelativeWithin } from "@/lib/paths";
import { FileRunStore } from "../runs/store";
import { buildEvidenceMatrix } from "../verification/evidence-builder";
import { uiConfig, type PatchBenchMode, type UiConfig } from "./config";
import { scrubAbsolutePaths, scrubValue } from "./sanitize";

export type RunSource = "local" | "showcase";

export interface LogEntry {
  /** Stable key, e.g. `candidate:b:test`. */
  key: string;
  scope: "baseline" | "reproduction" | "candidate";
  candidateId?: string;
  check: string;
  /** The check failed (the reproduction's expected baseline failure is not a failure here). */
  failed: boolean;
  content: string | null;
  truncated: boolean;
}

export interface RunView {
  mode: PatchBenchMode;
  source: RunSource;
  run: PatchBenchRun;
  events: RunEvent[];
  matrix: EvidenceMatrix;
  /** `report` = persisted report.json; `derived` = projected from run.json (run not complete yet). */
  matrixSource: "report" | "derived";
  strategies: Record<string, CandidateStrategy | undefined>;
  diffs: Record<string, string | null>;
  regressionPatch: string | null;
  logs: LogEntry[];
}

export type RunViewResult =
  | { ok: true; view: RunView }
  | { ok: false; kind: "invalid-id" | "not-found" | "corrupt"; message: string };

export interface RunSummary {
  id: string;
  source: RunSource;
  status: RunStatus;
  repoName: string;
  title: string;
  createdAt: string;
  eligible: number;
  rejected: number;
}

const MAX_LOG_BYTES = 64 * 1024;
const MAX_PATCH_BYTES = 256 * 1024;

function sources(config: UiConfig): Array<{ source: RunSource; root: string }> {
  const showcase = { source: "showcase" as const, root: config.showcaseRoot };
  return config.mode === "showcase" ? [showcase] : [{ source: "local", root: config.runtimeRoot }, showcase];
}

/** Reads a run-relative artifact through the run-store boundary; null when absent or outside the run dir. */
async function readArtifact(runDir: string, relative: string, maxBytes: number): Promise<{ text: string; truncated: boolean } | null> {
  const resolved = await resolveRelativeWithin(runDir, relative);
  if (!resolved) return null;
  try {
    const raw = await readFile(resolved, "utf8");
    if (raw.length <= maxBytes) return { text: raw, truncated: false };
    return { text: raw.slice(raw.length - maxBytes), truncated: true };
  } catch {
    return null;
  }
}

async function locate(runId: string, config: UiConfig): Promise<{ source: RunSource; store: FileRunStore } | null> {
  for (const { source, root } of sources(config)) {
    const store = new FileRunStore(root);
    const found = await readFile(path.join(store.runDir(runId), "run.json")).then(() => true, () => false);
    if (found) return { source, store };
  }
  return null;
}

function collectLogRefs(run: PatchBenchRun): Array<Omit<LogEntry, "content" | "truncated"> & { path: string }> {
  const refs: Array<Omit<LogEntry, "content" | "truncated"> & { path: string }> = [];
  for (const c of run.baseline?.checks ?? []) if (c.logPath) refs.push({ key: `baseline:${c.name}`, scope: "baseline", check: c.name, failed: !c.passed, path: c.logPath });
  const repro = run.reproduction?.baselineCheck;
  if (repro?.logPath) refs.push({ key: "reproduction:regression", scope: "reproduction", check: "regression", failed: false, path: repro.logPath });
  for (const cand of run.candidates) {
    const v = cand.verification;
    if (!v || !isSafeId(cand.id)) continue;
    for (const check of [v.regression, v.tests, v.typecheck, v.lint, v.build]) {
      if (check?.logPath && !check.skipped) refs.push({ key: `candidate:${cand.id}:${check.name}`, scope: "candidate", candidateId: cand.id, check: check.name, failed: !check.passed, path: check.logPath });
    }
  }
  return refs;
}

/**
 * The only way UI code reads persisted runs. Validates the run ID, resolves it
 * beneath a configured root via FileRunStore, parses run.json/events/report
 * with the domain schemas, and reads logs/diffs only at paths the run itself
 * declares (re-validated to stay inside the run directory). Showcase output is
 * deep-scrubbed of absolute machine paths.
 */
export async function loadRunView(runId: string, config: UiConfig = uiConfig()): Promise<RunViewResult> {
  if (typeof runId !== "string" || !isSafeId(runId)) return { ok: false, kind: "invalid-id", message: "That is not a valid PatchBench run ID." };
  const located = await locate(runId, config);
  if (!located) return { ok: false, kind: "not-found", message: `Run ${runId} was not found.` };
  const { store, source } = located;
  const loaded = await store.loadRun(runId);
  if (!loaded.ok) {
    return loaded.error.code === "RUN_NOT_FOUND"
      ? { ok: false, kind: "not-found", message: `Run ${runId} was not found.` }
      : { ok: false, kind: "corrupt", message: `Run ${runId} has unreadable or invalid persisted state.` };
  }
  const run = loaded.value;
  const runDir = store.runDir(runId);
  const events = await store.readEvents(runId);

  let matrix: EvidenceMatrix = buildEvidenceMatrix(run);
  let matrixSource: RunView["matrixSource"] = "derived";
  const report = await readArtifact(runDir, "report.json", MAX_PATCH_BYTES);
  if (report && !report.truncated) {
    try {
      const parsed = EvidenceMatrixSchema.safeParse(JSON.parse(report.text));
      if (parsed.success && parsed.data.runId === run.id) {
        matrix = parsed.data;
        matrixSource = "report";
      }
    } catch {
      // Fall back to the pure projection of run.json.
    }
  }

  const diffs: Record<string, string | null> = {};
  for (const c of run.candidates) {
    diffs[c.id] = isSafeId(c.id) ? ((await readArtifact(runDir, `candidates/${c.id}/diff.patch`, MAX_PATCH_BYTES))?.text ?? null) : null;
  }
  const regressionPatch = (await readArtifact(runDir, "reproduction/regression.patch", MAX_PATCH_BYTES))?.text ?? null;
  const logs: LogEntry[] = [];
  for (const { path: rel, ...ref } of collectLogRefs(run)) {
    const read = await readArtifact(runDir, rel, MAX_LOG_BYTES);
    logs.push({ ...ref, content: read?.text ?? null, truncated: read?.truncated ?? false });
  }

  const view: RunView = {
    mode: config.mode,
    source,
    run,
    events,
    matrix,
    matrixSource,
    strategies: Object.fromEntries(run.candidates.map((c) => [c.id, run.strategies.find((s) => s.id === c.strategyId)])),
    diffs,
    regressionPatch,
    logs,
  };
  return { ok: true, view: config.mode === "showcase" || source === "showcase" ? scrubValue(view) : view };
}

/** Recent runs across configured sources (local first), newest first. Unreadable runs are skipped. */
export async function listRunSummaries(config: UiConfig = uiConfig(), limit = 12): Promise<RunSummary[]> {
  const seen = new Set<string>();
  const out: RunSummary[] = [];
  for (const { source, root } of sources(config)) {
    const store = new FileRunStore(root);
    for (const id of (await store.listRunIds()).filter(isSafeId)) {
      if (seen.has(id)) continue;
      const loaded = await store.loadRun(id);
      if (!loaded.ok) continue;
      seen.add(id);
      const run = loaded.value;
      out.push({
        id,
        source,
        status: run.status,
        repoName: scrubAbsolutePaths(path.basename(run.repository.root)),
        title: run.issue.title,
        createdAt: run.createdAt,
        eligible: run.candidates.filter((c) => c.status === "ELIGIBLE").length,
        rejected: run.candidates.filter((c) => c.status === "REJECTED").length,
      });
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
