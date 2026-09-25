const REDACTED = "[REDACTED]";

/**
 * Standalone credential shapes. Applied before the key=value rule so that
 * e.g. `Authorization: Bearer <tok>` redacts the token, not the word "Bearer".
 * Conservative: over-redacting a log line beats persisting a live secret.
 */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** key=value / key: value where the key looks secret. */
const KEY_VALUE_PATTERN =
  /\b([A-Za-z0-9_]*(?:api[_-]?key|secret|token|passw(?:or)?d|credential|auth)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)[^\s"']{4,}\3/gi;

const SECRET_ENV_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;

/** Values of secret-looking env vars, so exact leaks are caught even without a pattern match. */
export function secretEnvValues(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && typeof value === "string" && value.length >= 6)
    .map(([, value]) => value as string);
}

export function redactSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;
  for (const secret of [...knownSecrets].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join(REDACTED);
  }
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED);
  return out.replace(KEY_VALUE_PATTERN, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`);
}
