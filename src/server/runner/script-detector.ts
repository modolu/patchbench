import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { RunPolicy, VerificationCommand } from "@/domain/policy";
import type { PackageManager, RepositorySnapshot } from "@/domain/run";

const PackageJsonSchema = z.object({
  packageManager: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});

const VERIFICATION_SCRIPTS = ["test", "lint", "typecheck", "build"] as const;
type VerificationScript = (typeof VERIFICATION_SCRIPTS)[number];

const LOCKFILES: ReadonlyArray<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

const exists = (p: string) => access(p).then(() => true, () => false);

export interface ScriptDetection {
  packageManager: PackageManager;
  detectedScripts: RepositorySnapshot["detectedScripts"];
}

/** Reads package.json scripts. Only reports scripts that exist — never invents commands. */
export async function detectScripts(repoRoot: string): Promise<ScriptDetection | null> {
  let pkg: z.infer<typeof PackageJsonSchema>;
  try {
    const parsed = PackageJsonSchema.safeParse(JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ repoRoot, "package.json"), "utf8")));
    if (!parsed.success) return null;
    pkg = parsed.data;
  } catch {
    return null;
  }

  let packageManager: PackageManager = "unknown";
  const declared = pkg.packageManager?.split("@")[0];
  if (declared === "pnpm" || declared === "npm" || declared === "yarn") {
    packageManager = declared;
  } else {
    for (const [file, pm] of LOCKFILES) {
      if (await exists(path.join(/*turbopackIgnore: true*/ repoRoot, file))) {
        packageManager = pm;
        break;
      }
    }
  }

  const detectedScripts: ScriptDetection["detectedScripts"] = {};
  for (const name of VERIFICATION_SCRIPTS) {
    const body = pkg.scripts?.[name];
    if (body) detectedScripts[name] = body;
  }
  return { packageManager, detectedScripts };
}

/** `<pm> run <script>` as an argument array. npm is used when the manager is unknown. */
export function scriptInvocation(pm: PackageManager, script: VerificationScript): { command: string; args: string[] } {
  return { command: pm === "unknown" ? "npm" : pm, args: ["run", script] };
}

/**
 * Shared verification commands from detected scripts, in the canonical order
 * test → typecheck → lint → build. Absent scripts are simply not configured.
 * `required` follows policy; test pass/fail is judged by new failures vs
 * baseline, and lint is evidence only.
 */
export function verificationCommandsFor(
  repository: Pick<RepositorySnapshot, "packageManager" | "detectedScripts">,
  policy: Pick<RunPolicy, "requireBuild" | "requireTypecheck">,
): VerificationCommand[] {
  const required: Record<VerificationScript, boolean> = { test: true, typecheck: policy.requireTypecheck, lint: false, build: policy.requireBuild };
  return (["test", "typecheck", "lint", "build"] as const)
    .filter((name) => repository.detectedScripts[name])
    .map((name) => ({ name, ...scriptInvocation(repository.packageManager, name), required: required[name] }));
}
