import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pbError, type PatchBenchError } from "@/domain/errors";
import { RunEventSchema, type RunEvent, type RunEventInput } from "@/domain/events";
import { PatchBenchRunSchema, type PatchBenchRun } from "@/domain/run";
import { assertSafeId } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import { isoNow, systemClock, type Clock } from "@/lib/time";

/** Write via temp file + rename so readers never observe a partial file. */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, filePath);
}

/**
 * Filesystem run store: `<runtimeRoot>/runs/<run-id>/{run.json,events.jsonl}`.
 * No database (ADR-002). Event appends are serialized per run so `seq` stays
 * strictly increasing within one process.
 */
export class FileRunStore {
  private readonly runsDir: string;
  private readonly seqByRun = new Map<string, number>();
  private readonly queueByRun = new Map<string, Promise<unknown>>();

  constructor(
    readonly runtimeRoot: string,
    private readonly clock: Clock = systemClock,
  ) {
    this.runsDir = path.join(path.resolve(runtimeRoot), "runs");
  }

  runDir(runId: string): string {
    return path.join(this.runsDir, assertSafeId(runId, "run id"));
  }

  async createRun(run: PatchBenchRun): Promise<Result<RunEvent, PatchBenchError>> {
    const parsed = PatchBenchRunSchema.parse(run);
    const dir = this.runDir(parsed.id);
    try {
      await mkdir(this.runsDir, { recursive: true });
      await mkdir(dir); // fails if the run already exists
    } catch (cause) {
      return err(pbError("RUN_CORRUPT", "Run directory already exists.", { detail: String(cause) }));
    }
    await writeFileAtomic(path.join(dir, "run.json"), `${JSON.stringify(parsed, null, 2)}\n`);
    await writeFile(path.join(dir, "events.jsonl"), "", { flag: "wx" });
    return ok(await this.appendEvent(parsed.id, { type: "run.created", data: { status: parsed.status } }));
  }

  async saveRun(run: PatchBenchRun): Promise<void> {
    const parsed = PatchBenchRunSchema.parse(run);
    await writeFileAtomic(path.join(this.runDir(parsed.id), "run.json"), `${JSON.stringify(parsed, null, 2)}\n`);
  }

  async loadRun(runId: string): Promise<Result<PatchBenchRun, PatchBenchError>> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.runDir(runId), "run.json"), "utf8");
    } catch {
      return err(pbError("RUN_NOT_FOUND", `Run ${runId} was not found.`, { recoverable: false }));
    }
    try {
      const parsed = PatchBenchRunSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return err(pbError("RUN_CORRUPT", `Run ${runId} has an invalid run.json.`, { detail: parsed.error.message }));
      }
      return ok(parsed.data);
    } catch (cause) {
      return err(pbError("RUN_CORRUPT", `Run ${runId} has unreadable run.json.`, { detail: String(cause) }));
    }
  }

  async listRunIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.runsDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
      return [];
    }
  }

  appendEvent(runId: string, input: RunEventInput): Promise<RunEvent> {
    const previous = this.queueByRun.get(runId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.appendEventNow(runId, input));
    this.queueByRun.set(runId, next);
    return next;
  }

  private async appendEventNow(runId: string, input: RunEventInput): Promise<RunEvent> {
    const file = path.join(this.runDir(runId), "events.jsonl");
    let seq = this.seqByRun.get(runId);
    if (seq === undefined) {
      const existing = await this.readEvents(runId);
      seq = existing.at(-1)?.seq ?? 0;
    }
    const event = RunEventSchema.parse({ ...input, seq: seq + 1, runId, at: isoNow(this.clock) });
    await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
    this.seqByRun.set(runId, event.seq);
    return event;
  }

  /** Reads events, tolerating a torn final line from an interrupted append. */
  async readEvents(runId: string): Promise<RunEvent[]> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.runDir(runId), "events.jsonl"), "utf8");
    } catch {
      return [];
    }
    const events: RunEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = RunEventSchema.safeParse(JSON.parse(line));
        if (parsed.success) events.push(parsed.data);
      } catch {
        // Partial trailing line; skip.
      }
    }
    return events;
  }
}
