import { HttpError, InvalidTokenError, TokenExpiredError } from "./errors.ts";
import type { TokenStore } from "./token-store.ts";

export interface User {
  id: string;
  email: string;
  /** Synthetic fixture credential; never a real password. */
  password: string;
  disabled: boolean;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export type Clock = () => number;

export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class AuthService {
  private readonly store: TokenStore;
  private readonly users: readonly User[];
  private readonly clock: Clock;
  private counter = 0;

  constructor(store: TokenStore, users: readonly User[], clock: Clock) {
    this.store = store;
    this.users = users;
    this.clock = clock;
  }

  login(email: string, password: string): Session {
    const user = this.users.find((u) => u.email === email);
    if (!user || user.password !== password) throw new HttpError(401, "invalid_credentials");
    if (user.disabled) throw new HttpError(403, "account_disabled");
    return this.issue(user.id);
  }

  /** Rotates a refresh token: the presented token is revoked and a new session issued. */
  refresh(refreshToken: string): Session {
    const record = this.store.get(refreshToken);
    if (!record || record.revoked) throw new InvalidTokenError("refresh token not recognised");
    if (record.expiresAt <= this.clock()) throw new TokenExpiredError(record.expiresAt);

    const user = this.users.find((u) => u.id === record.userId);
    if (!user) throw new InvalidTokenError("refresh token owner not found");
    if (user.disabled) throw new HttpError(403, "account_disabled");

    this.store.revoke(refreshToken);
    return this.issue(user.id);
  }

  private issue(userId: string): Session {
    this.counter += 1;
    const refreshToken = `rt_${userId}_${this.counter}`;
    this.store.put({ token: refreshToken, userId, expiresAt: this.clock() + REFRESH_TTL_MS, revoked: false });
    return { accessToken: `at_${userId}_${this.counter}`, refreshToken };
  }
}
