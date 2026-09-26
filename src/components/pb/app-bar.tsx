import Link from "next/link";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/run-view";

const MARK: Record<Tone, string> = { pass: "#8BBB8E", fail: "#E4705F", running: "#F0A63A", neutral: "#A39E94" };

export interface Crumb {
  label: string;
  href?: string;
  mono?: boolean;
}

export function AppBar({ crumbs, tone = "neutral", status, children }: { crumbs: Crumb[]; tone?: Tone; status?: ReactNode; children?: ReactNode }) {
  return (
    <header className="appbar">
      <Link href="/new" className="brand" aria-label="PatchBench home">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <rect x="6" y="2" width="6" height="5" rx="1" stroke={MARK[tone]} strokeWidth="1.5" />
          <path d="M1.5 9.5h15M4 9.5V16M14 9.5V16" stroke="#ECE7DD" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        PatchBench
      </Link>
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} className="contents">
            {i > 0 && <span className="sep" aria-hidden>/</span>}
            {c.href ? (
              <Link href={c.href} className={c.mono ? "mono" : undefined}>
                {c.label}
              </Link>
            ) : (
              <span className={`cur${c.mono ? " mono" : ""}`} aria-current="page">
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>
      {status}
      <div className="spacer" />
      {children}
    </header>
  );
}

export function ModeNote({ mode }: { mode: "local" | "showcase" }) {
  return mode === "showcase" ? (
    <span className="appbar-note">showcase · captured run · execution disabled</span>
  ) : (
    <span className="appbar-note">local execution · only scoped task context is provided to Bob</span>
  );
}
