import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./harness.ts";

test("refresh with a valid token rotates the session", () => {
  const { post } = setup();
  const res = post("/auth/refresh", { refreshToken: "rt_valid" });
  assert.equal(res.status, 200);
  assert.notEqual((res.body as { refreshToken: string }).refreshToken, "rt_valid");
});

test("a rotated refresh token cannot be reused", () => {
  const { post } = setup();
  post("/auth/refresh", { refreshToken: "rt_valid" });
  assert.deepEqual(post("/auth/refresh", { refreshToken: "rt_valid" }), { status: 401, body: { error: "invalid_token" } });
});

test("unknown refresh token returns 401 invalid_token", () => {
  assert.deepEqual(setup().post("/auth/refresh", { refreshToken: "rt_unknown" }), { status: 401, body: { error: "invalid_token" } });
});

test("revoked refresh token returns 401 invalid_token", () => {
  assert.deepEqual(setup().post("/auth/refresh", { refreshToken: "rt_revoked" }), { status: 401, body: { error: "invalid_token" } });
});

test("missing refreshToken returns 400 invalid_request", () => {
  assert.deepEqual(setup().post("/auth/refresh", {}), { status: 400, body: { error: "invalid_request" } });
});
