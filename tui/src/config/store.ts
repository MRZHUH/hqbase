import fs from "node:fs";
import path from "node:path";

import { credentialsPath, normalizeOrigin, settingsPath } from "./paths.js";

export type Credentials = {
  origin: string;
  clientId: string;
  clientSecret: string | null;
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
};

export type Settings = {
  defaultOrigin: string | null;
};

const fileMode = 0o600;
const directoryMode = 0o700;

export function readSettings(): Settings {
  const parsed = readJson<Partial<Settings>>(settingsPath());
  return { defaultOrigin: typeof parsed?.defaultOrigin === "string" ? parsed.defaultOrigin : null };
}

export function writeSettings(settings: Settings): void {
  writeOwnerOnly(settingsPath(), JSON.stringify(settings, null, 2));
}

export function readCredentials(origin: string): Credentials | null {
  const parsed = readJson<Partial<Credentials>>(credentialsPath(origin));
  if (!parsed || typeof parsed.accessToken !== "string" || typeof parsed.clientId !== "string") {
    return null;
  }
  return {
    origin: normalizeOrigin(origin),
    clientId: parsed.clientId,
    clientSecret: typeof parsed.clientSecret === "string" ? parsed.clientSecret : null,
    accessToken: parsed.accessToken,
    refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
    expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
    scopes: Array.isArray(parsed.scopes)
      ? parsed.scopes.filter((scope): scope is string => typeof scope === "string")
      : []
  };
}

export function writeCredentials(credentials: Credentials): void {
  writeOwnerOnly(credentialsPath(credentials.origin), JSON.stringify(credentials, null, 2));
}

export function deleteCredentials(origin: string): void {
  fs.rmSync(credentialsPath(origin), { force: true });
}

/**
 * Writes a file only its owner can read.
 *
 * `umask` cannot be relied on to produce that, and a file created wide and
 * narrowed afterwards is readable for the instant in between, so the mode is
 * given at creation and reasserted on an existing file before anything is
 * written into it.
 */
export function writeOwnerOnly(target: string, contents: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: directoryMode });
  fs.chmodSync(path.dirname(target), directoryMode);
  const handle = fs.openSync(target, "w", fileMode);
  try {
    fs.fchmodSync(handle, fileMode);
    fs.writeFileSync(handle, contents);
  } finally {
    fs.closeSync(handle);
  }
}

function readJson<T>(target: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8")) as T;
  } catch {
    return null;
  }
}
