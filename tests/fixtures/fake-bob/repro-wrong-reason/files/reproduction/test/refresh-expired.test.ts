import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./harness.ts";

test("expired refresh token returns 401, not 500", () => {
  const res = setup().post("/auth/refresh", { refreshToken: "rt_expired" });
  assert.deepEqual(res.body, { error: "session_gone" }, "unexpected refresh body");
});
