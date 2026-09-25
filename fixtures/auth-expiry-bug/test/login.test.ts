import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./harness.ts";

test("login with valid credentials returns a session", () => {
  const res = setup().post("/auth/login", { email: "ada@example.test", password: "fixture-pass-1" });
  assert.equal(res.status, 200);
  assert.match((res.body as { refreshToken: string }).refreshToken, /^rt_u1_/);
});

test("login with a wrong password returns 401 invalid_credentials", () => {
  const res = setup().post("/auth/login", { email: "ada@example.test", password: "nope" });
  assert.deepEqual(res, { status: 401, body: { error: "invalid_credentials" } });
});

test("login with missing fields returns 400 invalid_request", () => {
  assert.deepEqual(setup().post("/auth/login", { email: "ada@example.test" }), { status: 400, body: { error: "invalid_request" } });
});

test("unknown routes return 404", () => {
  assert.equal(setup().app({ method: "GET", path: "/nope" }).status, 404);
});
