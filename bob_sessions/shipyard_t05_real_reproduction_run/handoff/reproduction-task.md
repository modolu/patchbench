# PatchBench — Reproduction task (reproduction.v1)

You are writing a **failing regression test** for a reported bug. Do **not** fix the bug.

## Workspace

- Folder: `<LIVE_ROOT>/runtime/worktrees/run-20260926064335-0a4172/reproduction`
- Baseline commit: `ad6b83d8a2b68a9220a8374cb5e24202edac07cd` (do not commit, checkout, reset, stash, or branch)
- Work only inside this folder.

## Bug report

- **Title:** Expired refresh token returns HTTP 500 instead of 401
- **Description:** POST /auth/refresh with an expired refresh token responds with HTTP 500 { error: "internal_error" }. Clients treat 5xx as an outage and retry instead of sending the user back to log in.
- **Expected behaviour:** POST /auth/refresh with an expired refresh token responds with HTTP 401, as documented in the README API contract.
- **Actual behaviour:** HTTP 500 internal_error.

## What to do

1. Inspect the repository and its existing tests to understand the reported behaviour.
2. Add the **smallest** new test file that asserts the expected behaviour.
3. On the current, unfixed code the test must **fail with an assertion failure** — not a load error, type error, or thrown exception.
4. Give the failing assertion an explicit message stating the expected and actual behaviour.

## Hard constraints (PatchBench rejects the run otherwise)

- Create only **new** files matching `test/**/*.test.ts`. Do not edit, delete, or rename any existing file.
- Do not modify production source code, configuration, lockfiles, or existing tests. Do not loosen any assertion.
- Do not install dependencies, create symlinks, or read `.env` files.
- PatchBench runs exactly `node --test --test-reporter=tap <your test files>` itself. Any command you suggest is informational only.

## Structured result (required)

When finished, write **only** this JSON to `.patchbench-handoff/reproduction-result.json` inside the workspace:

```json
{
  "schemaVersion": 1,
  "status": "completed",
  "testFiles": ["test/<name>.test.ts"],
  "expectedFailure": "<short text that appears verbatim in the failing assertion's message on the current code>",
  "proposedCommand": "<optional, informational>",
  "summary": "<one or two sentences on what the test asserts>"
}
```

- `testFiles`: workspace-relative paths of every file you created (excluding the result file).
- If you cannot write a valid reproduction, write `{ "schemaVersion": 1, "status": "blocked", "summary": "<why>" }` instead.
- No other keys. Do not run `git add` or `git commit`.
