# .patchbench runtime directory

Local, gitignored runtime state written by the PatchBench engine:

```text
.patchbench/
├── runs/<run-id>/        # run.json, events.jsonl, logs, patches
└── worktrees/<run-id>/   # isolated candidate worktrees
```

Contents may include source snippets and command output. Never commit them.
Captured showcase runs are sanitized and exported explicitly.
