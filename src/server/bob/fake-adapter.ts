import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { CandidateStrategy } from "@/domain/candidate";
import { pbError, type PatchBenchError } from "@/domain/errors";
import { isSafeId } from "@/lib/ids";
import { resolveRelativeWithin } from "@/lib/paths";
import { err, ok, type Result } from "@/lib/result";
import type { BobAdapter, ImplementationInput, ReproductionInput, StrategyInput } from "./adapter";
import { ReproductionProposalSchema, StrategiesSchema, type ImplementationResult, type ReproductionProposal } from "./schemas";

/** Sorted relative file list, so output order is deterministic across platforms. */
async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(dir, prefix), { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(dir, rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Deterministic stand-in for Bob, driven by a pre-authored scenario directory
 * (see tests/fixtures/fake-bob/<scenario>/README.md). Writes files into the
 * workspace exactly as a real Bob task would, then returns validated payloads.
 */
export class FakeBobAdapter implements BobAdapter {
  readonly kind = "fake" as const;

  constructor(private readonly scenarioDir: string) {}

  async generateReproduction(input: ReproductionInput): Promise<Result<ReproductionProposal, PatchBenchError>> {
    const proposal = await this.readJson("reproduction.json", ReproductionProposalSchema);
    if (!proposal.ok) return proposal;
    const source = path.join(this.scenarioDir, "files", "reproduction");
    const files = await listFiles(source);
    const declared = [...proposal.value.testFiles].sort();
    if (JSON.stringify(files) !== JSON.stringify(declared)) {
      // A reproduction may only add the declared test files — never production code.
      return err(pbError("BOB_OUTPUT_INVALID", "Reproduction wrote files other than its declared tests.", { detail: files.join(", ") }));
    }
    const copied = await this.copyInto(source, files, input.workspace, []);
    return copied.ok ? ok(proposal.value) : copied;
  }

  async generateStrategies(input: StrategyInput): Promise<Result<CandidateStrategy[], PatchBenchError>> {
    const strategies = await this.readJson("strategies.json", StrategiesSchema);
    if (!strategies.ok) return strategies;
    return ok(strategies.value.slice(0, input.maxStrategies));
  }

  async implementStrategy(input: ImplementationInput): Promise<Result<ImplementationResult, PatchBenchError>> {
    if (!isSafeId(input.strategy.id)) return err(pbError("BOB_OUTPUT_INVALID", "Unsafe strategy id."));
    const source = path.join(this.scenarioDir, "files", "candidates", input.strategy.id);
    let files: string[];
    try {
      files = await listFiles(source);
    } catch {
      return err(pbError("BOB_OUTPUT_INVALID", `Scenario has no implementation for strategy ${input.strategy.id}.`));
    }
    const copied = await this.copyInto(source, files, input.workspace, input.frozenTestPaths);
    if (!copied.ok) return copied;
    return ok({ changedFiles: files, summary: `Fake implementation of "${input.strategy.title}".`, bobTaskId: `fake-${input.runId}-${input.candidateId}` });
  }

  private async readJson<S extends z.ZodType>(name: string, schema: S): Promise<Result<z.infer<S>, PatchBenchError>> {
    try {
      const parsed = schema.safeParse(JSON.parse(await readFile(path.join(this.scenarioDir, name), "utf8")));
      if (parsed.success) return ok(parsed.data);
      return err(pbError("BOB_OUTPUT_INVALID", `Bob output ${name} failed validation.`, { detail: parsed.error.message }));
    } catch (cause) {
      return err(pbError("BOB_OUTPUT_INVALID", `Bob output ${name} is unreadable.`, { detail: String(cause) }));
    }
  }

  /** Validates every destination before writing anything. */
  private async copyInto(
    source: string,
    files: readonly string[],
    workspace: string,
    frozen: readonly string[],
  ): Promise<Result<void, PatchBenchError>> {
    const targets: Array<[string, string]> = [];
    for (const rel of files) {
      if (frozen.includes(rel)) {
        return err(pbError("REGRESSION_TEST_MUTATED", "Candidate attempted to modify the frozen regression test.", { detail: rel }));
      }
      const target = await resolveRelativeWithin(workspace, rel);
      if (!target) return err(pbError("PATH_OUTSIDE_ALLOWED_ROOT", "Bob output targets a path outside the workspace.", { detail: rel }));
      targets.push([path.join(source, rel), target]);
    }
    for (const [from, to] of targets) {
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
    }
    return ok(undefined);
  }
}
