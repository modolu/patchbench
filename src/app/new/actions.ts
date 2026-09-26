"use server";

import { realpath } from "node:fs/promises";
import path from "node:path";
import { defaultRunPolicy, type VerificationCommand } from "@/domain/policy";
import type { RepositorySnapshot } from "@/domain/run";
import { GitAdapter } from "@/server/git/git-adapter";
import { captureRepositorySnapshot } from "@/server/runs/repository-snapshot";
import { verificationCommandsFor } from "@/server/runner/script-detector";
import { uiConfig } from "@/server/ui/config";

export type InspectResult =
  | { ok: true; snapshot: RepositorySnapshot; commands: VerificationCommand[] }
  | { ok: false; message: string };

/**
 * Local mode only: read-only inspection of a repository the developer names
 * (git root, HEAD SHA, branch, dirty flag, package.json scripts). Runs no
 * repository scripts and writes nothing.
 */
export async function inspectRepository(repoPath: unknown): Promise<InspectResult> {
  if (uiConfig().mode !== "local") return { ok: false, message: "Repository inspection is disabled in showcase mode." };
  if (typeof repoPath !== "string" || !repoPath.trim() || repoPath.length > 4096 || repoPath.includes("\0")) {
    return { ok: false, message: "Enter an absolute repository path." };
  }
  const trimmed = repoPath.trim();
  if (!path.isAbsolute(trimmed)) return { ok: false, message: "Enter an absolute repository path." };
  let resolved: string;
  try {
    resolved = await realpath(trimmed);
  } catch {
    return { ok: false, message: "That folder does not exist." };
  }
  const snapshot = await captureRepositorySnapshot(new GitAdapter({ allowedRoots: [resolved] }), resolved);
  if (!snapshot.ok) return { ok: false, message: snapshot.error.nextAction ? `${snapshot.error.message} ${snapshot.error.nextAction}` : snapshot.error.message };
  return { ok: true, snapshot: snapshot.value, commands: verificationCommandsFor(snapshot.value, defaultRunPolicy()) };
}
