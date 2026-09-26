import Link from "next/link";
import path from "node:path";
import type { ReactNode } from "react";
import { formatDuration, isTerminal, recordedWallTimeMs, runStatusTone } from "@/lib/run-view";
import type { RunView } from "@/server/ui/run-reader";
import { AppBar, ModeNote } from "./app-bar";
import { RefreshButton } from "./refresh-button";
import { RunRail } from "./run-rail";
import { StatusPill } from "./status-pill";

/** Shared chrome for /runs/[runId] and /runs/[runId]/evidence. */
export function RunShell({ view, active, children }: { view: RunView; active: "overview" | "evidence"; children: ReactNode }) {
  const { run, events } = view;
  const tone = runStatusTone(run.status);
  const wall = formatDuration(recordedWallTimeMs(run, events));
  const terminal = isTerminal(run.status);
  const last = events.at(-1)?.at;
  return (
    <div className="pb-app">
      <AppBar
        tone={tone}
        crumbs={[{ label: "Benchmarks", href: "/new" }, { label: path.basename(run.repository.root) }, { label: run.id, mono: true }]}
        status={<StatusPill tone={tone} label={run.status} testId="run-status" />}
      >
        <ModeNote mode={view.mode} />
        {terminal ? (
          <span className="clock">
            wall time <b>{wall ?? "—"}</b>
          </span>
        ) : (
          <span className="clock">
            last event <b>{last ? `${last.slice(11, 19)} UTC` : "—"}</b>
          </span>
        )}
        {!terminal && view.source === "local" && <RefreshButton />}
      </AppBar>
      <div className="pb-body">
        <RunRail view={view} />
        <main className="pb-main" id="main">
          <nav className="d-tabs" aria-label="Run views" style={{ padding: 0, marginBottom: 16 }}>
            <Link href={`/runs/${run.id}`} aria-current={active === "overview" ? "page" : undefined} className="run-tab">
              Live bench
            </Link>
            <Link href={`/runs/${run.id}/evidence`} aria-current={active === "evidence" ? "page" : undefined} className="run-tab">
              Evidence matrix
            </Link>
          </nav>
          {run.failure && (
            <div className="failbox" role="alert" style={{ marginBottom: 14 }}>
              <div className="t">
                ✕ {run.status}: {run.failure.code}
              </div>
              <ul>
                <li>{run.failure.message}</li>
                {run.failure.nextAction && <li>Next: {run.failure.nextAction}</li>}
              </ul>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
