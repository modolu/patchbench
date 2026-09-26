import { readdir } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { EvidenceWorkbench } from "@/components/pb/evidence-workbench";
import { NewBenchmarkForm } from "@/components/pb/new-benchmark-form";
import { BaselineStrip, CandidateCard } from "@/components/pb/run-overview";
import { ShowcaseIntro } from "@/components/pb/showcase-intro";
import { uiConfig } from "@/server/ui/config";
import { listRunSummaries, loadRunView, type RunView } from "@/server/ui/run-reader";
import { REPO_ROOT } from "../helpers/scenario";

let view: RunView;

beforeAll(async () => {
  const showcaseRoot = path.join(REPO_ROOT, "showcase");
  const id = (await readdir(path.join(showcaseRoot, "runs")))[0]!;
  const r = await loadRunView(id, uiConfig({ PATCHBENCH_MODE: "showcase", PATCHBENCH_SHOWCASE_ROOT: showcaseRoot }, REPO_ROOT));
  if (!r.ok) throw new Error(r.message);
  view = r.view;
});

const workbench = (extra: { initialCandidate?: string; initialWhy?: boolean } = {}) =>
  renderToStaticMarkup(
    <EvidenceWorkbench
      runId={view.run.id}
      baselineSha={view.run.repository.commitSha}
      matrix={view.matrix}
      candidates={view.run.candidates}
      strategies={view.strategies}
      diffs={view.diffs}
      logs={view.logs.filter((l) => l.scope === "candidate")}
      timeoutSeconds={120}
      {...extra}
    />,
  );

const section = (html: string, marker: string) => html.slice(html.indexOf(marker));
const row = (html: string, key: string) => {
  const start = html.indexOf(`data-row="${key}"`);
  return html.slice(start, html.indexOf("</tr>", start));
};

describe("evidence matrix", () => {
  it("renders verdicts from persisted state: A eligible, B rejected, C eligible", () => {
    const html = workbench();
    expect(html).toMatch(/data-testid="verdict-a"[^>]*>.*?ELIGIBLE/);
    expect(html).toMatch(/data-testid="verdict-b"[^>]*>.*?REJECTED/);
    expect(html).toMatch(/data-testid="verdict-c"[^>]*>.*?ELIGIBLE/);
    expect(html).toContain('data-testid="why-b"');
    expect(html).not.toContain('data-testid="why-a"');
    expect(html).not.toMatch(/best candidate|winner|recommended|score:/i);
  });

  it("groups lint under informational evidence and new failures under hard gates", () => {
    const html = workbench();
    const hard = html.slice(html.indexOf("Hard gates"), html.indexOf("Evidence<span>"));
    const info = html.slice(html.indexOf("Evidence<span>"));
    expect(hard).toContain('data-row="new_failures"');
    expect(hard).toContain('data-row="typecheck"');
    expect(hard).not.toContain('data-row="lint"');
    expect(info).toContain('data-row="lint"');
    expect(info).toContain('data-row="preserved_failures"');
    expect(row(html, "lint")).toContain("not required by run policy");
  });

  it("shows exactly two new failures for B and none for A/C", () => {
    const r = row(workbench(), "new_failures");
    expect(r).toMatch(/data-candidate="b" data-status="fail"/);
    expect(r).toMatch(/data-candidate="a" data-status="pass"/);
    expect(r).toMatch(/data-candidate="c" data-status="pass"/);
    const b = view.run.candidates.find((c) => c.id === "b")!.verification!.newFailures;
    expect(b).toHaveLength(2);
  });

  it("selects the requested candidate in the detail pane; a rejected candidate stays fully inspectable", () => {
    const html = workbench({ initialCandidate: "b", initialWhy: true });
    const detail = section(html, 'data-testid="candidate-detail"');
    expect(detail).toContain('data-candidate="b"');
    expect(detail).toContain("Treat any refresh failure as unauthorized");
    expect(detail).toContain('data-testid="rejection-box"');
    const failures = detail.slice(detail.indexOf('data-testid="rejection-new-failures"'));
    expect((failures.slice(0, failures.indexOf("</ul>")).match(/<li>/g) ?? []).length).toBe(2);
    expect(detail).toContain("refresh for a disabled account returns 403 account_disabled");
    expect(detail).toContain('class="vfocus"');
    expect(html).toMatch(/<tr class="focus" data-row="new_failures"/);
    expect(detail).toContain('aria-selected="true"');
  });

  it("defaults to the first candidate and shows its real diff", () => {
    const detail = section(workbench(), 'data-testid="candidate-detail"');
    expect(detail).toContain('data-candidate="a"');
    expect(detail).toContain("src/http-errors.ts");
    expect(detail).not.toContain('data-testid="rejection-box"');
  });

  it("does not claim parallel verification", () => {
    expect(workbench()).not.toMatch(/parallel/i);
  });
});

