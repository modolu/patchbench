import Link from "next/link";
import type { CandidateResult } from "@/domain/candidate";
import type { PatchBenchRun } from "@/domain/run";
import { candidateCheckLines, candidateStatusTone, conciseReason, shortSha, splitFailureId, type CheckLine } from "@/lib/run-view";
import type { RunView } from "@/server/ui/run-reader";
import { StatusPill } from "./status-pill";

const CHECK_GLYPH: Record<CheckLine["state"], { g: string; cls: string; sr: string }> = {
  pass: { g: "✓", cls: "pass", sr: "passed" },
  fail: { g: "✕", cls: "fail", sr: "failed" },
  skipped: { g: "–", cls: "q", sr: "not run" },
  not_configured: { g: "–", cls: "q", sr: "not configured" },
  pending: { g: "○", cls: "q", sr: "pending" },
};

export function IssueCard({ run }: { run: PatchBenchRun }) {
  const { issue } = run;
  return (
    <article className="card card-pad issue" aria-labelledby="issue-title">
      <div className="card-h">
        <span className="label">Bug report</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>
          submitted {run.createdAt.slice(0, 16).replace("T", " ")} UTC
        </span>
      </div>
      <h2 id="issue-title">{issue.title}</h2>
      <p className="desc">{issue.description}</p>
      <dl className="expect">
        <dt>Expected</dt>
        <dd>{issue.expectedBehavior}</dd>
        {issue.actualBehavior && (
          <>
            <dt>Actual</dt>
            <dd className="mono" style={{ fontSize: 11.5 }}>
              {issue.actualBehavior}
            </dd>
          </>
        )}
        {issue.evidence && (
          <>
            <dt>Evidence</dt>
            <dd className="mono" style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>
              {issue.evidence}
            </dd>
          </>
        )}
      </dl>
    </article>
  );
}

export function ReproductionProof({ view }: { view: RunView }) {
  const { run, events } = view;
  const r = run.reproduction;
  const injected = events.filter((e) => e.type === "candidate.regression_injected").length;
  if (!r) {
    return (
      <article className="card card-pad" aria-label="Reproduction gate">
        <div className="card-h">
          <span className="label">Reproduction gate</span>
          <StatusPill tone={run.status === "REPRODUCING" ? "running" : "neutral"} label={run.status === "REPRODUCING" ? "Reproducing" : "Not reached"} />
        </div>
        <p className="note">A regression test must fail on the untouched baseline before any candidate is generated.</p>
      </article>
    );
  }
  const reproduced = r.outcome === "REPRODUCED";
  const failures = r.baselineCheck?.failures ?? [];
  const cmd = r.command ? [r.command.command, ...r.command.args].join(" ") : null;
  return (
    <article className="card card-pad" aria-label="Reproduction gate" data-testid="reproduction-proof">
      <div className="card-h">
        <span className="label">Reproduction gate</span>
        <StatusPill tone={reproduced ? "pass" : "fail"} label={r.outcome} />
      </div>
      <div className="out">
        {cmd && <div className="d">$ {cmd}</div>}
        {r.testFiles.map((f) => (
          <div key={f} className="d">
            {f}
          </div>
        ))}
        {failures.map((f) => (
          <div key={f}>
            <span className={reproduced ? "f" : "d"}>✕</span> <span className="w">{splitFailureId(f).name}</span>
          </div>
        ))}
        <div>
          {"  "}
          <span className="f">{r.expectedFailure}</span>
        </div>
      </div>
      {reproduced ? (
        <p className="note">
          Fails on untouched baseline <span className="mono">{shortSha(run.repository.commitSha)}</span> for the expected reason.
          {r.frozenPatchSha256 && (
            <>
              {" "}
              Frozen as <span className="mono" title={r.frozenPatchSha256}>sha256:{r.frozenPatchSha256.slice(0, 12)}</span>
              {injected > 0 ? <> and injected unchanged into {injected} worktree{injected === 1 ? "" : "s"}.</> : "."}
            </>
          )}
        </p>
      ) : (
        <p className="note">
          <b>{r.reasonCode ?? "Not reproduced"}:</b> {r.reason ?? "The regression test did not fail on the baseline as required."} No candidates are generated from an unreproduced bug.
        </p>
      )}
    </article>
  );
}

