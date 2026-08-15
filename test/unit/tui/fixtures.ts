import type { CachedConversation } from "@tui/store/cache";

export const now = Date.parse("2026-08-15T12:00:00.000Z");

export function conversation(
  overrides: Partial<CachedConversation> & { id: string }
): CachedConversation {
  const activityAt = overrides.activityAt ?? "2026-08-15T11:00:00.000Z";
  return {
    threadId: `thr_${overrides.id}`,
    mailboxId: "mbx_team",
    direction: "inbound",
    folder: "inbox",
    fromAddress: "alice@example.com",
    to: ["team@example.com"],
    subject: "Quarterly review",
    snippet: "Numbers for the quarter are attached.",
    receivedAt: activityAt,
    sentAt: null,
    readAt: null,
    starredAt: null,
    hasAttachments: false,
    isStarred: false,
    messageCount: 1,
    unreadCount: 0,
    createdAt: activityAt,
    ...overrides,
    activityAt
  };
}

export const sample: CachedConversation[] = [
  conversation({
    id: "c1",
    subject: "Quarterly review",
    fromAddress: "alice@example.com",
    snippet: "Numbers for the quarter",
    unreadCount: 1,
    activityAt: "2026-08-15T11:00:00.000Z"
  }),
  conversation({
    id: "c2",
    subject: "Invoice 4471",
    fromAddress: "billing@vendor.example",
    to: ["ops@example.com"],
    snippet: "Payment is due next week",
    hasAttachments: true,
    isStarred: true,
    activityAt: "2026-08-14T09:00:00.000Z"
  }),
  conversation({
    id: "c3",
    subject: "Deploy notes",
    fromAddress: "bob@example.com",
    folder: "archived",
    snippet: "Rollout finished",
    messageCount: 4,
    activityAt: "2026-06-01T09:00:00.000Z"
  })
];
