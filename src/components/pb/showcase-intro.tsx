import Link from "next/link";
import type { RunSummary } from "@/server/ui/run-reader";

/**
 * Showcase-mode lead for /new. The hosted build never executes repositories,
 * so it points at the captured, verified benchmark instead of an idle form.
 */
export function ShowcaseIntro({ captured }: { captured: RunSummary | undefined }) {
  return (
    <section className="showcase-intro" aria-labelledby="showcase-h" data-testid="showcase-intro">
      <div className="si-copy">
        <div className="label">Showcase mode</div>
        <h2 id="showcase-h">Repository execution runs locally in PatchBench.</h2>
        <p id="showcase-desc">
          This hosted build uses a captured, verified benchmark. Its evidence is read from the persisted run artifact; the form below shows what a local run starts from, with every execution
          control disabled.
        </p>
      </div>
      {captured ? (
        <div className="si-run">
          <div className="si-facts mono">
            <span>{captured.repoName}</span>
            <span className="sep" aria-hidden>
              ·
            </span>
            <span>{captured.status}</span>
            <span className="sep" aria-hidden>
              ·
            </span>
            <span>
              {captured.eligible} eligible · {captured.rejected} rejected
            </span>
          </div>
          <Link href={`/runs/${captured.id}`} className="btn primary si-cta" data-testid="showcase-cta">
            View captured benchmark <span aria-hidden>→</span>
          </Link>
        </div>
      ) : (
        <p className="rail-note">No captured benchmark is bundled with this build.</p>
      )}
    </section>
  );
}
