# shipyard_t05_real_reproduction_history.md

---

**Status:** active  **Date:** 2026-09-26

---

### 👤 User

# PatchBench — Reproduction task (reproduction.v1)

You are writing a **failing regression test** for a reported bug. Do **not** fix the bug.

## Workspace

- Folder: `/Users/Apple/patchbench-live-t05/runtime/worktrees/run-20260926064335-0a4172/reproduction`
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

---

### 🤖 Assistant

> 🔧 called: list_files

I'll investigate the repository structure and existing tests to understand the bug, then write a failing regression test.

> 🔧 **list_files** — .

### 🤖 Assistant

> 🔧 called: list_files, list_files



> 🔧 **list_files** — src

> 🔧 **list_files** — test

### 🤖 Assistant

> 🔧 called: read_file, read_file, read_file



> 🔧 **read_file** — src/auth-service.ts

> 🔧 **read_file** — test/refresh.test.ts

> 🔧 **read_file** — src/errors.ts

### 🤖 Assistant

> 🔧 called: read_file, read_file



> 🔧 **read_file** — src/app.ts

> 🔧 **read_file** — test/harness.ts

### 🤖 Assistant

> 🔧 called: read_file



> 🔧 **read_file** — src/http-errors.ts

### 🤖 Assistant

> 🔧 called: update_todo_list

The bug is clear. [`toErrorResponse()`](src/http-errors.ts:8) in [`src/http-errors.ts`](src/http-errors.ts) does not handle `TokenExpiredError` — it falls through to the generic 500 branch. The harness already seeds an `rt_expired` token, but there's no test asserting that it returns 401.

> 🔧 **update_todo_list** — 
[-] Write failing regression test for expired refresh token returning 500 instead of 401
[ ] Write .patchbench-handoff/reproduction-result.json


### 🤖 Assistant

> 🔧 called: execute_command



> 🔧 **execute_command** — mkdir -p test

### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — test/refresh-expired.test.ts

### 🤖 Assistant

> 🔧 called: execute_command

Now let me verify the test actually fails on the current code:

> 🔧 **execute_command** — node --test --test-reporter=tap test/refresh-expired.test.ts 2>&1

### 🤖 Assistant

> 🔧 called: execute_command

The test fails with the expected assertion message: `Expected HTTP 401 for an expired refresh token but got HTTP 500 (body: {"error":"internal_error"}). The server is returning 500 internal_error instead of 401.`

Now write the handoff result:

> 🔧 **execute_command** — mkdir -p .patchbench-handoff

### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — .patchbench-handoff/reproduction-result.json

### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[x] Write failing regression test for expired refresh token returning 500 instead of 401
[x] Write .patchbench-handoff/reproduction-result.json


### 🤖 Assistant

The regression test is in place and confirmed failing. Here's the summary:

**Root cause:** [`toErrorResponse()`](src/http-errors.ts:8) in `src/http-errors.ts` handles `ValidationError`, `InvalidTokenError`, and `HttpError` — but not `TokenExpiredError`. When [`AuthService.refresh()`](src/auth-service.ts:44) throws a `TokenExpiredError` for an expired token, the error falls through to the final `return { status: 500, body: { error: "internal_error" } }` catch-all.

**Test:** [`test/refresh-expired.test.ts`](test/refresh-expired.test.ts) POSTs the pre-seeded `rt_expired` token (already set up in the harness at `NOW - DAY`) and asserts the response status is `401`. On the unfixed code it fails with:

> `Expected HTTP 401 for an expired refresh token but got HTTP 500 (body: {"error":"internal_error"}). The server is returning 500 internal_error instead of 401.`