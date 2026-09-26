import path from "node:path";
import { z } from "zod";

export const PatchBenchModeSchema = z.enum(["local", "showcase"]);
export type PatchBenchMode = z.infer<typeof PatchBenchModeSchema>;

export interface UiConfig {
  mode: PatchBenchMode;
  /** Local engine runtime root (`.patchbench/`); read only in local mode. */
  runtimeRoot: string;
  /** Committed, sanitized captures (`showcase/`). */
  showcaseRoot: string;
}

/**
 * PATCHBENCH_MODE=local (default) reads local runs plus captured showcase
 * runs; PATCHBENCH_MODE=showcase reads only sanitized captures and disables
 * every execution control. An unknown value falls back to showcase (the safe side).
 */
export function uiConfig(env: Readonly<Record<string, string | undefined>> = process.env, cwd: string = process.cwd()): UiConfig {
  const raw = env.PATCHBENCH_MODE?.trim();
  const parsed = PatchBenchModeSchema.safeParse(raw || "local");
  return {
    mode: parsed.success ? parsed.data : "showcase",
    runtimeRoot: path.resolve(cwd, env.PATCHBENCH_RUNTIME_ROOT?.trim() || ".patchbench"),
    showcaseRoot: path.resolve(cwd, env.PATCHBENCH_SHOWCASE_ROOT?.trim() || "showcase"),
  };
}
