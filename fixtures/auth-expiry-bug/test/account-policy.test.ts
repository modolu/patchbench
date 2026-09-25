import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./harness.ts";

test("refresh for a disabled account returns 403 account_disabled", () => {
  assert.deepEqual(setup().post("/auth/refresh", { refreshToken: "rt_disabled_user" }), {
    status: 403,
    body: { error: "account_disabled" },
  });
});

test("refresh during a token-store outage returns 503, not an auth error", () => {
  const { store, post } = setup();
  store.setAvailable(false);
  assert.deepEqual(post("/auth/refresh", { refreshToken: "rt_valid" }), { status: 503, body: { error: "service_unavailable" } });
});

test("unexpected errors return an opaque 500", () => {
  const { app } = setup();
  const res = app({ method: "POST", path: "/auth/login", body: { get email(): string { throw new Error("boom"); } } });
  assert.deepEqual(res, { status: 500, body: { error: "internal_error" } });
});
