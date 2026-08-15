/**
 * The workspace response shapes this client reads.
 *
 * These mirror `worker/features/messages/types.ts`. They are transcribed rather
 * than imported because the worker builds for the Cloudflare runtime and this
 * package builds for Node; `test/integration/worker/api-bearer.test.ts` asserts
 * the fields below against the live API so a rename in the worker fails the
 * workspace gate instead of a user's terminal.
 */

export const conversationFolders = [
  "inbox",
  "sent",
  "starred",
  "archived",
  "trash",
  "catchall"
] as const;

export type ConversationFolder = (typeof conversationFolders)[number];

export type MessageSummary = {
  id: string;
  threadId: string;
  mailboxId: string | null;
  direction: "inbound" | "outbound";
  folder: string;
  fromAddress: string;
  to: string[];
  subject: string;
  snippet: string;
  receivedAt: string | null;
  sentAt: string | null;
  readAt: string | null;
  starredAt: string | null;
  hasAttachments: boolean;
  createdAt: string;
};

export type ConversationSummary = MessageSummary & {
  isStarred: boolean;
  messageCount: number;
  unreadCount: number;
};

export type ConversationPage = {
  conversations: ConversationSummary[];
  nextCursor: string | null;
  totalCount: number | null;
};

export type MessageAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Set when the message referenced this attachment inline, by content id. */
  contentId: string | null;
};

export type MessageDetail = MessageSummary & {
  cc: string[];
  bcc: string[];
  textBody: string;
  htmlAvailable: boolean;
  attachments: MessageAttachment[];
};

export type Mailbox = {
  id: string;
  address: string;
  displayName: string | null;
};

export type Identity = {
  id: string;
  email: string;
  name: string;
};

export const messageActions = ["read", "unread", "star", "unstar", "archive", "trash"] as const;
export type MessageAction = (typeof messageActions)[number];
