import type { DatabaseSync } from "node:sqlite";

import { type Client, createClient } from "../api/client.js";
import { normalizeOrigin } from "../config/paths.js";
import { type Credentials, readCredentials, readSettings } from "../config/store.js";
import { openCache } from "../store/db.js";

export type Session = {
  origin: string;
  credentials: Credentials;
  client: Client;
  db: DatabaseSync;
  close(): void;
};

export class NotSignedInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotSignedInError";
  }
}

/** The workspace a command acts on: `--origin`, else the one login remembered. */
export function resolveOrigin(explicit: string | undefined): string {
  const chosen = explicit ?? readSettings().defaultOrigin;
  if (!chosen) {
    throw new NotSignedInError(
      "No workspace is configured. Run: hqbase-mail login https://mail.example.com"
    );
  }
  return normalizeOrigin(chosen);
}

export function openSession(explicit: string | undefined): Session {
  const origin = resolveOrigin(explicit);
  const credentials = readCredentials(origin);
  if (!credentials) {
    throw new NotSignedInError(`Not signed in to ${origin}. Run: hqbase-mail login ${origin}`);
  }
  const db = openCache(origin);
  return {
    origin,
    credentials,
    client: createClient(credentials),
    db,
    close: () => db.close()
  };
}
