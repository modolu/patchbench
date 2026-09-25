import { describe, expect, it } from "vitest";
import { redactSecrets, secretEnvValues } from "@/server/runner/redaction";

describe("redactSecrets", () => {
  it.each([
    ["API_KEY=abcd1234efgh", "API_KEY=[REDACTED]"],
    ['bob_api_key: "s3cr3tvalue"', "bob_api_key: [REDACTED]"],
    ["password=hunter22", "password=[REDACTED]"],
    ["Authorization: Bearer abcdefghijklmnop", "Authorization: [REDACTED]"],
    ["token ghp_0123456789abcdefghijABCDEFGHIJ", "token [REDACTED]"],
    ["aws AKIAABCDEFGHIJKLMNOP here", "aws [REDACTED] here"],
    ["jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4", "jwt [REDACTED]"],
  ])("redacts %s", (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it("keeps ordinary test output intact", () => {
    const line = "✖ expired refresh token returns 401 — expected 401, received 500 (12ms)";
    expect(redactSecrets(line)).toBe(line);
  });

  it("redacts exact known secret values anywhere", () => {
    expect(redactSecrets("prefix-zzUniqueValue99-suffix", ["zzUniqueValue99"])).toBe("prefix-[REDACTED]-suffix");
  });

  it("collects values of secret-looking env vars only", () => {
    expect(secretEnvValues({ BOB_API_KEY: "value-123456", PATH: "/usr/bin", GH_TOKEN: "abc" }).sort()).toEqual([
      "value-123456",
    ]);
  });
});
