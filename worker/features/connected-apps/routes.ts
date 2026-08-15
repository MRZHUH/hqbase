import { Hono } from "hono";

import { requireAuthContext } from "../../auth/session";
import type { HonoApp } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { recordAudit } from "../audit/service";

import { listConnectedApps, revokeConnectedApp } from "./queries";

export const connectedAppRoutes = new Hono<HonoApp>();

connectedAppRoutes.get("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  return c.json({ apps: await listConnectedApps(c.env.DB, auth.user.id) });
});

connectedAppRoutes.delete("/:clientId", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const clientId = c.req.param("clientId");
  // Scoped to the caller's own consent, so a request naming someone else's
  // authorization finds nothing and revokes nothing regardless of role.
  const revoked = await revokeConnectedApp(c.env.DB, auth.user.id, clientId);
  if (!revoked) {
    throw new AppError("CONNECTED_APP_NOT_FOUND", "Connected application not found.", 404);
  }
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "connected-app.revoke",
    resourceType: "oauth-client",
    resourceId: clientId,
    outcome: "success"
  });
  return c.body(null, 204);
});
