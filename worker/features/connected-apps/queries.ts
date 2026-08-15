import { parseStoredList } from "../../auth/oauth-bearer";
import { nowIso } from "../../db/client";

import type { ConnectedApp, ConnectedAppRow } from "./types";

/**
 * The applications one user has authorized. Every query in this module is bound
 * to a single `userId` with no role escape hatch: an owner has no more business
 * reading another person's authorizations than a member does.
 */
export async function listConnectedApps(db: D1Database, userId: string): Promise<ConnectedApp[]> {
  const now = nowIso();
  const result = await db
    .prepare(
      `SELECT oc.clientId,
              c.name,
              c.uri,
              oc.scopes,
              oc.createdAt AS granted_at,
              (SELECT MAX(at.lastUsedAt)
                 FROM oauthAccessToken at
                WHERE at.clientId = oc.clientId AND at.userId = oc.userId) AS last_used_at,
              (SELECT COUNT(*)
                 FROM oauthAccessToken at
                WHERE at.clientId = oc.clientId AND at.userId = oc.userId
                  AND at.revoked IS NULL AND at.expiresAt > ?) AS active_token_count,
              (SELECT at.resources
                 FROM oauthAccessToken at
                WHERE at.clientId = oc.clientId AND at.userId = oc.userId
                  AND at.revoked IS NULL AND at.expiresAt > ?
                ORDER BY at.createdAt DESC LIMIT 1) AS resources
         FROM oauthConsent oc
         JOIN oauthClient c ON c.clientId = oc.clientId
        WHERE oc.userId = ?
        ORDER BY oc.createdAt DESC`
    )
    .bind(now, now, userId)
    .all<ConnectedAppRow>();

  return result.results.map((row) => ({
    clientId: row.clientId,
    // Dynamically registered clients may omit a name; the identifier is the
    // only thing left to show, and it is what the consent screen showed too.
    name: row.name?.trim() || row.clientId,
    uri: row.uri,
    scopes: parseStoredList(row.scopes),
    resources: parseStoredList(row.resources),
    grantedAt: row.granted_at,
    lastUsedAt: row.last_used_at,
    activeTokenCount: row.active_token_count
  }));
}

/**
 * Withdraws one user's authorization for one application: the consent goes, and
 * every credential minted under it stops working. Access tokens are marked
 * revoked rather than deleted so a replayed token is refused by the same check
 * that refuses an expired one.
 */
export async function revokeConnectedApp(
  db: D1Database,
  userId: string,
  clientId: string
): Promise<boolean> {
  const consent = await db
    .prepare(`SELECT id FROM oauthConsent WHERE userId = ? AND clientId = ?`)
    .bind(userId, clientId)
    .first<{ id: string }>();
  if (!consent) return false;

  const revokedAt = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE oauthAccessToken SET revoked = ?
          WHERE userId = ? AND clientId = ? AND revoked IS NULL`
      )
      .bind(revokedAt, userId, clientId),
    db
      .prepare(
        `UPDATE oauthRefreshToken SET revoked = ?
          WHERE userId = ? AND clientId = ? AND revoked IS NULL`
      )
      .bind(revokedAt, userId, clientId),
    db.prepare(`DELETE FROM oauthConsent WHERE userId = ? AND clientId = ?`).bind(userId, clientId)
  ]);
  return true;
}
