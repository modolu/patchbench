import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AppBar, ModeNote } from "@/components/pb/app-bar";
import { NewBenchmarkForm } from "@/components/pb/new-benchmark-form";
import { ShowcaseIntro } from "@/components/pb/showcase-intro";
import { StatusPill } from "@/components/pb/status-pill";
import { defaultRunPolicy } from "@/domain/policy";
import { runStatusTone } from "@/lib/run-view";
import { listRunSummaries } from "@/server/ui/run-reader";
import { uiConfig } from "@/server/ui/config";

export const metadata: Metadata = { title: "New benchmark · PatchBench" };

export default async function NewBenchmarkPage() {
  await connection();
  const config = uiConfig();
  const runs = await listRunSummaries(config);
  const policy = defaultRunPolicy();
  const showcase = config.mode === "showcase";
  const captured = runs.find((r) => r.source === "showcase" && r.status === "COMPLETE");
  return (
    <div className="pb-app">
      <AppBar crumbs={[{ label: "Benchmarks" }, { label: "New" }]} status={<StatusPill tone="neutral" label={showcase ? "Showcase" : "Draft"} />}>
        <ModeNote mode={config.mode} />
      </AppBar>
      <div className="pb-body">
        <aside className="rail" aria-label="Recent runs">
          <div>
            <div className="label">{showcase ? "Captured benchmark" : "Recent runs"}</div>
            {runs.length ? (
              <ul className="runs" data-testid="recent-runs">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link href={r.status === "COMPLETE" ? `/runs/${r.id}/evidence` : `/runs/${r.id}`} title={r.id}>
                      <div className="r1">
                        <span className="rname">{r.repoName}</span>
                        <StatusPill small tone={runStatusTone(r.status)} label={r.status} />
                      </div>
                      <div className="rrepo">{r.title}</div>
                      <div className="rwhy">
                        {r.eligible} eligible · {r.rejected} rejected
                      </div>
                      <div className="rid">
                        {r.source === "showcase" && !showcase ? "captured · " : ""}
                        {r.createdAt.slice(0, 16).replace("T", " ")} UTC
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rail-note">No persisted runs yet.</p>
            )}
            {showcase && runs.length > 0 && <p className="rail-note">A sanitized capture of a real fixture run. Local installs list runs from .patchbench/runs.</p>}
          </div>
          <div className="rail-foot">
            <div className="label">Workspace</div>
            <dl className="kv">
              <dt>Mode</dt>
              <dd>{config.mode}</dd>
              <dt>Artifacts</dt>
              <dd>{showcase ? "showcase/runs" : ".patchbench/runs"}</dd>
            </dl>
          </div>
        </aside>
        <main className="pb-main" id="main">
          <div className="head">
            <h1>New benchmark</h1>
            <p>
              Point PatchBench at a local repository and describe the defect. <b>Nothing is patched until the bug is reproduced as a failing test.</b>
            </p>
          </div>
          {showcase && <ShowcaseIntro captured={captured} />}
          <NewBenchmarkForm
            mode={config.mode}
            policy={{
              candidateCount: policy.candidateCount,
              timeoutSeconds: Math.round(policy.commandTimeoutMs / 1000),
              maxTurnsPerTask: policy.bob.maxTurnsPerTask,
              maxCostPerTask: policy.bob.maxCostPerTask,
              excludePaths: policy.excludePaths,
              requireTypecheck: policy.requireTypecheck,
              requireBuild: policy.requireBuild,
            }}
          />
        </main>
      </div>
    </div>
  );
}
