import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LogViewer } from "@/components/pb/log-viewer";
import { BaselineStrip, CandidateCard, IssueCard, ReproductionProof } from "@/components/pb/run-overview";
import { RunShell } from "@/components/pb/run-shell";
import { RunUnavailable } from "@/components/pb/run-unavailable";
import { shortSha } from "@/lib/run-view";
import { loadRunView } from "@/server/ui/run-reader";

export async function generateMetadata(props: PageProps<"/runs/[runId]">): Promise<Metadata> {
  const { runId } = await props.params;
  return { title: `Run ${runId.slice(0, 64)} · PatchBench` };
}

export default async function RunPage(props: PageProps<"/runs/[runId]">) {
  await connection();
  const { runId } = await props.params;
  const result = await loadRunView(runId);
  if (!result.ok) {
    if (result.kind !== "corrupt") notFound();
    return <RunUnavailable message={result.message} />;
  }
  const view = result.view;
  const { run } = view;
  const n = run.candidates.length;
  return (
    <RunShell view={view} active="overview">
      <div className="intro" style={{ marginTop: 0 }}>
        <IssueCard run={run} />
        <ReproductionProof view={view} />
      </div>
      <BaselineStrip run={run} />

      <section aria-labelledby="bench-h">
        <div className="sec-h">
          <div>
            <h2 id="bench-h">Candidate bench</h2>
            <p>
              {n ? `${n} isolated worktree${n === 1 ? "" : "s"}` : "Isolated worktrees"} from <span className="mono">{shortSha(run.repository.commitSha)}</span> · identical frozen regression and
              verification commands · verified sequentially
            </p>
          </div>
          <div className="legend" aria-hidden>
            <span>
              <span className="g pass">✓</span>pass
            </span>
            <span>
              <span className="g fail">✕</span>fail
            </span>
            <span>
              <span className="g q">○</span>pending
            </span>
            <span>
              <span className="tag-info">info</span>not a gate
            </span>
          </div>
        </div>
        {n ? (
          <div className="bench">
            {run.candidates.map((c) => (
              <CandidateCard key={c.id} view={view} candidate={c} />
            ))}
          </div>
        ) : (
          <div className="card card-pad note">No candidates yet. Candidates are created only after the bug is reproduced as a failing test.</div>
        )}
      </section>

      <LogViewer logs={view.logs} timeoutSeconds={Math.round(run.policy.commandTimeoutMs / 1000)} />
    </RunShell>
  );
}
