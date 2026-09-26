import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EvidenceWorkbench } from "@/components/pb/evidence-workbench";
import { RunShell } from "@/components/pb/run-shell";
import { RunUnavailable } from "@/components/pb/run-unavailable";
import { conciseReason, formatDuration, runStats } from "@/lib/run-view";
import { loadRunView } from "@/server/ui/run-reader";

export async function generateMetadata(props: PageProps<"/runs/[runId]/evidence">): Promise<Metadata> {
  const { runId } = await props.params;
  return { title: `Evidence · ${runId.slice(0, 64)} · PatchBench` };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EvidencePage(props: PageProps<"/runs/[runId]/evidence">) {
  await connection();
  const { runId } = await props.params;
  const search = await props.searchParams;
  const result = await loadRunView(runId);
  if (!result.ok) {
    if (result.kind !== "corrupt") notFound();
    return <RunUnavailable message={result.message} />;
  }
  const view = result.view;
  const { run, matrix } = view;
  const stats = runStats(run, view.events);
  const rejected = matrix.candidates.filter((c) => c.status === "REJECTED");
  const eligible = matrix.candidates.filter((c) => c.status === "ELIGIBLE");

  return (
    <RunShell view={view} active="evidence">
      <div className="head head-row">
        <div>
          <h1>Evidence matrix</h1>
          <p data-testid="evidence-summary">
            {stats.candidates} independent candidate{stats.candidates === 1 ? "" : "s"} verified against the same frozen regression and commands.{" "}
            {rejected.map((c) => (
              <b key={c.id}>
                Candidate {c.id.toUpperCase()} was rejected automatically: {c.rejectionReasons.map(conciseReason).join("; ").toLowerCase()}.{" "}
              </b>
            ))}
            {eligible.length > 0
              ? `${eligible.length} candidate${eligible.length === 1 ? " remains" : "s remain"} eligible. The choice is yours.`
              : "No candidate passed every hard gate."}
          </p>
        </div>
      </div>
      {view.matrixSource === "derived" && (
        <p className="note" role="status">
          Run is {run.status.replace(/_/g, " ")}: evidence below is projected from the current persisted state, not a final report.
        </p>
      )}

      <div className="stats" data-testid="run-stats">
        <Stat label="Candidates" value={stats.candidates} />
        <Stat label="Eligible" value={stats.eligible} />
        <Stat label="Rejected" value={stats.rejected} small={stats.rejected ? "by hard gate" : undefined} />
        <Stat label="Checks run" value={stats.checksRun} small={`/${stats.checksPlanned}`} />
        <Stat label="New failures caught" value={stats.newFailuresCaught} />
        <Stat label="Verification" value={formatDuration(stats.verificationMs) ?? "—"} small="sequential" />
      </div>

      <EvidenceWorkbench
        runId={run.id}
        baselineSha={run.repository.commitSha}
        matrix={matrix}
        candidates={run.candidates}
        strategies={view.strategies}
        diffs={view.diffs}
        logs={view.logs.filter((l) => l.scope === "candidate")}
        timeoutSeconds={Math.round(run.policy.commandTimeoutMs / 1000)}
        initialCandidate={first(search.candidate)}
        initialWhy={first(search.why) === "1"}
      />
    </RunShell>
  );
}

function Stat({ label, value, small }: { label: string; value: number | string; small?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="v">
        {value}
        {small && <small>{small}</small>}
      </div>
    </div>
  );
}
