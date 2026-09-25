import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCommandEnv, runCommand } from "@/server/runner/command-runner";
import { makeTempDir } from "../helpers/factories";

let tmp: Awaited<ReturnType<typeof makeTempDir>>;
beforeEach(async () => {
  tmp = await makeTempDir();
});
afterEach(() => tmp.cleanup());

const env = () => buildCommandEnv(["PATH"]);
const node = (script: string, extra: Partial<Parameters<typeof runCommand>[0]> = {}) => ({
  command: process.execPath,
  args: ["-e", script],
  cwd: tmp.dir,
  timeoutMs: 10_000,
  env: env(),
  ...extra,
});

describe("runCommand", () => {
  it("captures stdout, stderr, exit code and duration", async () => {
    const r = await runCommand(node("console.log('out'); console.error('err'); process.exit(3)"), { allowedRoots: [tmp.dir] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ exitCode: 3, stdout: "out\n", stderr: "err\n", timedOut: false, cancelled: false });
    expect(r.value.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes arguments literally without a shell", async () => {
    const r = await runCommand(
      { ...node("console.log(process.argv[1])"), args: ["-e", "console.log(process.argv[1])", "$(echo pwned); rm -rf /"] },
      { allowedRoots: [tmp.dir] },
    );
    expect(r.ok && r.value.stdout).toBe("$(echo pwned); rm -rf /\n");
  });

  it("kills the process tree on timeout", async () => {
    const r = await runCommand(node("setInterval(() => {}, 1000)", { timeoutMs: 300 }), {
      allowedRoots: [tmp.dir],
      killGraceMs: 200,
    });
    expect(r.ok && r.value).toMatchObject({ timedOut: true, exitCode: null });
  });

  it("supports cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const r = await runCommand(node("setInterval(() => {}, 1000)"), { allowedRoots: [tmp.dir], signal: controller.signal });
    expect(r.ok && r.value).toMatchObject({ cancelled: true, timedOut: false });
  });

  it("bounds captured output and flags truncation", async () => {
    const r = await runCommand(node("process.stdout.write('x'.repeat(50000))"), { allowedRoots: [tmp.dir], maxOutputBytes: 1000 });
    expect(r.ok && r.value.stdout.length).toBe(1000);
    expect(r.ok && r.value.stdoutTruncated).toBe(true);
  });

  it("redacts secrets from env and patterns before returning output", async () => {
    const r = await runCommand(
      node("console.log('key is ' + process.env.BOB_API_KEY); console.log('password=hunter2222')", {
        env: { ...env(), BOB_API_KEY: "live-bob-key-987654" },
      }),
      { allowedRoots: [tmp.dir] },
    );
    expect(r.ok && r.value.stdout).toBe("key is [REDACTED]\npassword=[REDACTED]\n");
  });

  it("only forwards allow-listed environment variables", async () => {
    const e = buildCommandEnv(["PATH"], { EXTRA: "1" }, { PATH: "/bin", SECRET_THING: "x" });
    expect(e).toEqual({ PATH: "/bin", EXTRA: "1" });
  });

  it("refuses a cwd outside the allowed roots", async () => {
    const root = path.join(tmp.dir, "repo");
    await mkdir(root);
    const r = await runCommand(node("1", { cwd: tmp.dir }), { allowedRoots: [root] });
    expect(r.ok || r.error.code).toBe("PATH_OUTSIDE_ALLOWED_ROOT");
  });

  it("returns a typed error for a missing executable", async () => {
    const r = await runCommand({ ...node(""), command: "definitely-not-a-real-binary-pb" }, { allowedRoots: [tmp.dir] });
    expect(r.ok || r.error.code).toBe("COMMAND_FAILED");
  });

  it("requires a positive timeout", async () => {
    const r = await runCommand(node("1", { timeoutMs: 0 }), { allowedRoots: [tmp.dir] });
    expect(r.ok).toBe(false);
  });
});
