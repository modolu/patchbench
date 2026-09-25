import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { pbError, type PatchBenchError } from "@/domain/errors";
import { resolveWithinRoots } from "@/lib/paths";
import { err, ok, type Result } from "@/lib/result";
import { redactSecrets, secretEnvValues } from "./redaction";

export interface CommandSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  /** Complete environment for the child. Build it with `buildCommandEnv`. */
  env: Record<string, string>;
}

export interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Redacted and bounded. */
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
}

export interface RunOptions {
  /** cwd must resolve beneath one of these (repository/worktree/runtime dirs). */
  allowedRoots: readonly string[];
  maxOutputBytes?: number;
  signal?: AbortSignal;
  /** Grace period between SIGTERM and SIGKILL. */
  killGraceMs?: number;
  /** Extra literal values to redact from captured output. */
  secrets?: readonly string[];
}

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

/** Picks allow-listed variables from the parent env, then applies explicit overrides. */
export function buildCommandEnv(
  allowList: readonly string[],
  extra: Record<string, string> = {},
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of allowList) {
    const value = source[name];
    if (typeof value === "string") env[name] = value;
  }
  return { ...env, ...extra };
}

class BoundedBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  truncated = false;
  constructor(private readonly limit: number) {}
  push(chunk: Buffer): void {
    const room = this.limit - this.size;
    if (room <= 0) {
      this.truncated = true;
      return;
    }
    const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
    if (slice.length < chunk.length) this.truncated = true;
    this.chunks.push(slice);
    this.size += slice.length;
  }
  toString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

/**
 * The single boundary for executing repository commands.
 * No shell: `command` + `args` go straight to spawn. The child gets its own
 * process group so timeout/cancel kill the whole tree.
 */
export async function runCommand(spec: CommandSpec, opts: RunOptions): Promise<Result<CommandResult, PatchBenchError>> {
  if (!spec.command.trim()) return err(pbError("COMMAND_FAILED", "Empty command."));
  if (!(spec.timeoutMs > 0)) return err(pbError("COMMAND_FAILED", "A positive timeout is required."));

  const cwd = await resolveWithinRoots(spec.cwd, opts.allowedRoots);
  if (!cwd) {
    return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Command directory is outside the allowed workspace.", { detail: spec.cwd }));
  }
  try {
    if (!(await stat(cwd)).isDirectory()) throw new Error("not a directory");
  } catch {
    return err(pbError("COMMAND_FAILED", "Command directory does not exist.", { detail: cwd }));
  }
  if (opts.signal?.aborted) return err(pbError("COMMAND_CANCELLED", "Command cancelled before start.", { recoverable: true }));

  const limit = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const secrets = [...secretEnvValues(spec.env), ...secretEnvValues(process.env), ...(opts.secrets ?? [])];
  const stdout = new BoundedBuffer(limit);
  const stderr = new BoundedBuffer(limit);
  const started = performance.now();

  return new Promise((resolve) => {
    let timedOut = false;
    let cancelled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const child = spawn(spec.command, [...spec.args], {
      cwd,
      // Next.js augments ProcessEnv with a required NODE_ENV; the child env is
      // deliberately minimal (allow-listed), so widen the type here only.
      env: spec.env as NodeJS.ProcessEnv,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const killTree = () => {
      if (child.pid === undefined || child.exitCode !== null) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      killTimer = setTimeout(() => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }, opts.killGraceMs ?? 2_000);
      killTimer.unref();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      killTree();
    }, spec.timeoutMs);

    const onAbort = () => {
      cancelled = true;
      killTree();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));

    child.on("error", (cause) => {
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(err(pbError("COMMAND_FAILED", `Could not start ${spec.command}.`, { detail: redactSecrets(String(cause), secrets) })));
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(
        ok({
          exitCode,
          signal,
          stdout: redactSecrets(stdout.toString(), secrets),
          stderr: redactSecrets(stderr.toString(), secrets),
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
          durationMs: Math.round(performance.now() - started),
          timedOut,
          cancelled,
        }),
      );
    });
  });
}
