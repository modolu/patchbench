"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import type { CandidateResult, CandidateStrategy } from "@/domain/candidate";
import type { CheckResult, EvidenceMatrix, EvidenceMatrixRow, EvidenceValue } from "@/domain/evidence";
import { candidateStatusTone, conciseReason, failingGateRows, formatDuration, splitFailureId } from "@/lib/run-view";
import type { LogEntry } from "@/server/ui/run-reader";
import { DiffViewer } from "./diff-viewer";
import { LogViewer } from "./log-viewer";
import { StatusPill } from "./status-pill";

const ROW_NOTE: Record<string, string> = {
  frozen_regression: "sha256 matches the frozen artifact",
  regression: "must now pass",
  new_failures: "candidate failures − baseline failures",
  preserved_failures: "already failing on baseline · not held against it",
  files_changed: "excludes the injected regression test",
  diff_size: "implementation only",
};

const VALUE_GLYPH: Record<EvidenceValue["status"], string> = { pass: "✓", fail: "✕", not_configured: "–", not_run: "○", info: "" };
const VALUE_SR: Record<EvidenceValue["status"], string> = { pass: "pass", fail: "fail", not_configured: "not configured", not_run: "not run", info: "" };

function rowNote(row: EvidenceMatrixRow): string | undefined {
  if (["typecheck", "lint", "build"].includes(row.key)) return row.kind === "hard-gate" ? "required by run policy" : "not required by run policy";
  return ROW_NOTE[row.key];
}

type Tab = "diff" | "verification" | "logs";

export interface WorkbenchProps {
  runId: string;
  baselineSha: string;
  matrix: EvidenceMatrix;
  candidates: CandidateResult[];
  strategies: Record<string, CandidateStrategy | undefined>;
  diffs: Record<string, string | null>;
  logs: LogEntry[];
  timeoutSeconds: number;
  initialCandidate?: string;
  initialWhy?: boolean;
}

