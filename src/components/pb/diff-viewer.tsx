"use client";

import { useMemo, useState } from "react";
import { parseUnifiedDiff } from "@/lib/diff-parse";

const KIND_CLASS = { hunk: "hk", add: "ad", del: "dl", ctx: "cx", meta: "cx" } as const;
const SIGN = { hunk: "", add: "+", del: "−", ctx: "", meta: "" } as const;

/** Code-review style rendering of a persisted candidate diff. */
export function DiffViewer({ patch, emptyText }: { patch: string | null; emptyText: string }) {
  const files = useMemo(() => (patch ? parseUnifiedDiff(patch) : []), [patch]);
  const [active, setActive] = useState(0);
  const file = files[active] ?? files[0];
  if (!file) return <div className="term-empty">{emptyText}</div>;
  return (
    <div className="d-panel" data-testid="diff-viewer">
      <div className="diff-files" role="tablist" aria-label="Changed files">
        {files.map((f, i) => (
          <button key={f.path} type="button" role="tab" aria-selected={f === file} onClick={() => setActive(i)}>
            {f.path} <span className="add">+{f.additions}</span> <span className="del">−{f.deletions}</span>
          </button>
        ))}
      </div>
      <div className="diff" role="region" aria-label={`Diff of ${file.path}`} tabIndex={0}>
        {file.lines.map((l, i) =>
          l.kind === "hunk" ? (
            <div key={i} className="ln hk">
              <span />
              <span />
              <span />
              <span>{l.text}</span>
            </div>
          ) : (
            <div key={i} className={`ln ${KIND_CLASS[l.kind]}`}>
              <span>{l.oldNo ?? ""}</span>
              <span>{l.newNo ?? ""}</span>
              <span aria-hidden>{SIGN[l.kind]}</span>
              <span>
                {l.kind === "add" && <span className="sr-only">added: </span>}
                {l.kind === "del" && <span className="sr-only">removed: </span>}
                {l.text}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
