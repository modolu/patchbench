import { createApp, type Request } from "../src/app.ts";
import { AuthService, type User } from "../src/auth-service.ts";
import { TokenStore } from "../src/token-store.ts";

/** Fixed clock: 2026-01-01T00:00:00Z. All data is synthetic. */
export const NOW = Date.UTC(2026, 0, 1);
const DAY = 24 * 60 * 60 * 1000;

export const USERS: User[] = [
  { id: "u1", email: "ada@example.test", password: "fixture-pass-1", disabled: false },
  { id: "u2", email: "grace@example.test", password: "fixture-pass-2", disabled: true },
];

export function setup() {
  const store = new TokenStore();
  store.put({ token: "rt_valid", userId: "u1", expiresAt: NOW + DAY, revoked: false });
  store.put({ token: "rt_revoked", userId: "u1", expiresAt: NOW + DAY, revoked: true });
  store.put({ token: "rt_expired", userId: "u1", expiresAt: NOW - DAY, revoked: false });
  store.put({ token: "rt_disabled_user", userId: "u2", expiresAt: NOW + DAY, revoked: false });
  const app = createApp(new AuthService(store, USERS, () => NOW));
  const post = (path: string, body?: unknown) => app({ method: "POST", path, body } satisfies Request);
  return { store, app, post };
}
