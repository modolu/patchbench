import type { Tone } from "@/lib/run-view";

const GLYPH: Record<Tone, string> = { pass: "✓", fail: "✕", running: "●", neutral: "○" };

/** Status is conveyed by glyph + text, never colour alone. */
export function StatusPill({ tone, label, small = false, testId }: { tone: Tone; label: string; small?: boolean; testId?: string }) {
  return (
    <span className={`pill ${tone}${small ? " sm" : ""}`} data-testid={testId}>
      <span aria-hidden>{GLYPH[tone]}</span>
      {label.replace(/_/g, " ")}
    </span>
  );
}
