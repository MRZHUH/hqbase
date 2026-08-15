import webpush from "web-push";

import { accessibleMailboxScope } from "../../auth/mailbox-access";
import type { WorkerEnv } from "../../lib/env";
import type { WorkspaceRole } from "../../lib/validation";
import type { MessageSummary } from "../messages/types";
import {
  countUnreadMessages,
  listPushSubscriptionsForCatchall,
  listPushSubscriptionsForMailbox,
  markPushSubscriptionSuccessful,
  removePushSubscriptionsById
} from "./queries";
import type { PushSubscriptionRow } from "./types";

export async function notifyInboundMessage(env: WorkerEnv, message: MessageSummary): Promise<void> {
  const mailboxId = message.mailboxId;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return;
  }

  const subscriptions = mailboxId
    ? await listPushSubscriptionsForMailbox(env.DB, mailboxId)
    : await listPushSubscriptionsForCatchall(env.DB);
  if (subscriptions.length === 0) return;

  webpush.setVapidDetails(
    env.VAPID_SUBJECT ?? "https://hqbase.io",
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
  const byUser = groupSubscriptionsByUser(subscriptions);
  const deadSubscriptionIds: string[] = [];

  await Promise.all(
    [...byUser.entries()].map(async ([userId, userSubscriptions]) => {
      const role = workspaceRole(userSubscriptions[0]?.role);
      if (!role) return;
      const scope = await accessibleMailboxScope(env.DB, userId, role, "read");
      const allowed = mailboxId ? scope.mailboxIds.includes(mailboxId) : scope.includeCatchall;
      if (!allowed) return;
      const unread = await countUnreadMessages(env.DB, scope);
      const payload = JSON.stringify({
        tag: `hqbase-thread-${message.threadId}`,
        unreadCount: unread.total,
        url: message.folder === "catchall" ? `/catch-all/${message.id}` : `/inbox/${message.id}`
      });

      await Promise.all(
        userSubscriptions.map(async (subscription) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                expirationTime: subscription.expiration_time,
                keys: {
                  auth: subscription.auth_key,
                  p256dh: subscription.p256dh_key
                }
              },
              payload,
              { TTL: 24 * 60 * 60, urgency: "normal" }
            );
            await markPushSubscriptionSuccessful(env.DB, subscription.id);
          } catch (error: unknown) {
            if (isExpiredSubscription(error)) deadSubscriptionIds.push(subscription.id);
          }
        })
      );
    })
  );

  await removePushSubscriptionsById(env.DB, deadSubscriptionIds);
}

function groupSubscriptionsByUser(
  subscriptions: PushSubscriptionRow[]
): Map<string, PushSubscriptionRow[]> {
  const grouped = new Map<string, PushSubscriptionRow[]>();
  for (const subscription of subscriptions) {
    grouped.set(subscription.user_id, [...(grouped.get(subscription.user_id) ?? []), subscription]);
  }
  return grouped;
}

function workspaceRole(value: string | null | undefined): WorkspaceRole | null {
  return value === "owner" || value === "admin" || value === "member" ? value : null;
}

function isExpiredSubscription(error: unknown): boolean {
  const statusCode =
    error instanceof webpush.WebPushError
      ? error.statusCode
      : typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
        ? error.statusCode
        : 0;
  return statusCode === 404 || statusCode === 410;
}
