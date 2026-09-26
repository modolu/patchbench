/** Placeholder that replaces machine-specific roots in exported/showcase artifacts. */
export const SHOWCASE_LOCAL_ROOT = "<local>";

/**
 * Absolute machine paths that must never reach a public showcase: macOS/Linux
 * home and temp roots, file URLs, and Windows drive paths.
 */
const ABSOLUTE_PATH = /(?:file:\/\/)?(?:\/(?:Users|home|root|private|var\/folders|tmp|Volumes)\/[^\s"'`)<>\]]*|\b[A-Za-z]:\\[^\s"'`)<>\]]*)/g;

export function findAbsolutePaths(text: string): string[] {
  return [...text.matchAll(ABSOLUTE_PATH)].map((m) => m[0]);
}

/** Replaces any absolute machine path with `<local>/<basename>`. Idempotent. */
export function scrubAbsolutePaths(text: string): string {
  return text.replace(ABSOLUTE_PATH, (match) => {
    const base = match.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
    return base ? `${SHOWCASE_LOCAL_ROOT}/${base}` : SHOWCASE_LOCAL_ROOT;
  });
}

/** Deep-scrubs every string in a JSON-compatible value. */
export function scrubValue<T>(value: T): T {
  if (typeof value === "string") return scrubAbsolutePaths(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubValue(v)])) as T;
  }
  return value;
}
