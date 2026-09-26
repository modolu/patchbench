"use client";

import { useId, useMemo, useState } from "react";
import { classifyLogLine } from "@/lib/diff-parse";
import type { LogEntry } from "@/server/ui/run-reader";

const LINE_CLASS = { cmd: "l-cmd", meta: "l-meta", ok: "l-ok", bad: "l-bad", redacted: "l-red", plain: "" } as const;

interface Group {
  key: string;
  label: string;
  entries: LogEntry[];
  failed: boolean;
}

function groupLogs(logs: LogEntry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const log of logs) {
    const key = log.scope === "candidate" ? `candidate:${log.candidateId}` : log.scope;
    const label = log.scope === "candidate" ? `candidate-${log.candidateId}` : log.scope;
    const g = groups.get(key) ?? { key, label, entries: [], failed: false };
    g.entries.push(log);
    if (log.failed) g.failed = true;
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * Persisted, runner-redacted command logs. Only logs the run declares are
 * offered; nothing here can address an arbitrary file.
 */
export function LogViewer({
  logs,
  timeoutSeconds,
  initialGroup,
  title = "Command logs",
}: {
  logs: LogEntry[];
  timeoutSeconds: number;
  initialGroup?: string;
  title?: string;
}) {
  const groups = useMemo(() => groupLogs(logs), [logs]);
  const [groupKey, setGroupKey] = useState(() => (groups.some((g) => g.key === initialGroup) ? initialGroup! : groups[0]?.key));
  const group = groups.find((g) => g.key === groupKey) ?? groups[0];
  const [entryKey, setEntryKey] = useState<string | undefined>(undefined);
  const entry = group?.entries.find((e) => e.key === entryKey) ?? group?.entries.find((e) => e.failed) ?? group?.entries[0];
  const [open, setOpen] = useState(true);
  const bodyId = useId();

  if (!group) return <div className="term term-empty">No command logs have been persisted for this run yet.</div>;

  return (
    <section className="term" aria-label={title} data-testid="log-viewer">
      <div className="term-h">
        <div className="term-tabs" role="tablist" aria-label="Log source">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={g.key === group.key}
              onClick={() => {
                setGroupKey(g.key);
                setEntryKey(undefined);
                setOpen(true);
              }}
            >
              {g.failed ? <span className="g fail" aria-hidden>✕</span> : <span className="g pass" aria-hidden>✓</span>}
              {g.label}
              {g.failed && <span className="sr-only"> (has a failing check)</span>}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="mono" style={{ fontSize: 10.5, color: "var(--dim)" }}>
          secrets redacted · timeout {timeoutSeconds}s/cmd
        </span>
        <button type="button" className="btn ghost" style={{ height: 24, fontSize: 11.5 }} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
      {open && (
        <div id={bodyId}>
          <div className="subtabs" role="tablist" aria-label="Check">
            {group.entries.map((e) => (
              <button key={e.key} type="button" role="tab" aria-selected={e.key === entry?.key} onClick={() => setEntryKey(e.key)}>
                <span className={`g ${e.failed ? "fail" : "pass"}`} aria-hidden>
                  {e.failed ? "✕" : "✓"}
                </span>
                {e.check}
                {e.failed && <span className="sr-only"> (failed)</span>}
              </button>
            ))}
          </div>
          {entry?.content ? (
            <div className="term-b" role="log" aria-label={`${group.label} ${entry.check} log`} tabIndex={0}>
              {entry.truncated && <div className="l-meta"># showing the last 64 KB of this log</div>}
              {entry.content.split("\n").map((line, i) => (
                <div key={i} className={LINE_CLASS[classifyLogLine(line)]}>
                  {line || " "}
                </div>
              ))}
            </div>
          ) : (
            <div className="term-empty">This log was declared by the run but is not available on disk.</div>
          )}
        </div>
      )}
    </section>
  );
}
