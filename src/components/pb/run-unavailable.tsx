import Link from "next/link";

/** Safe error state: never echoes paths, stack traces, or schema detail. */
export function RunUnavailable({ title = "This run cannot be displayed", message }: { title?: string; message: string }) {
  return (
    <main className="state-page" role="alert" data-testid="run-unavailable">
      <p className="label">PatchBench</p>
      <h1>{title}</h1>
      <p>{message}</p>
      <p>
        <Link className="link" href="/new">
          ← Back to benchmarks
        </Link>
      </p>
    </main>
  );
}
