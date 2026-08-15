import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Everything the client keeps on disk is filed under a short digest of the
 * workspace origin, so two workspaces on one machine can never read each other's
 * mail or credentials, and no directory name leaks the hostname of a private
 * deployment to anyone listing the parent directory.
 */
export function workspaceKey(origin: string): string {
  return createHash("sha256").update(normalizeOrigin(origin)).digest("hex").slice(0, 16);
}

export function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.host}`;
}

export function configHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
}

export function dataHome(): string {
  return process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share");
}

export function configRoot(): string {
  return path.join(configHome(), "hqbase-mail");
}

export function settingsPath(): string {
  return path.join(configRoot(), "settings.json");
}

export function credentialsPath(origin: string): string {
  return path.join(configRoot(), workspaceKey(origin), "credentials.json");
}

/**
 * The cache lives under the data directory rather than beside the credentials so
 * clearing one can never destroy the other.
 */
export function cachePath(origin: string): string {
  return path.join(dataHome(), "hqbase-mail", workspaceKey(origin), "cache.db");
}
