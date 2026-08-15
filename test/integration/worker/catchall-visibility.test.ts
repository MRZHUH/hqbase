import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import initialMigration from "../../../migrations/0001_initial.sql?raw";
import workspaceMigration from "../../../migrations/0002_workspace.sql?raw";
import oauthResourcesMigration from "../../../migrations/0003_oauth_resources.sql?raw";
import conversationMigration from "../../../migrations/0004_conversations.sql?raw";
import threadRebuildMigration from "../../../migrations/0005_rebuild_threads.sql?raw";
import { listConversationPage } from "../../../worker/features/messages/conversation-queries";
import { listMessages, listThreadMessages } from "../../../worker/features/messages/queries";
import { migrationStatements } from "./migration-statements";

/**
 * Catch-all messages are stored with `mailbox_id = NULL`, so a scope predicate built only from
 * `mailbox_id IN (...)` can never match them — SQL `NULL IN (...)` is never true. Every read path
 * therefore has to opt into catch-all explicitly, and these tests pin that behaviour.
 */
describe("catch-all visibility", () => {
  const ownerScope = { includeCatchall: true, mailboxIds: ["mbx_support"] };
  const mailboxOnlyScope = { includeCatchall: false, mailboxIds: ["mbx_support"] };

  beforeAll(async () => {
    for (const migration of [
      initialMigration,
      workspaceMigration,
      oauthResourcesMigration,
      conversationMigration,
      threadRebuildMigration
    ]) {
      await applyMigration(migration);
    }
    const now = "2026-08-15T13:15:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO mailboxes (id, address, display_name, is_active, created_at, updated_at)
         VALUES ('mbx_support', 'support@example.com', 'Support', 1, ?, ?)`
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO threads (id, subject_normalized, last_message_at, created_at, updated_at)
         VALUES ('thr_inbox', 'inbox', ?, ?, ?), ('thr_catchall', 'catchall', ?, ?, ?)`
      ).bind(now, now, now, now, now, now)
    ]);
    await insertMessage({
      folder: "inbox",
      id: "msg_inbox",
      mailboxId: "mbx_support",
      receivedAt: "2026-08-15T13:14:58.000Z",
      threadId: "thr_inbox",
      to: "support@example.com"
    });
    await insertMessage({
      folder: "catchall",
      id: "msg_catchall",
      mailboxId: null,
      receivedAt: "2026-08-15T13:15:06.000Z",
      threadId: "thr_catchall",
      to: "hello@example.com"
    });
  });

  it("returns catch-all messages for a scope that includes them", async () => {
    const catchall = await listMessages(env.DB, { folder: "catchall", scope: ownerScope });
    expect(catchall.map((message) => message.id)).toEqual(["msg_catchall"]);
    expect(catchall[0]).toMatchObject({ folder: "catchall", mailboxId: null });

    const everything = await listMessages(env.DB, { scope: ownerScope });
    expect(everything.map((message) => message.id)).toEqual(["msg_catchall", "msg_inbox"]);
  });

  it("hides catch-all messages from a scope limited to granted mailboxes", async () => {
    await expect(
      listMessages(env.DB, { folder: "catchall", scope: mailboxOnlyScope })
    ).resolves.toEqual([]);
    const everything = await listMessages(env.DB, { scope: mailboxOnlyScope });
    expect(everything.map((message) => message.id)).toEqual(["msg_inbox"]);
  });

  it("applies the same rule to conversations and threads", async () => {
    const included = await listConversationPage(env.DB, {
      folder: "catchall",
      scope: ownerScope
    });
    expect(included.conversations.map((conversation) => conversation.id)).toEqual(["msg_catchall"]);

    const excluded = await listConversationPage(env.DB, {
      folder: "catchall",
      scope: mailboxOnlyScope
    });
    expect(excluded.conversations).toEqual([]);
    expect(excluded.totalCount).toBe(0);

    await expect(listThreadMessages(env.DB, "thr_catchall", ownerScope)).resolves.toHaveLength(1);
    await expect(listThreadMessages(env.DB, "thr_catchall", mailboxOnlyScope)).resolves.toEqual([]);
  });
});

async function insertMessage(input: {
  folder: "catchall" | "inbox";
  id: string;
  mailboxId: string | null;
  receivedAt: string;
  threadId: string;
  to: string;
}): Promise<void> {
  const now = "2026-08-15T13:15:00.000Z";
  await env.DB.prepare(
    `INSERT INTO messages (
       id, thread_id, mailbox_id, direction, folder, from_address, to_json, cc_json, bcc_json,
       subject, snippet, text_body, references_json, received_at, read_at, has_attachments,
       created_at, updated_at
     ) VALUES (?, ?, ?, 'inbound', ?, 'sender@example.com', ?, '[]', '[]',
       'Subject', 'Snippet', 'Body', '[]', ?, NULL, 0, ?, ?)`
  )
    .bind(
      input.id,
      input.threadId,
      input.mailboxId,
      input.folder,
      JSON.stringify([input.to]),
      input.receivedAt,
      now,
      now
    )
    .run();
}

async function applyMigration(source: string): Promise<void> {
  for (const statement of migrationStatements(source)) {
    await env.DB.prepare(statement).run();
  }
}
