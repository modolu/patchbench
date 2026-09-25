import type { AuthService } from "./auth-service.ts";
import { ValidationError } from "./errors.ts";
import { toErrorResponse } from "./http-errors.ts";

export interface Request {
  method: string;
  path: string;
  body?: unknown;
}

export interface Response {
  status: number;
  body: unknown;
}

function requireString(body: unknown, field: string): string {
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[field] : undefined;
  if (typeof value !== "string" || value.length === 0) throw new ValidationError(`${field} is required`);
  return value;
}

/** Framework-free request handler, so tests need no network or server. */
export function createApp(auth: AuthService): (req: Request) => Response {
  return (req) => {
    try {
      if (req.method === "POST" && req.path === "/auth/login") {
        const session = auth.login(requireString(req.body, "email"), requireString(req.body, "password"));
        return { status: 200, body: session };
      }
      if (req.method === "POST" && req.path === "/auth/refresh") {
        const session = auth.refresh(requireString(req.body, "refreshToken"));
        return { status: 200, body: session };
      }
      return { status: 404, body: { error: "not_found" } };
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
