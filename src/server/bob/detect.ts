import { access, constants, stat } from "node:fs/promises";
import path from "node:path";

export type BobIntegration = { kind: "shell"; executable: string } | { kind: "manual"; reason: string };

/**
 * Chooses the Bob integration path (architecture §11). Looks for a `bob`
 * executable on PATH without running it; the IDE launcher (`bobide`) is not
 * Bob Shell and does not count. Falls back to the manual IDE hand-off.
 */
export async function detectBobIntegration(env: Readonly<Record<string, string | undefined>> = process.env): Promise<BobIntegration> {
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, "bob");
    const isExecutableFile = await stat(candidate).then(
      (st) => st.isFile() && access(candidate, constants.X_OK).then(() => true, () => false),
      () => false,
    );
    if (isExecutableFile) return { kind: "shell", executable: candidate };
  }
  return { kind: "manual", reason: "No Bob Shell `bob` executable on PATH; use the Bob IDE task packet." };
}
