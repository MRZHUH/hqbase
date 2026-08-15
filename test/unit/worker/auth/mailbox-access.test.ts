import {
  accessAllows,
  accessibleMailboxIds,
  canAccessCatchall,
  mailboxAccess,
  mailboxScopeSql,
  requireMailboxAccess
} from "@worker/auth/mailbox-access";
import { describe, expect, it } from "vitest";

describe("mailbox access levels", () => {
  const db = {
    prepare(sql: string) {
      const statement = {
        bind: () => statement,
        first: async () => ({ access_level: "read" }),
        all: async () => ({
          results: sql.includes("SELECT id FROM mailboxes")
            ? [{ id: "mbx_owner" }]
            : [{ mailbox_id: "mbx_member" }]
        })
      };
      return statement;
    }
  } as unknown as D1Database;

  it("enforces the read-agent-manager hierarchy", () => {
    expect(accessAllows(null, "read")).toBe(false);
    expect(accessAllows("read", "read")).toBe(true);
    expect(accessAllows("read", "agent")).toBe(false);
    expect(accessAllows("agent", "read")).toBe(true);
    expect(accessAllows("agent", "manager")).toBe(false);
    expect(accessAllows("manager", "agent")).toBe(true);
  });

  it("gives owners implicit manager access and resolves member grants", async () => {
    await expect(mailboxAccess(db, "owner", "owner", "mbx_1")).resolves.toBe("manager");
    await expect(mailboxAccess(db, "member", "member", "mbx_1")).resolves.toBe("read");
    await expect(requireMailboxAccess(db, "member", "member", "mbx_1", "read")).resolves.toBe(
      "read"
    );
    await expect(
      requireMailboxAccess(db, "member", "member", "mbx_1", "agent")
    ).rejects.toMatchObject({ code: "MAILBOX_FORBIDDEN", status: 403 });
  });

  it("treats catch-all as workspace scoped rather than mailbox scoped", async () => {
    expect(canAccessCatchall("owner")).toBe(true);
    expect(canAccessCatchall("admin")).toBe(false);
    expect(canAccessCatchall("member")).toBe(false);

    await expect(requireMailboxAccess(db, "owner", "owner", null, "manager")).resolves.toBe(
      "manager"
    );
    await expect(requireMailboxAccess(db, "member", "member", null, "read")).rejects.toMatchObject({
      code: "MAILBOX_FORBIDDEN",
      status: 403
    });
  });

  it("matches catch-all rows with IS NULL, which mailbox_id IN (...) can never do", () => {
    expect(
      mailboxScopeSql({ includeCatchall: false, mailboxIds: ["mbx_1"] }, "mailbox_id")
    ).toEqual({ params: ["mbx_1"], sql: "(mailbox_id IN (?))" });
    expect(mailboxScopeSql({ includeCatchall: true, mailboxIds: ["mbx_1"] }, "mailbox_id")).toEqual(
      {
        params: ["mbx_1"],
        sql: "(mailbox_id IN (?) OR mailbox_id IS NULL)"
      }
    );
    expect(mailboxScopeSql({ includeCatchall: true, mailboxIds: [] }, "mailbox_id")).toEqual({
      params: [],
      sql: "(mailbox_id IS NULL)"
    });
    expect(mailboxScopeSql({ includeCatchall: false, mailboxIds: [] }, "mailbox_id")).toBeNull();
  });

  it("lists only mailbox IDs satisfying the required level", async () => {
    await expect(accessibleMailboxIds(db, "owner", "owner", "read")).resolves.toEqual([
      "mbx_owner"
    ]);
    await expect(accessibleMailboxIds(db, "member", "member", "read")).resolves.toEqual([
      "mbx_member"
    ]);
  });
});
