"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Re-reads persisted state on demand. No polling, no simulated progress. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn ghost" onClick={() => start(() => router.refresh())} disabled={pending}>
      {pending ? "Reading…" : "Refresh state"}
    </button>
  );
}
