import type { RegressionCommand } from "@/domain/policy";
import type { IssueSpec } from "@/domain/run";
import { REPRODUCTION_RESULT_PATH } from "../schemas";

export const REPRODUCTION_PROMPT_VERSION = "reproduction.v1";

export interface ReproductionPromptInput {
  issue: IssueSpec;
  /** Absolute path of the PatchBench-owned workspace Bob works in. */
  workspace: string;
  baseSha: string;
  /** The command PatchBench itself will run, with the test files appended. */
  regressionCommand: RegressionCommand;
}

/**
 * Reproduction task (architecture §12). Describes the bug and the protocol,
 * never the fix. Everything Bob returns is re-verified by the reproduction gate.
 */
export function buildReproductionPrompt(input: ReproductionPromptInput): string {
  const { issue } = input;
  const optional = (label: string, value: string | undefined) => (value ? `- **${label}:** ${value}\n` : "");
  const command = [input.regressionCommand.command, ...input.regressionCommand.args, "<your test files>"].join(" ");
  return `# PatchBench — Reproduction task (${REPRODUCTION_PROMPT_VERSION})

You are writing a **failing regression test** for a reported bug. Do **not** fix the bug.

## Workspace

- Folder: \`${input.workspace}\`
- Baseline commit: \`${input.baseSha}\` (do not commit, checkout, reset, stash, or branch)
- Work only inside this folder.

## Bug report

- **Title:** ${issue.title}
- **Description:** ${issue.description}
- **Expected behaviour:** ${issue.expectedBehavior}
${optional("Actual behaviour", issue.actualBehavior)}${optional("Hints", issue.reproductionHints)}${optional("Evidence", issue.evidence)}
## What to do

1. Inspect the repository and its existing tests to understand the reported behaviour.
2. Add the **smallest** new test file that asserts the expected behaviour.
3. On the current, unfixed code the test must **fail with an assertion failure** — not a load error, type error, or thrown exception.
4. Give the failing assertion an explicit message stating the expected and actual behaviour.

## Hard constraints (PatchBench rejects the run otherwise)

- Create only **new** files matching \`test/**/*.test.ts\`. Do not edit, delete, or rename any existing file.
- Do not modify production source code, configuration, lockfiles, or existing tests. Do not loosen any assertion.
- Do not install dependencies, create symlinks, or read \`.env\` files.
- PatchBench runs exactly \`${command}\` itself. Any command you suggest is informational only.

## Structured result (required)

When finished, write **only** this JSON to \`${REPRODUCTION_RESULT_PATH}\` inside the workspace:

\`\`\`json
{
  "schemaVersion": 1,
  "status": "completed",
  "testFiles": ["test/<name>.test.ts"],
  "expectedFailure": "<short text that appears verbatim in the failing assertion's message on the current code>",
  "proposedCommand": "<optional, informational>",
  "summary": "<one or two sentences on what the test asserts>"
}
\`\`\`

- \`testFiles\`: workspace-relative paths of every file you created (excluding the result file).
- If you cannot write a valid reproduction, write \`{ "schemaVersion": 1, "status": "blocked", "summary": "<why>" }\` instead.
- No other keys. Do not run \`git add\` or \`git commit\`.
`;
}
