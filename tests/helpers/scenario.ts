import { cp } from "node:fs/promises";
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const FIXTURE_DIR = path.join(REPO_ROOT, "fixtures", "auth-expiry-bug");
export const FAKE_SCENARIO_DIR = path.join(REPO_ROOT, "tests", "fixtures", "fake-bob", "auth-expiry-bug");

/** Copies the fixture source (no node_modules/dist) into `dest`. */
export async function copyFixture(dest: string): Promise<string> {
  await cp(FIXTURE_DIR, dest, {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|dist)([\\/]|$)/.test(path.relative(FIXTURE_DIR, src) ? `/${path.relative(FIXTURE_DIR, src)}` : ""),
  });
  return dest;
}
