import { lstat, mkdir, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pbError, type PatchBenchError } from "@/domain/errors";
import { defaultRunPolicy, type RegressionCommand } from "@/domain/policy";
import { isSafeId } from "@/lib/ids";
import { resolveRelativeWithin } from "@/lib/paths";
import { err, ok, type Result } from "@/lib/result";
import { redactSecrets, secretEnvValues } from "../runner/redaction";
import type { BobAdapter, ReproductionInput } from "./adapter";
import { buildReproductionPrompt } from "./prompts/reproduction.v1";
import { REPRODUCTION_RESULT_PATH, ReproductionHandoffResultSchema, type ReproductionProposal } from "./schemas";

const MAX_RESULT_BYTES = 64 * 1024;

export interface ManualBobAdapterOptions {
  /** Where the task packet and consumed result are kept, e.g. `.patchbench/runs/<id>/handoff`. */
  handoffDir: (runId: string) => string;
  /** How long to wait for the Bob IDE task to write its result. */
  timeoutMs: number;
  pollIntervalMs?: number;
  /** Shown to Bob; PatchBench always runs RunPolicy.regressionCommand itself. */
  regressionCommand?: RegressionCommand;
  /** Called once the packet is written, so a driver can tell the user where it is. */
  onPacketReady?: (info: { packetPath: string; workspace: string; resultPath: string }) => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

const invalid = (message: string, detail?: string) =>
  err(pbError("BOB_OUTPUT_INVALID", message, { detail, recoverable: true, nextAction: "Re-run the Bob IDE task following the packet exactly." }));

/**
 * Bob IDE hand-off (architecture §11.3): writes a task packet, waits for the
 * user to run it in Bob IDE, then ingests Bob's structured result from a
 * reserved workspace path. The adapter only checks the result's shape; the
 * reproduction gate independently verifies every file and runs the test.
 */
export class ManualBobAdapter implements BobAdapter {
  readonly kind = "manual" as const;

  constructor(private readonly options: ManualBobAdapterOptions) {}

  async generateReproduction(input: ReproductionInput): Promise<Result<ReproductionProposal, PatchBenchError>> {
    if (!isSafeId(input.runId)) return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Unsafe run id."));
    const workspace = await realpath(input.workspace).catch(() => null);
    if (!workspace) return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Reproduction workspace does not exist."));

    const dir = this.options.handoffDir(input.runId);
    await mkdir(dir, { recursive: true });
    const packetPath = path.join(dir, "reproduction-task.md");
    const packet = buildReproductionPrompt({
      issue: input.issue,
      workspace,
      baseSha: input.repository.commitSha,
      regressionCommand: this.options.regressionCommand ?? defaultRunPolicy().regressionCommand,
    });
    await writeFile(packetPath, packet, { encoding: "utf8", flag: "wx" });
    const resultPath = path.join(workspace, REPRODUCTION_RESULT_PATH);
    this.options.onPacketReady?.({ packetPath, workspace, resultPath });

    const arrived = await this.waitFor(resultPath, input.signal);
    if (!arrived.ok) return arrived;
    const raw = await this.consume(resultPath);
    if (!raw.ok) return raw;
    const secrets = secretEnvValues(process.env);
    await writeFile(path.join(dir, "reproduction-result.json"), redactSecrets(raw.value, secrets), { encoding: "utf8", flag: "wx" });

    let json: unknown;
    try {
      json = JSON.parse(raw.value);
    } catch (cause) {
      return invalid("Bob's reproduction result is not valid JSON.", String(cause));
    }
    const parsed = ReproductionHandoffResultSchema.safeParse(json);
    if (!parsed.success) return invalid("Bob's reproduction result failed validation.", parsed.error.message);
    const result = parsed.data;
    if (result.status === "blocked") return invalid("Bob reported that it could not write a reproduction.", redactSecrets(result.summary, secrets));

    for (const rel of result.testFiles) {
      const target = await resolveRelativeWithin(workspace, rel);
      const st = target ? await lstat(target).catch(() => null) : null;
      if (!target || !st?.isFile()) return invalid("A declared test file is missing or is not a regular file in the workspace.", rel);
    }
    return ok({
      testFiles: result.testFiles,
      command: redactSecrets(result.proposedCommand ?? "", secrets),
      expectedFailure: result.expectedFailure,
      notes: redactSecrets(result.summary, secrets),
    });
  }

  async generateStrategies(): Promise<Result<never, PatchBenchError>> {
    return err(pbError("BOB_OPERATION_UNSUPPORTED", "Manual Bob hand-off currently supports reproduction only."));
  }

  async implementStrategy(): Promise<Result<never, PatchBenchError>> {
    return err(pbError("BOB_OPERATION_UNSUPPORTED", "Manual Bob hand-off currently supports reproduction only."));
  }

  private async waitFor(file: string, signal?: AbortSignal): Promise<Result<void, PatchBenchError>> {
    const deadline = Date.now() + this.options.timeoutMs;
    const poll = this.options.pollIntervalMs ?? 1000;
    for (;;) {
      if (signal?.aborted) return err(pbError("COMMAND_CANCELLED", "Bob hand-off was cancelled.", { recoverable: true }));
      if (await lstat(file).then(() => true, () => false)) return ok(undefined);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return err(pbError("COMMAND_TIMEOUT", "Timed out waiting for the Bob IDE reproduction result.", {
          detail: file,
          recoverable: true,
          nextAction: "Run the task packet in Bob IDE, then start a new run.",
        }));
      }
      await sleep(Math.min(poll, remaining), signal);
    }
  }

  /** Reads and removes the reserved result file so only Bob's test files remain for the gate. */
  private async consume(file: string): Promise<Result<string, PatchBenchError>> {
    const dirReal = await realpath(path.dirname(file)).catch(() => null);
    if (dirReal !== path.dirname(file)) return invalid("The hand-off result directory must be a real directory inside the workspace.");
    const st = await lstat(file);
    if (!st.isFile()) return invalid("The hand-off result must be a regular file (no symlinks).");
    if (st.size > MAX_RESULT_BYTES) return invalid(`The hand-off result exceeds ${MAX_RESULT_BYTES} bytes.`);
    const raw = await readFile(file, "utf8");
    await rm(file);
    // Leaves anything else Bob put there in place, so the gate rejects it as an undeclared change.
    await rmdir(path.dirname(file)).catch(() => undefined);
    return ok(raw);
  }
}
