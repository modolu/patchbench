import { z } from "zod";

/**
 * One line of `events.jsonl`. Events are append-only; `seq` is strictly
 * increasing per run. `data` is a small, already-redacted JSON payload.
 */
export const RunEventSchema = z.object({
  seq: z.number().int().positive(),
  runId: z.string(),
  type: z.string().regex(/^[a-z]+(?:\.[a-z_]+)+$/),
  at: z.string(),
  candidateId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export type RunEventInput = Omit<RunEvent, "seq" | "runId" | "at">;
