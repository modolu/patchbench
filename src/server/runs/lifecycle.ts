import type { PatchBenchError } from "@/domain/errors";
import type { PatchBenchRun, RunStatus } from "@/domain/run";
import { err, ok, type Result } from "@/lib/result";
import { isoNow, systemClock, type Clock } from "@/lib/time";
import { applyRunTransition } from "./state-machine";
import type { FileRunStore } from "./store";

/**
 * Validates, records, and persists one run status transition.
 * The event is appended before run.json is rewritten so the log never lags state.
 */
export async function transitionRun(
  store: FileRunStore,
  runId: string,
  to: RunStatus,
  opts: { failure?: PatchBenchError; clock?: Clock } = {},
): Promise<Result<PatchBenchRun, PatchBenchError>> {
  const loaded = await store.loadRun(runId);
  if (!loaded.ok) return loaded;
  const from = loaded.value.status;
  const next = applyRunTransition(loaded.value, to, { at: isoNow(opts.clock ?? systemClock), failure: opts.failure });
  if (!next.ok) return err(next.error);
  await store.appendEvent(runId, {
    type: "run.status_changed",
    data: { from, to, ...(opts.failure ? { failureCode: opts.failure.code } : {}) },
  });
  await store.saveRun(next.value);
  return ok(next.value);
}
