import { realpath } from "node:fs/promises";
import path from "node:path";

/** realpath of the deepest existing ancestor, re-joined with the missing tail. */
async function resolveReal(target: string): Promise<string> {
  const absolute = path.resolve(target);
  const tail: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      return path.join(await realpath(current), ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

const isInside = (root: string, candidate: string): boolean => {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * Resolves `target` (following symlinks) and returns it only if it lies
 * beneath one of `allowedRoots`. Returns null on escape.
 */
export async function resolveWithinRoots(target: string, allowedRoots: readonly string[]): Promise<string | null> {
  const resolved = await resolveReal(target);
  for (const root of allowedRoots) {
    if (isInside(await resolveReal(root), resolved)) return resolved;
  }
  return null;
}

/** Joins a relative path under `root`, rejecting absolute paths and traversal. */
export async function resolveRelativeWithin(root: string, relative: string): Promise<string | null> {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) return null;
  return resolveWithinRoots(path.join(root, relative), [root]);
}
