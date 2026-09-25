import { FlaskConical, GitBranch } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";

const PROTOCOL: Array<{ stage: string; detail: string; tone: StatusTone; label: string }> = [
  { stage: "Baseline", detail: "Record commit SHA and verification status before any generated code exists.", tone: "pass", label: "Captured" },
  { stage: "Reproduce", detail: "Regression test must fail on the untouched baseline.", tone: "pass", label: "Reproduced" },
  { stage: "Freeze", detail: "Regression artifact is hashed and injected unchanged into every candidate.", tone: "pass", label: "Frozen" },
  { stage: "Strategize", detail: "Up to three materially different repair strategies.", tone: "running", label: "Running" },
  { stage: "Isolate", detail: "One Git worktree per candidate, all from the same SHA.", tone: "pending", label: "Pending" },
  { stage: "Verify", detail: "Identical regression, tests, typecheck, lint and build for every candidate.", tone: "pending", label: "Pending" },
  { stage: "Evidence", detail: "Hard gates reject; informational evidence stays visible. No opaque score.", tone: "pending", label: "Pending" },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <span className="flex items-center gap-2 font-mono text-sm tracking-tight">
            <FlaskConical aria-hidden className="size-4 text-running" />
            patchbench
          </span>
          <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
            <GitBranch aria-hidden className="size-3.5" />
            local engine
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">PatchBench</h1>
        <p className="mt-2 max-w-2xl text-lg text-muted">
          Make AI patches prove themselves. Candidate fixes compete against a reproducible regression test and identical
          verification before a developer trusts one.
        </p>

        <section aria-labelledby="protocol" className="mt-10 rounded-md border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id="protocol" className="text-sm font-medium">
              Benchmark protocol
            </h2>
            <span className="font-mono text-xs text-muted">Reproduce before repair</span>
          </div>
          <ol className="divide-y divide-border">
            {PROTOCOL.map((step, i) => (
              <li key={step.stage} className="flex items-start gap-4 px-4 py-3">
                <span className="w-6 pt-0.5 font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{step.stage}</p>
                  <p className="text-sm text-muted">{step.detail}</p>
                </div>
                <StatusBadge tone={step.tone} label={step.label} />
              </li>
            ))}
          </ol>
        </section>
        <p className="mt-3 font-mono text-xs text-muted">Illustrative states. Benchmark creation arrives in a later milestone.</p>
      </main>
    </div>
  );
}
