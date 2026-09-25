import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./harness.ts";

test("expired refresh token is rejected", () => {
  const res = setup().post("/auth/refresh", { refreshToken: "rt_expired" });
  assert.notEqual(res.status, 200, `expected 401, received ${res.status}`);
});