export function BaselineStrip({ run }: { run: PatchBenchRun }) {
  const b = run.baseline;
  const tests = b?.checks.find((c) => c.name === "test")?.summary;
  return (
    <div className="baseline-strip" data-testid="baseline-strip">
      <span className="label">Baseline</span>
      <span className="mono">{shortSha(run.repository.commitSha)}</span>
      <span>{run.repository.isDirty ? "primary tree dirty · checks ran in a clean detached worktree" : "clean detached worktree"}</span>
      {b ? (
        <>
          {tests && (
            <span>
              tests <span className="mono">{tests.pass}/{tests.tests}</span>
            </span>
          )}
          {b.checks
            .filter((c) => c.name !== "test")
            .map((c) => (
              <span key={c.name}>
                {c.name} <span className={`g ${c.passed ? "pass" : "fail"}`}>{c.passed ? "✓" : "✕"}</span>
                <span className="sr-only">{c.passed ? " passed" : " failed"}</span>
              </span>
            ))}
          <span data-testid="baseline-preexisting">
            pre-existing failures <span className="mono">{b.failures.length}</span>
          </span>
        </>
      ) : (
        <span>not captured yet</span>
      )}
      <span className="policy">
        <b>Pre-existing baseline failures are recorded, not blocking.</b> Candidates are rejected only for newly introduced failures.
      </span>
    </div>
  );
}

export function displayWorktree(p: string): string {
  const i = p.indexOf(".patchbench/");
  return i >= 0 ? p.slice(i) : p;
}

export function CandidateCard({ view, candidate }: { view: RunView; candidate: CandidateResult }) {
  const { run } = view;
  const strategy = view.strategies[candidate.id];
  const lines = candidateCheckLines(run, candidate);
  const v = candidate.verification;
  const diff = v?.diff ?? candidate.diff;
  const rejected = candidate.status === "REJECTED";
  const anySkipped = lines.some((l) => l.state === "skipped");
  const base = `/runs/${run.id}/evidence?candidate=${encodeURIComponent(candidate.id)}`;
  return (
    <article className="card cand" aria-labelledby={`cand-${candidate.id}`} data-testid={`candidate-card-${candidate.id}`}>
      <div className="cand-h">
        <div className="cand-top">
          <div className="tile" aria-hidden>
            {candidate.id.toUpperCase().slice(0, 2)}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="cand-t" id={`cand-${candidate.id}`}>
              <span className="sr-only">Candidate {candidate.id.toUpperCase()}: </span>
              {strategy?.title ?? candidate.strategyId}
            </h3>
          </div>
          <span className="cand-status">
            <StatusPill small tone={candidateStatusTone(candidate.status)} label={candidate.status} testId={`candidate-status-${candidate.id}`} />
          </span>
        </div>
        <div className="path" title={candidate.branchName}>
          {displayWorktree(candidate.worktreePath)}
        </div>
      </div>
      {rejected && v && v.rejectionReasons.length > 0 && (
        <div className="gatebox" role="note">
          <b>✕ Hard gate failed:</b> {v.rejectionReasons.map(conciseReason).join(" · ")}
          <span>{anySkipped ? "Later checks were not run after the frozen regression failed its integrity gate." : "Every check still ran, so the record is complete."}</span>
        </div>
      )}
      {candidate.failure && !v && (
        <div className="gatebox" role="note">
          <b>✕ {candidate.failure.code}:</b> {candidate.failure.message}
        </div>
      )}
      <ul className="checks" aria-label={`Checks for candidate ${candidate.id.toUpperCase()}`}>
        {lines.map((l) => (
          <li key={l.key} className={l.state}>
            <span className={`g ${CHECK_GLYPH[l.state].cls}`} aria-hidden>
              {CHECK_GLYPH[l.state].g}
            </span>
            <span className="nm">
              {l.name}
              {!l.gate && <span className="tag-info">info</span>}
              <span className="sr-only">
                {" "}
                — {CHECK_GLYPH[l.state].sr}
                {l.gate ? ", hard gate" : ", informational"}
              </span>
            </span>
            <span className="rs">{l.result}</span>
          </li>
        ))}
      </ul>
      <div className="cand-f">
        <span>
          {diff ? (
            <>
              <span className="add">+{diff.insertions}</span> <span className="del">−{diff.deletions}</span> · {diff.filesChanged} file{diff.filesChanged === 1 ? "" : "s"}
            </>
          ) : (
            "no diff yet"
          )}
        </span>
        {rejected ? (
          <Link className="link" href={`${base}&why=1`}>
            Why rejected? →
          </Link>
        ) : (
          <Link className="link" href={base}>
            Inspect →
          </Link>
        )}
      </div>
    </article>
  );
}
