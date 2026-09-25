# Engineering standards

- Strict TypeScript; no `any` without a documented reason.
- Validate every external/process/model boundary with Zod (`src/domain/`, `src/server/bob/schemas.ts`).
- Subsystems return `Result<T, PatchBenchError>` with typed error codes; UI never shows raw stack traces.
- Spawn processes only via `runCommand` (arg arrays, timeout, cwd allow-list, redaction).
- Filesystem writes: resolve beneath allowed roots; atomic temp+rename for JSON state.
- Domain logic stays independent of React; prefer small pure functions and explicit state tables.
- Tests required for orchestration, state transitions, path safety, redaction, and evidence logic.
