import { randomBytes } from "node:crypto";

/**
 * Safe identifier: lowercase alphanumerics and single dashes, max 64 chars.
 * Run/candidate IDs are embedded in filesystem paths and Git branch names,
 * so anything outside this alphabet is rejected rather than escaped.
 */
const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isSafeId(value: string): boolean {
  return SAFE_ID.test(value) && !value.includes("--");
}

export function assertSafeId(value: string, label = "id"): string {
  if (!isSafeId(value)) {
    throw new Error(`Unsafe ${label}: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Sortable run ID: `run-<yyyymmddhhmmss>-<6 hex>`. */
export function createRunId(now: Date, random: () => string = () => randomBytes(3).toString("hex")): string {
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return assertSafeId(`run-${stamp}-${random()}`, "run id");
}
