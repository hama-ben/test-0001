/**
 * Web Push sender.
 *
 * Initialises the web-push library with VAPID credentials on first call and
 * exposes sendPushToUser() — which looks up all stored subscriptions for a
 * userId and fires a push to each one, silently removing stale/expired
 * subscriptions (410 Gone) from the database.
 */

import webPush from "web-push";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

let initialised = false;

function init(): boolean {
  if (initialised) return true;
  const pub  = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    logger.warn("web-push: VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set — push disabled");
    return false;
  }
  webPush.setVapidDetails("mailto:mizu-app@noreply.app", pub, priv);
  initialised = true;
  return true;
}

export interface PushPayload {
  title: string;
  body:  string;
  url:   string;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!init()) return;

  const rows = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  if (rows.length === 0) return;

  const json = JSON.stringify(payload);

  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webPush.sendNotification(
          row.subscription as webPush.PushSubscription,
          json
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          // Subscription expired or unregistered — remove it
          await db
            .delete(pushSubscriptionsTable)
            .where(eq(pushSubscriptionsTable.id, row.id));
          logger.info({ userId, id: row.id }, "web-push: removed stale subscription");
        } else {
          logger.warn({ userId, err }, "web-push: send failed");
        }
      }
    })
  );
}
