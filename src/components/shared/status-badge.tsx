import { CircleCheck, CircleDashed, CircleX, LoaderCircle, Minus } from "lucide-react";

export type StatusTone = "pending" | "running" | "pass" | "fail" | "neutral";

const TONES: Record<StatusTone, { icon: typeof CircleCheck; className: string }> = {
  pending: { icon: CircleDashed, className: "text-muted border-border" },
  running: { icon: LoaderCircle, className: "text-running border-running/40" },
  pass: { icon: CircleCheck, className: "text-pass border-pass/40" },
  fail: { icon: CircleX, className: "text-fail border-fail/40" },
  neutral: { icon: Minus, className: "text-muted border-border" },
};

/** Status is conveyed by icon + label, not colour alone. */
export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  const { icon: Icon, className } = TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xs uppercase tracking-wide ${className}`}>
      <Icon aria-hidden className={`size-3.5 ${tone === "running" ? "animate-spin [animation-duration:2s]" : ""}`} />
      {label}
    </span>
  );
}
