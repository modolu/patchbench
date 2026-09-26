import { formatDuration, type TimelineStage } from "@/lib/run-view";

const ICON: Record<TimelineStage["state"], string> = { done: "✓", failed: "✕", active: "●", todo: "" };
const STATE_TEXT: Record<TimelineStage["state"], string> = { done: "done", failed: "stopped", active: "in progress", todo: "not reached" };

/** Persisted pipeline stages; durations come only from event timestamps. */
export function PipelineTimeline({ stages }: { stages: TimelineStage[] }) {
  return (
    <ol className="timeline" aria-label="Pipeline stages" data-testid="pipeline-timeline">
      {stages.map((s) => (
        <li key={s.key} className={s.state} data-stage={s.key} data-state={s.state}>
          <span className="tl-ico" aria-hidden>
            {ICON[s.state]}
          </span>
          <div>
            <div className="tl-name">
              {s.name}
              <span className="sr-only"> — {STATE_TEXT[s.state]}</span>
            </div>
            <div className="tl-sub">{s.detail}</div>
          </div>
          <span className="tl-time">{formatDuration(s.durationMs) ?? "—"}</span>
        </li>
      ))}
    </ol>
  );
}