export function EvidenceWorkbench(props: WorkbenchProps) {
  const { matrix, candidates } = props;
  const ids = matrix.candidates.map((c) => c.id);
  const start = props.initialCandidate && ids.includes(props.initialCandidate) ? props.initialCandidate : ids[0];
  const [selected, setSelected] = useState<string | undefined>(start);
  const [focusRows, setFocusRows] = useState<string[]>(() => (props.initialWhy && start ? failingGateRows(matrix, start).map((r) => r.key) : []));
  const [tab, setTab] = useState<Tab>(props.initialWhy ? "verification" : "diff");
  const detailRef = useRef<HTMLElement>(null);
  const failRef = useRef<HTMLDivElement>(null);
  // Bumped by "Why rejected?"; the effect moves focus to the rejection evidence.
  const [focusRequest, setFocusRequest] = useState(props.initialWhy ? 1 : 0);

  useEffect(() => {
    if (!focusRequest) return;
    detailRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    failRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);

  const select = (id: string) => {
    setSelected(id);
    setFocusRows([]);
    const url = new URL(window.location.href);
    url.searchParams.set("candidate", id);
    url.searchParams.delete("why");
    window.history.replaceState(null, "", url);
  };

  const whyRejected = (id: string) => {
    setSelected(id);
    setFocusRows(failingGateRows(matrix, id).map((r) => r.key));
    setTab("verification");
    setFocusRequest((n) => n + 1);
    const url = new URL(window.location.href);
    url.searchParams.set("candidate", id);
    url.searchParams.set("why", "1");
    window.history.replaceState(null, "", url);
  };

  const hard = matrix.rows.filter((r) => r.kind === "hard-gate");
  const info = matrix.rows.filter((r) => r.kind === "informational");
  const candidate = candidates.find((c) => c.id === selected);
  const minWidth = 250 + 200 * matrix.candidates.length;

  const renderRow = (row: EvidenceMatrixRow) => (
    <tr key={row.key} className={focusRows.includes(row.key) ? "focus" : undefined} data-row={row.key} data-kind={row.kind}>
      <th scope="row" className="rowh">
        {row.label}
        {rowNote(row) && <small>{rowNote(row)}</small>}
      </th>
      {matrix.candidates.map((c) => {
        const v = row.candidateValues[c.id];
        return (
          <td key={c.id} className={c.id === selected ? "sel" : undefined} data-candidate={c.id} data-status={v?.status}>
            {v ? <Cell row={row} value={v} /> : <span className="cell not_run">—</span>}
          </td>
        );
      })}
    </tr>
  );

  return (
    <>
      <div className="paper" data-testid="evidence-matrix">
        <div className="mx-scroll">
          <table className="mx" style={{ minWidth }}>
            <caption className="sr-only">
              Evidence matrix: hard gates reject a candidate; every other row is informational and never weighted.
            </caption>
            <colgroup>
              <col className="c0" />
              {matrix.candidates.map((c) => (
                <col key={c.id} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="corner">
                  Candidate →
                </th>
                {matrix.candidates.map((c) => {
                  const ok = c.status === "ELIGIBLE";
                  const rejected = c.status === "REJECTED";
                  return (
                    <th key={c.id} scope="col" className={c.id === selected ? "sel" : undefined} data-testid={`matrix-col-${c.id}`}>
                      <button type="button" className="colsel" aria-pressed={c.id === selected} onClick={() => select(c.id)}>
                        <span className="ptile" aria-hidden>
                          {c.id.toUpperCase().slice(0, 2)}
                        </span>
                        <span className="ct">{c.title}</span>
                        <span className="cl">Candidate {c.id.toUpperCase()}</span>
                        <span className={`verdict ${ok ? "ok" : rejected ? "no" : "na"}`} data-testid={`verdict-${c.id}`}>
                          <span aria-hidden>{ok ? "✓" : rejected ? "✕" : "○"}</span> {c.status.replace(/_/g, " ")}
                        </span>
                      </button>
                      {rejected && c.rejectionReasons.length > 0 && (
                        <button type="button" className="why" onClick={() => whyRejected(c.id)} data-testid={`why-${c.id}`}>
                          <span className="why-q">Why rejected?</span> <span className="why-r">{c.rejectionReasons.map(conciseReason).join(" · ")}</span>
                          <span className="why-arrow" aria-hidden>
                            ↓
                          </span>
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr className="grp">
                <th scope="colgroup" colSpan={matrix.candidates.length + 1}>
                  Hard gates<span>any failure rejects the candidate</span>
                </th>
              </tr>
              {hard.map(renderRow)}
              <tr className="grp">
                <th scope="colgroup" colSpan={matrix.candidates.length + 1}>
                  Evidence<span>informational · shown, never weighted</span>
                </th>
              </tr>
              {info.map(renderRow)}
            </tbody>
          </table>
        </div>
        <div className="foot-note">
          <span>
            <b>No composite score. No recommendation.</b> Hard gates reject; everything else is evidence. The developer decides.
          </span>
          <span className="mono" style={{ fontSize: 11 }}>
            base {props.baselineSha.slice(0, 7)} · baseline failures {matrix.baselineFailures.length}
          </span>
        </div>
      </div>

      {candidate && (
        <CandidateDetail
          key={candidate.id}
          ref={detailRef}
          failRef={failRef}
          runId={props.runId}
          candidate={candidate}
          title={matrix.candidates.find((c) => c.id === candidate.id)?.title ?? candidate.strategyId}
          strategy={props.strategies[candidate.id]}
          diff={props.diffs[candidate.id] ?? null}
          logs={props.logs.filter((l) => l.candidateId === candidate.id)}
          timeoutSeconds={props.timeoutSeconds}
          tab={tab}
          onTab={setTab}
          focusNewFailures={focusRows.includes("new_failures")}
        />
      )}
    </>
  );
}

function Cell({ row, value }: { row: EvidenceMatrixRow; value: EvidenceValue }) {
  const showDetail = value.detail && value.detail.length > 0 && (value.status === "fail" || row.key === "preserved_failures" || row.key === "config_touched");
  const diffMatch = row.key === "diff_size" ? /^\+(\d+) \/ -(\d+)$/.exec(value.display) : null;
  return (
    <div>
      <span className={`cell ${value.status}${row.kind === "informational" ? " informational" : ""}`}>
        {VALUE_GLYPH[value.status] && (
          <span className="gl" aria-hidden>
            {VALUE_GLYPH[value.status]}
          </span>
        )}
        {diffMatch ? (
          <>
            <span style={{ color: "var(--pgreen)" }}>+{diffMatch[1]}</span>
            <span style={{ color: "var(--pred)" }}>−{diffMatch[2]}</span>
          </>
        ) : (
          value.display
        )}
        {VALUE_SR[value.status] && value.status !== "fail" && value.status !== "pass" && <small>{VALUE_SR[value.status]}</small>}
        {(value.status === "pass" || value.status === "fail") && <span className="sr-only">({VALUE_SR[value.status]})</span>}
      </span>
      {diffMatch && (Number(diffMatch[1]) > 0 || Number(diffMatch[2]) > 0) && (
        <span className="bar" aria-hidden>
          <span className="ba" style={{ width: `${Math.min(100, Number(diffMatch[1]) * 4)}%` }} />
          <span className="bd" style={{ width: `${Math.min(100, Number(diffMatch[2]) * 4)}%` }} />
        </span>
      )}
      {showDetail && (
        <ul className={`cell-detail${value.status === "fail" ? " fail" : ""}`}>
          {value.detail!.map((d) => (
            <li key={d} title={d}>
              {splitFailureId(d).name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- detail

interface DetailProps {
  ref: Ref<HTMLElement>;
  failRef: Ref<HTMLDivElement>;
  runId: string;
  candidate: CandidateResult;
  title: string;
  strategy?: CandidateStrategy;
  diff: string | null;
  logs: LogEntry[];
  timeoutSeconds: number;
  tab: Tab;
  onTab: (t: Tab) => void;
  focusNewFailures: boolean;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "diff", label: "Diff" },
  { key: "verification", label: "Verification" },
  { key: "logs", label: "Logs" },
];

function CandidateDetail({ ref, failRef, runId, candidate, title, strategy, diff, logs, timeoutSeconds, tab, onTab, focusNewFailures }: DetailProps) {
  const v = candidate.verification;
  const d = v?.diff ?? candidate.diff;
  const letter = candidate.id.toUpperCase();
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.findIndex((t) => t.key === tab);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
    onTab(next.key);
    (e.currentTarget.querySelector(`[data-tab="${next.key}"]`) as HTMLButtonElement | null)?.focus();
  };

  return (
    <section className="detail" ref={ref} aria-label={`Candidate ${letter} detail`} data-testid="candidate-detail" data-candidate={candidate.id}>
      <div className="d-left">
        <div>
          <h2>
            <span className="tile" aria-hidden>
              {letter}
            </span>
            <span>
              <span className="sr-only">Candidate {letter}: </span>
              {title}
            </span>
          </h2>
          <div style={{ marginTop: 8 }}>
            <StatusPill tone={candidateStatusTone(candidate.status)} label={candidate.status} testId="detail-status" />
          </div>
          {strategy?.rationale && <p>{strategy.rationale}</p>}
        </div>

        {v && v.rejectionReasons.length > 0 && (
          <div className="failbox" ref={failRef} tabIndex={-1} data-testid="rejection-box">
            <div className="t">✕ Rejected by hard gate</div>
            <ul>
              {v.rejectionReasons.map((r) => (
                <li key={r}>{conciseReason(r)}</li>
              ))}
            </ul>
            {v.newFailures.length > 0 && (
              <>
                <div className="t" style={{ marginTop: 10 }}>
                  New failures vs baseline ({v.newFailures.length})
                </div>
                <ul data-testid="rejection-new-failures">
                  {v.newFailures.map((f) => {
                    const { file, name } = splitFailureId(f);
                    return (
                      <li key={f}>
                        {name}
                        {file && <small>{file}</small>}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
        {candidate.failure && !v && (
          <div className="failbox">
            <div className="t">
              ✕ {candidate.failure.code}
            </div>
            <ul>
              <li>{candidate.failure.message}</li>
            </ul>
          </div>
        )}

        {strategy && strategy.tradeoffs.length > 0 && (
          <div>
            <div className="label">Trade-offs · as proposed</div>
            <ul className="tradeoffs">
              {strategy.tradeoffs.map((t) => (
                <li key={t}>
                  <span className="pm" aria-hidden>
                    ·
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {strategy?.implementationBrief && (
          <div>
            <div className="label">Implementation brief</div>
            <p>{strategy.implementationBrief}</p>
          </div>
        )}

        <div>
          <div className="label">Change surface</div>
          {d ? (
            <>
              <ul className="files">
                {d.files.map((f) => (
                  <li key={f.path}>
                    <span title={f.path}>{f.path}</span>
                    <span>
                      <span className="add">+{f.insertions ?? "?"}</span> <span className="del">−{f.deletions ?? "?"}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flags">
                <span className={`chip${d.dependencyManifestChanged ? " warn" : ""}`}>dependency manifest {d.dependencyManifestChanged ? "changed" : "unchanged"}</span>
                <span className={`chip${d.configFilesTouched.length ? " warn" : ""}`}>
                  config {d.configFilesTouched.length ? `touched: ${d.configFilesTouched.join(", ")}` : "untouched"}
                </span>
              </div>
            </>
          ) : (
            <p>No diff recorded yet.</p>
          )}
        </div>

        <div>
          <div className="label">Inspect locally</div>
          <div className="cmdline" title={candidate.branchName}>
            <code>git -C .patchbench/worktrees/{runId}/{candidate.id} diff</code>
          </div>
          <p style={{ fontSize: 11.5 }}>
            Branch <span className="mono">{candidate.branchName}</span>. PatchBench never merges or pushes.
          </p>
        </div>
      </div>

      <div className="d-right">
        <div className="d-tabs" role="tablist" aria-label="Candidate evidence" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              data-tab={t.key}
              id={`tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => onTab(t.key)}
            >
              {t.label}
              {t.key === "diff" && d && <span className="count">{d.filesChanged}</span>}
              {t.key === "logs" && <span className="count">{logs.length}</span>}
            </button>
          ))}
        </div>
        <div className="d-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "diff" && <DiffViewer patch={diff} emptyText="No implementation diff was persisted for this candidate." />}
          {tab === "verification" && <VerificationList candidate={candidate} focusNewFailures={focusNewFailures} />}
          {tab === "logs" &&
            (logs.length ? (
              <div style={{ padding: 10 }}>
                <LogViewer logs={logs} timeoutSeconds={timeoutSeconds} title={`Candidate ${letter} logs`} />
              </div>
            ) : (
              <div className="term-empty">No logs were persisted for this candidate.</div>
            ))}
        </div>
      </div>
    </section>
  );
}

function checkText(c: CheckResult | undefined): string {
  if (!c) return "not configured";
  if (c.skipped) return "not run";
  const parts = [c.timedOut ? "timeout" : c.passed ? "pass" : "fail"];
  if (c.summary) parts.push(`${c.summary.pass}/${c.summary.tests} tests`);
  if (c.exitCode !== null) parts.push(`exit ${c.exitCode}`);
  const dur = formatDuration(c.durationMs);
  if (dur) parts.push(dur);
  return parts.join(" · ");
}

function VerificationList({ candidate, focusNewFailures }: { candidate: CandidateResult; focusNewFailures: boolean }) {
  const v = candidate.verification;
  if (!v) return <div className="term-empty">This candidate has not been verified.</div>;
  const checks: Array<[string, CheckResult | undefined]> = [
    ["Regression test", v.regression],
    ["Test suite", v.tests],
    ["Typecheck", v.typecheck],
    ["Lint", v.lint],
    ["Build", v.build],
  ];
  const glyph = (ok: boolean | null) => (ok === null ? <span className="g q">–</span> : ok ? <span className="g pass">✓</span> : <span className="g fail">✕</span>);
  return (
    <ul className="vlist" data-testid="verification-list">
      <li>
        <div className="vrow">
          {glyph(v.regressionIntact)}
          <span>Frozen regression intact</span>
          <span className="rs">{v.regressionIntact ? "intact" : "mutated"}</span>
        </div>
      </li>
      {checks.map(([name, c]) => (
        <li key={name}>
          <div className="vrow">
            {glyph(!c || c.skipped ? null : c.passed)}
            <span>{name}</span>
            <span className="rs">{checkText(c)}</span>
          </div>
          {c?.command && <div className="vsub">$ {[c.command.command, ...c.command.args].join(" ")}</div>}
        </li>
      ))}
      <li className={focusNewFailures ? "vfocus" : undefined} data-testid="new-failures-evidence">
        <div className="vrow">
          {glyph(v.tests && !v.tests.skipped ? v.newFailures.length === 0 : null)}
          <span>New failures vs baseline</span>
          <span className="rs">{v.newFailures.length}</span>
        </div>
        {v.newFailures.length > 0 && (
          <div className="vsub fail">
            <ul>
              {v.newFailures.map((f) => (
                <li key={f}>✕ {f}</li>
              ))}
            </ul>
          </div>
        )}
      </li>
      <li>
        <div className="vrow">
          <span className="g q">·</span>
          <span>Preserved baseline failures</span>
          <span className="rs">{v.preservedFailures.length}</span>
        </div>
        <div className="vsub">
          {v.preservedFailures.length ? v.preservedFailures.join(" · ") : `none · baseline recorded ${v.baselineFailures.length} failure${v.baselineFailures.length === 1 ? "" : "s"}`}
        </div>
      </li>
    </ul>
  );
}
