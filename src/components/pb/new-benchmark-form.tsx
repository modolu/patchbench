"use client";

import { useId, useState, useTransition } from "react";
import { inspectRepository, type InspectResult } from "@/app/new/actions";

export interface PolicySummary {
  candidateCount: number;
  timeoutSeconds: number;
  maxTurnsPerTask: number;
  maxCostPerTask: number;
  excludePaths: string[];
  requireTypecheck: boolean;
  requireBuild: boolean;
}

const COMMAND_LABEL: Record<string, string> = { test: "Tests", typecheck: "Typecheck", lint: "Lint", build: "Production build" };
const COMMAND_ROLE: Record<string, string> = {
  test: "hard gate · new failures only",
  typecheck: "hard gate",
  build: "hard gate",
  lint: "evidence · not required",
};

/**
 * New-benchmark form (mockup screen 01). Repository inspection is a real,
 * read-only server action in local mode. Starting a run from the UI is not
 * wired in this build, so the start control stays honestly disabled. In
 * showcase mode the page leads with ShowcaseIntro and every control is disabled.
 */
export function NewBenchmarkForm({ mode, policy }: { mode: "local" | "showcase"; policy: PolicySummary }) {
  const showcase = mode === "showcase";
  const [repoPath, setRepoPath] = useState("");
  const [inspection, setInspection] = useState<InspectResult | null>(null);
  const [pending, startInspect] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [evidence, setEvidence] = useState("");
  const [hints, setHints] = useState("");
  const [open, setOpen] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const optId = useId();

  const snapshot = inspection?.ok ? inspection.snapshot : null;
  const commands = inspection?.ok ? inspection.commands : [];
  const optionalFilled = [actual, evidence, hints].filter((v) => v.trim()).length;
  const ready: Array<[boolean, string]> = [
    [!!snapshot, snapshot ? `Repository inspected · baseline ${snapshot.commitSha.slice(0, 7)}` : "Repository inspected"],
    [!!title.trim(), "Bug title"],
    [!!description.trim(), "Description"],
    [!!expected.trim(), "Expected behavior"],
    [trusted, "Script execution acknowledged"],
  ];
  const defectOk = !!(title.trim() && description.trim() && expected.trim());

  const inspect = () => {
    startInspect(async () => setInspection(await inspectRepository(repoPath)));
  };

  return (
    <form className="nb" onSubmit={(e) => e.preventDefault()} aria-describedby={showcase ? "showcase-desc" : undefined}>
      <div className="nb-col">
        <section className="card" aria-labelledby="step-repo">
          <div className="step-h">
            <span className={`stepn${snapshot ? " ok" : ""}`} aria-hidden>
              {snapshot ? "✓" : "1"}
            </span>
            <h2 id="step-repo">Repository</h2>
            <span className="sub">local git · node.js / typescript</span>
          </div>
          <div className="step-b">
            <div className="field">
              <label htmlFor="repo">
                Repository path <span className="req">REQUIRED</span>
              </label>
              <div className="frow">
                <input
                  id="repo"
                  className="input mono"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="/absolute/path/to/repository"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={showcase}
                />
                <button type="button" className="btn" style={{ height: 37 }} onClick={inspect} disabled={showcase || pending || !repoPath.trim()}>
                  {pending ? "Inspecting…" : "Inspect"}
                </button>
              </div>
              {inspection && !inspection.ok && (
                <span className="hint err" role="alert">
                  {inspection.message}
                </span>
              )}
              {snapshot && (
                <div className="chips" data-testid="repo-chips">
                  <span className="chip">
                    <span className="gl">✓</span>git repository
                  </span>
                  {snapshot.isDirty ? (
                    <span className="chip warn" title="Uncommitted changes never reach the benchmark: baseline and candidates run from the recorded commit.">
                      working tree dirty · isolated baseline
                    </span>
                  ) : (
                    <span className="chip">
                      <span className="gl">✓</span>working tree clean
                    </span>
                  )}
                  <span className="chip">{snapshot.packageManager === "unknown" ? "package manager unknown" : snapshot.packageManager}</span>
                  <span className="chip">
                    {Object.keys(snapshot.detectedScripts).length} verification script{Object.keys(snapshot.detectedScripts).length === 1 ? "" : "s"}
                  </span>
                </div>
              )}
            </div>
            <div className="fgrid2">
              <div className="field">
                <span className="flabel">Branch</span>
                <div className="readonly">{snapshot ? <b>{snapshot.branch ?? "detached HEAD"}</b> : "—"}</div>
              </div>
              <div className="field">
                <span className="flabel">Baseline commit</span>
                <div className="readonly" data-testid="baseline-sha">
                  {snapshot ? (
                    <>
                      <b>{snapshot.commitSha.slice(0, 7)}</b>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{snapshot.commitSha}</span>
                    </>
                  ) : (
                    "resolved from HEAD after inspection"
                  )}
                </div>
              </div>
            </div>
            {snapshot?.isDirty && (
              <p className="hint" style={{ marginTop: 10 }}>
                Dirty local changes do not contaminate evidence: baseline checks and every candidate run in clean worktrees at <span className="mono">{snapshot.commitSha.slice(0, 7)}</span>.
              </p>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="step-defect">
          <div className="step-h">
            <span className={`stepn${defectOk ? " ok" : ""}`} aria-hidden>
              {defectOk ? "✓" : "2"}
            </span>
            <h2 id="step-defect">Defect</h2>
            <span className="sub">bob turns this into the regression test</span>
          </div>
          <div className="step-b">
            <div className="field">
              <label htmlFor="title">
                Title <span className="req">REQUIRED</span>
                <span className="cnt">{title.length}/120</span>
              </label>
              <input id="title" className="input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} disabled={showcase} />
            </div>
            <div className="field">
              <label htmlFor="desc">
                What&apos;s happening <span className="req">REQUIRED</span>
              </label>
              <textarea id="desc" className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={showcase} />
            </div>
            <div className="field">
              <label htmlFor="exp">
                Expected behavior <span className="req">REQUIRED</span>
              </label>
              <textarea id="exp" className="input mono" rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} disabled={showcase} aria-describedby="exp-hint" />
              <span className="hint" id="exp-hint">
                Write it as something a test could assert: a status, a return value, a thrown error.
              </span>
            </div>
            <button type="button" className="disclose" aria-expanded={open} aria-controls={optId} onClick={() => setOpen((o) => !o)}>
              <span className="car" aria-hidden>
                ›
              </span>
              <span className="t">Add supporting evidence</span>
              <span className="s">{optionalFilled} of 3 optional fields filled</span>
            </button>
            <div className="opt" id={optId} hidden={!open}>
              <div className="field">
                <label htmlFor="act">Actual behavior</label>
                <textarea id="act" className="input mono" rows={1} value={actual} onChange={(e) => setActual(e.target.value)} disabled={showcase} />
              </div>
              <div className="field">
                <label htmlFor="trace">Stack trace or logs</label>
                <textarea id="trace" className="input mono" rows={4} style={{ fontSize: 11.5 }} value={evidence} onChange={(e) => setEvidence(e.target.value)} disabled={showcase} />
                <span className="hint">Don&apos;t paste real credentials: defect text is stored in run.json and given to Bob as scoped task context.</span>
              </div>
              <div className="field">
                <label htmlFor="hints">Reproduction hints</label>
                <input id="hints" className="input" value={hints} onChange={(e) => setHints(e.target.value)} disabled={showcase} />
              </div>
            </div>
          </div>
        </section>

        <div>
          <div className="flow" aria-label="Benchmark protocol">
            {[
              ["01", "Baseline", "clean detached worktree"],
              ["02 · GATE", "Reproduce", "test must fail on baseline"],
              ["03", "Strategize", `up to ${policy.candidateCount} strategies`],
              ["04", "Patch", "1 isolated worktree each"],
              ["05", "Verify", "identical checks, sequential"],
            ].map(([n, t, d]) => (
              <div key={t} className={`fs${n!.includes("GATE") ? " gate" : ""}`}>
                <div className="fn">{n}</div>
                <div className="ft">{t}</div>
                <div className="fd">{d}</div>
              </div>
            ))}
          </div>
          <div className="stopnote">
            <span>
              If the regression test doesn&apos;t fail on the untouched baseline, the run stops as <span className="mono">UNVERIFIED</span>.{" "}
              <b>No candidates are generated from an unreproduced bug.</b>
            </span>
            <span>
              <b>Pre-existing baseline failures are recorded, not blocking.</b> Candidates are rejected only for newly introduced failures. A dirty primary working tree is allowed: checks run in a
              clean detached worktree at the recorded commit.
            </span>
          </div>
        </div>
      </div>

      <div className="nb-col nb-sticky">
        <section className="card" aria-labelledby="step-cmds">
          <div className="step-h">
            <span className={`stepn${commands.length ? " ok" : ""}`} aria-hidden>
              {commands.length ? "✓" : "3"}
            </span>
            <h2 id="step-cmds">Verification commands</h2>
            <span className="sub">from package.json</span>
          </div>
          <div className="step-b" style={{ paddingTop: 0 }}>
            {commands.length ? (
              <ul className="cmds" data-testid="detected-commands">
                {commands.map((c) => (
                  <li key={c.name}>
                    <div style={{ minWidth: 0 }}>
                      <div className="cn">
                        {COMMAND_LABEL[c.name] ?? c.name}
                        <span className={`badge${c.required ? " gate" : ""}`}>{c.required ? (COMMAND_ROLE[c.name] ?? "hard gate") : (COMMAND_ROLE[c.name] ?? "evidence")}</span>
                      </div>
                      <code>{[c.command, ...c.args].join(" ")}</code>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint" style={{ marginTop: 12 }}>
                {showcase ? "Not available in showcase mode." : "Detected after inspection. Only scripts that exist are used; nothing is invented."}
              </p>
            )}
            <p className="hint" style={{ marginTop: 8 }}>
              Only these commands run, and every candidate gets exactly the same set.
            </p>
          </div>
        </section>

        <section className="card" aria-labelledby="step-policy">
          <div className="step-h">
            <span className="stepn ok" aria-hidden>
              ✓
            </span>
            <h2 id="step-policy">Run policy</h2>
            <span className="sub">defaults</span>
          </div>
          <div className="step-b" style={{ paddingTop: 2 }}>
            <PolicyRow name="Candidates" desc="independent strategies" value={String(policy.candidateCount)} />
            <PolicyRow name="Timeout" desc="per command" value={`${policy.timeoutSeconds}s`} />
            <PolicyRow name="Bob turn cap" desc="per task" value={`${policy.maxTurnsPerTask} turns`} />
            <PolicyRow name="Bob cost cap" desc="per task" value={String(policy.maxCostPerTask)} />
            <PolicyRow name="Typecheck / build" desc="hard gates when configured" value={`${policy.requireTypecheck ? "required" : "optional"} / ${policy.requireBuild ? "required" : "optional"}`} />
            <div style={{ marginTop: 10 }}>
              <div className="flabel" style={{ fontSize: 12 }}>
                Excluded from Bob context
              </div>
              <div className="chips" style={{ marginTop: 6 }}>
                {policy.excludePaths.map((p) => (
                  <span key={p} className="chip x">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="card card-pad">
          <label className={`trust${trusted ? " ok" : ""}`}>
            <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} disabled={showcase} />
            <div>
              <div className="tt">I trust this repository to run its own scripts</div>
              <div className="td">
                PatchBench executes the commands above on this machine in one baseline and {policy.candidateCount} candidate worktrees. There is no container sandbox in this version.
              </div>
            </div>
          </label>
          <ul className="ready" aria-label="Readiness">
            {ready.map(([ok, label]) => (
              <li key={label} className={ok ? "" : "no"}>
                <span className={`g${ok ? " pass" : ""}`} aria-hidden>
                  {ok ? "✓" : "○"}
                </span>
                {label}
                <span className="sr-only">{ok ? " — done" : " — missing"}</span>
              </li>
            ))}
          </ul>
          <button type="submit" className="btn primary start" disabled aria-describedby="start-unavailable" data-testid="start-benchmark">
            Start benchmark
          </button>
          <p className="unavailable" id="start-unavailable">
            {showcase ? (
              <>
                <b>Execution is disabled in showcase mode.</b> Benchmarks start from a local PatchBench install; open the captured benchmark to inspect real evidence.
              </>
            ) : (
              <>
                <b>Starting runs from the UI is not wired yet.</b> The engine runs benchmarks today; this form validates input and inspects the repository. Persisted runs appear in the rail.
              </>
            )}
          </p>
        </section>
      </div>
    </form>
  );
}

function PolicyRow({ name, desc, value }: { name: string; desc: string; value: string }) {
  return (
    <div className="pol">
      <div>
        <div className="pn">{name}</div>
        <div className="pd">{desc}</div>
      </div>
      <span className="pv">{value}</span>
    </div>
  );
}
