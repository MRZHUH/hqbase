import { AppError } from "../lib/errors";
import type { WorkspaceRole } from "../lib/validation";

export const mailboxAccessLevels = ["read", "agent", "manager"] as const;
export type MailboxAccessLevel = (typeof mailboxAccessLevels)[number];

const rank: Record<MailboxAccessLevel, number> = { read: 1, agent: 2, manager: 3 };

/**
 * Catch-all messages are stored with `mailbox_id = NULL` because no mailbox matched the
 * recipient address, so per-mailbox grants cannot describe them. They are workspace-scoped
 * instead: only owners, who already see every mailbox, may read or act on them.
 */
export function canAccessCatchall(role: WorkspaceRole): boolean {
  return role === "owner";
}

export type MailboxScope = {
  includeCatchall: boolean;
  mailboxIds: string[];
};

/**
 * Builds the message-visibility predicate for a scope. `mailbox_id IN (...)` alone can never
 * match catch-all rows, because SQL `NULL IN (...)` is never true — the catch-all arm has to be
 * an explicit `IS NULL`. Returns null when the scope selects nothing at all.
 */
export function mailboxScopeSql(
  scope: MailboxScope,
  column: string
): { params: string[]; sql: string } | null {
  const clauses: string[] = [];
  if (scope.mailboxIds.length > 0) {
    clauses.push(`${column} IN (${scope.mailboxIds.map(() => "?").join(", ")})`);
  }
  if (scope.includeCatchall) {
    clauses.push(`${column} IS NULL`);
  }
  if (clauses.length === 0) return null;
  return { params: [...scope.mailboxIds], sql: `(${clauses.join(" OR ")})` };
}

export function accessAllows(
  actual: MailboxAccessLevel | null,
  required: MailboxAccessLevel
): boolean {
  return actual !== null && rank[actual] >= rank[required];
}

export async function mailboxAccess(
  db: D1Database,
  userId: string,
  role: WorkspaceRole,
  mailboxId: string
): Promise<MailboxAccessLevel | null> {
  if (role === "owner") return "manager";
  const row = await db
    .prepare(
      `SELECT g.access_level FROM mailbox_grants g
       JOIN "user" u ON u.id = g.user_id
       WHERE g.mailbox_id = ? AND g.user_id = ? AND COALESCE(u.banned, 0) = 0`
    )
    .bind(mailboxId, userId)
    .first<{ access_level: MailboxAccessLevel }>();
  return row?.access_level ?? null;
}

export async function requireMailboxAccess(
  db: D1Database,
  userId: string,
  role: WorkspaceRole,
  mailboxId: string | null,
  required: MailboxAccessLevel
): Promise<MailboxAccessLevel> {
  if (mailboxId === null) {
    // A catch-all message (or a message that does not exist); callers resolve the latter to 404.
    if (canAccessCatchall(role)) return "manager";
    throw new AppError("MAILBOX_FORBIDDEN", "You do not have access to this mailbox.", 403);
  }
  const actual = await mailboxAccess(db, userId, role, mailboxId);
  if (!accessAllows(actual, required)) {
    throw new AppError("MAILBOX_FORBIDDEN", "You do not have access to this mailbox.", 403);
  }
  return actual as MailboxAccessLevel;
}

export async function accessibleMailboxIds(
  db: D1Database,
  userId: string,
  role: WorkspaceRole,
  required: MailboxAccessLevel
): Promise<string[]> {
  if (role === "owner") {
    const result = await db.prepare("SELECT id FROM mailboxes").all<{ id: string }>();
    return result.results.map((row) => row.id);
  }
  const allowed = mailboxAccessLevels.filter((level) => rank[level] >= rank[required]);
  const placeholders = allowed.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT mailbox_id FROM mailbox_grants
       WHERE user_id = ? AND access_level IN (${placeholders})`
    )
    .bind(userId, ...allowed)
    .all<{ mailbox_id: string }>();
  return result.results.map((row) => row.mailbox_id);
}

export async function accessibleMailboxScope(
  db: D1Database,
  userId: string,
  role: WorkspaceRole,
  required: MailboxAccessLevel
): Promise<MailboxScope> {
  return {
    includeCatchall: canAccessCatchall(role),
    mailboxIds: await accessibleMailboxIds(db, userId, role, required)
  };
}
