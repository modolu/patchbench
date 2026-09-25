import { HttpError } from "./errors.ts";

export interface RefreshTokenRecord {
  token: string;
  userId: string;
  expiresAt: number;
  revoked: boolean;
}

/** In-memory refresh-token store. `setAvailable(false)` simulates an outage. */
export class TokenStore {
  private readonly records = new Map<string, RefreshTokenRecord>();
  private available = true;

  setAvailable(available: boolean): void {
    this.available = available;
  }

  put(record: RefreshTokenRecord): void {
    this.ensureAvailable();
    this.records.set(record.token, { ...record });
  }

  get(token: string): RefreshTokenRecord | undefined {
    this.ensureAvailable();
    const record = this.records.get(token);
    return record ? { ...record } : undefined;
  }

  revoke(token: string): void {
    this.ensureAvailable();
    const record = this.records.get(token);
    if (record) record.revoked = true;
  }

  private ensureAvailable(): void {
    if (!this.available) throw new HttpError(503, "service_unavailable", "token store unavailable");
  }
}