describe("run overview", () => {
  it("states that baseline failures are recorded, not blocking", () => {
    const html = renderToStaticMarkup(<BaselineStrip run={view.run} />);
    expect(html).toContain("Pre-existing baseline failures are recorded, not blocking.");
    expect(html).toContain("rejected only for newly introduced failures");
  });

  it("shows a dirty primary as isolated, not as a blocker", () => {
    const html = renderToStaticMarkup(<BaselineStrip run={{ ...view.run, repository: { ...view.run.repository, isDirty: true } }} />);
    expect(html).toContain("primary tree dirty · checks ran in a clean detached worktree");
  });

  it("renders the rejected card with a why-rejected link and lint marked informational", () => {
    const b = renderToStaticMarkup(<CandidateCard view={view} candidate={view.run.candidates.find((c) => c.id === "b")!} />);
    expect(b).toContain("Hard gate failed:");
    expect(b).toContain("Introduced new test failures (2)");
    expect(b).toContain("evidence?candidate=b&amp;why=1");
    expect(b).toMatch(/Lint<span class="tag-info">info<\/span>/);
    expect(b).toContain("11/13 · 2 new");
  });
});

describe("new benchmark form", () => {
  const policy = { candidateCount: 3, timeoutSeconds: 120, maxTurnsPerTask: 20, maxCostPerTask: 1, excludePaths: [".git"], requireTypecheck: true, requireBuild: true };
  it("disables every execution control in showcase mode", () => {
    const html = renderToStaticMarkup(<NewBenchmarkForm mode="showcase" policy={policy} />);
    expect(html).toContain("Execution is disabled in showcase mode.");
    expect(html).not.toContain("not wired yet");
    expect(html).toMatch(/<input id="repo"[^>]*disabled/);
    expect(html).toMatch(/<button type="submit"[^>]*disabled/);
  });
  it("showcase intro links to the persisted captured run without claiming hosted execution", async () => {
    const config = uiConfig({ PATCHBENCH_MODE: "showcase", PATCHBENCH_SHOWCASE_ROOT: path.join(REPO_ROOT, "showcase") }, REPO_ROOT);
    const captured = (await listRunSummaries(config)).find((r) => r.status === "COMPLETE");
    expect(captured).toMatchObject({ repoName: "auth-expiry-bug", eligible: 2, rejected: 1 });
    const html = renderToStaticMarkup(<ShowcaseIntro captured={captured} />);
    expect(html).toContain("Repository execution runs locally in PatchBench.");
    expect(html).toContain(`href="/runs/${captured!.id}"`);
    expect(html).toContain("View captured benchmark");
    expect(html).not.toMatch(/never uploaded|not wired/);
  });
  it("uses accurate local-first copy", () => {
    const html = renderToStaticMarkup(<NewBenchmarkForm mode="local" policy={policy} />);
    expect(html).not.toMatch(/never uploaded|parallel|BLOCKED_BASELINE/);
    expect(html).toContain("Pre-existing baseline failures are recorded, not blocking.");
    expect(html).toContain("A dirty primary working tree is allowed");
  });
});
