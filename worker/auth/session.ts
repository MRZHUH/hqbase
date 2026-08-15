import { z } from "zod";

import type { WorkerEnv } from "../lib/env";
import { AppError } from "../lib/errors";
import type { WorkspaceRole } from "../lib/validation";
import { parseWith, workspaceRoleSchema } from "../lib/validation";
import { apiScopes } from "./api-scope";
import { apiResource, createAuth } from "./auth";
import { verifyOAuthBearer } from "./oauth-bearer";
import { isPasswordSetupRequired } from "./password-setup";

const betterSessionSchema = z.object({
  session: z.object({
    id: z.string(),
    userId: z.string(),
    createdAt: z.coerce.date()
  }),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
    role: workspaceRoleSchema.optional().nullable()
  })
});

export type AuthContext = {
  session: {
    id: string;
    userId: string;
    createdAt: Date;
  };
  user: {
    id: string;
    email: string;
    name: string;
    role: WorkspaceRole;
  };
};

export async function getAuthContext(
  env: WorkerEnv,
  request: Request
): Promise<AuthContext | null> {
  const bearer = await bearerAuthContext(env, request);
  if (bearer) return bearer;

  const auth = createAuth(env, request);
  const rawSession = await auth.api.getSession({
    headers: request.headers
  });

  if (!rawSession) {
    return null;
  }

  const parsed = parseWith(betterSessionSchema, rawSession);
  return {
    session: parsed.session,
    user: {
      id: parsed.user.id,
      email: parsed.user.email,
      name: parsed.user.name,
      role: parsed.user.role ?? "member"
    }
  };
}

export async function requireAuthContext(
  env: WorkerEnv,
  request: Request,
  options: { allowPasswordSetupRequired?: boolean } = {}
): Promise<AuthContext> {
  const authContext = await getAuthContext(env, request);
  if (!authContext) {
    throw new AppError("UNAUTHENTICATED", "Sign in is required.", 401);
  }
  if (
    !options.allowPasswordSetupRequired &&
    (await isPasswordSetupRequired(env.DB, authContext.user.id))
  ) {
    throw new AppError(
      "PASSWORD_SETUP_REQUIRED",
      "Replace your temporary password before using this workspace.",
      403
    );
  }
  return authContext;
}

/**
 * Resolves an access token bound to the API resource into the same context a
 * browser session produces, so every mailbox grant, role check, and audit entry
 * downstream behaves identically for both credential kinds. Which routes a token
 * may reach is decided upstream by the scope middleware, never here.
 */
async function bearerAuthContext(env: WorkerEnv, request: Request): Promise<AuthContext | null> {
  const principal = await verifyOAuthBearer(env, request, {
    resource: apiResource(env, request),
    allowedScopes: apiScopes
  });
  if (!principal) return null;
  return {
    session: {
      // Marked so audit readers can tell an application's action from a
      // person's, and so it can never collide with a better-auth session id.
      id: `oauth:${principal.tokenId}`,
      userId: principal.userId,
      createdAt: new Date(principal.issuedAt)
    },
    user: {
      id: principal.userId,
      email: principal.email,
      name: principal.name,
      role: principal.role
    }
  };
}

export function requireRole(
  authContext: AuthContext,
  allowed: readonly WorkspaceRole[],
  message = "You do not have permission to perform this action."
): void {
  if (!allowed.includes(authContext.user.role)) {
    throw new AppError("FORBIDDEN", message, 403);
  }
}

export function requireRecentSession(authContext: AuthContext, maxAgeMs = 10 * 60 * 1000): void {
  if (!isRecentSession(authContext, maxAgeMs)) {
    throw new AppError(
      "RECENT_AUTH_REQUIRED",
      "Sign in again before changing workspace infrastructure.",
      403
    );
  }
}

export function isRecentSession(
  authContext: AuthContext,
  maxAgeMs = 10 * 60 * 1000,
  now = Date.now()
): boolean {
  return now - authContext.session.createdAt.getTime() <= maxAgeMs;
}
