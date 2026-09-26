import path from "node:path";
import { buildTimeline, shortSha } from "@/lib/run-view";
import type { RunView } from "@/server/ui/run-reader";
import { PipelineTimeline } from "./pipeline-timeline";

/** Left rail: run facts, pipeline timeline, execution context. Server-rendered from persisted state. */
export function RunRail({ view }: { view: RunView }) {
  const { run, events } = view;
  const repo = run.repository;
  const adapter = events.find((e) => e.type === "reproduction.started")?.data?.adapter;
  const cmd = (name: string) => run.policy.verificationCommands.find((c) => c.name === name);
  return (
    <aside className="rail" aria-label="Run details">
      <div>
        <div className="label">Run</div>
        <dl className="kv">
          <dt>Repo</dt>
          <dd title={repo.root}>{path.basename(repo.root)}</dd>
          <dt>Baseline</dt>
          <dd>
            {repo.branch ?? "detached"} @ {shortSha(repo.commitSha)}
          </dd>
          <dt>Working tree</dt>
          <dd className={repo.isDirty ? "warn" : undefined} data-testid="worktree-state">
            {repo.isDirty ? "dirty · isolated baseline" : "clean"}
          </dd>
          <dt>Package mgr</dt>
          <dd>{repo.packageManager}</dd>
          <dt>Candidates</dt>
          <dd>{run.candidates.length || run.policy.candidateCount}</dd>
        </dl>
        {repo.isDirty && (
          <p className="rail-note">Uncommitted local changes are ignored: every check runs in a clean detached worktree at the recorded commit.</p>
        )}
      </div>
      <div>
        <div className="label">Pipeline</div>
        <PipelineTimeline stages={buildTimeline(run, events)} />
      </div>
      <div className="rail-foot">
        <div className="label">Execution</div>
        <dl className="kv">
          <dt>Bob adapter</dt>
          <dd>{typeof adapter === "string" ? adapter : "—"}</dd>
          <dt>Verification</dt>
          <dd>sequential</dd>
          <dt>Timeout</dt>
          <dd>{Math.round(run.policy.commandTimeoutMs / 1000)}s / command</dd>
          <dt>Test cmd</dt>
          <dd title={cmd("test") ? [cmd("test")!.command, ...cmd("test")!.args].join(" ") : undefined}>{cmd("test") ? [cmd("test")!.command, ...cmd("test")!.args].join(" ") : "not configured"}</dd>
        </dl>
        <p className="rail-note">{view.source === "showcase" ? "Captured run artifact. Paths are sanitized." : "Read from .patchbench/runs on this machine."}</p>
      </div>
    </aside>
  );
}
