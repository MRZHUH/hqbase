import { refreshAccessToken } from "../auth/oauth.js";
import type { Credentials } from "../config/store.js";
import { writeCredentials } from "../config/store.js";

import type { ConversationPage, Identity, Mailbox, MessageAction, MessageDetail } from "./types.js";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }

  /** True when the workspace was reachable but refused the credential outright. */
  get needsLogin(): boolean {
    return this.status === 401;
  }

  get needsWriteAccess(): boolean {
    return this.code === "INSUFFICIENT_SCOPE" || this.code === "BEARER_NOT_ALLOWED";
  }
}

export class OfflineError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "The workspace is unreachable.");
    this.name = "OfflineError";
  }
}

export type Client = {
  readonly origin: string;
  readonly scopes: readonly string[];
  identity(): Promise<Identity>;
  mailboxes(): Promise<Mailbox[]>;
  conversations(params: {
    search?: string | undefined;
    folder?: string | undefined;
    mailboxId?: string | undefined;
    cursor?: string | undefined;
  }): Promise<ConversationPage>;
  thread(messageId: string): Promise<MessageDetail[]>;
  message(messageId: string): Promise<MessageDetail>;
  act(messageId: string, action: MessageAction, folder: string): Promise<void>;
};

export function createClient(initial: Credentials): Client {
  let credentials = initial;

  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
    retry = true
  ): Promise<T> {
    // Refreshing before the token expires rather than after avoids spending a
    // request to discover what the stored expiry already said.
    if (retry && credentials.refreshToken && credentials.expiresAt <= Date.now() + 30_000) {
      credentials = await refreshAndStore(credentials);
    }

    let response: Response;
    try {
      response = await fetch(`${credentials.origin}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          ...(init.body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
      });
    } catch (cause) {
      throw new OfflineError(cause);
    }

    if (response.status === 401 && retry && credentials.refreshToken) {
      credentials = await refreshAndStore(credentials);
      return request<T>(path, init, false);
    }
    if (!response.ok) throw await readError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    get origin() {
      return credentials.origin;
    },
    get scopes() {
      return credentials.scopes;
    },
    identity: () => request<Identity>("/api/me"),
    mailboxes: () => request<Mailbox[]>("/api/mailboxes"),
    conversations: (params) => request<ConversationPage>(`/api/conversations${query(params)}`),
    thread: (messageId) =>
      request<MessageDetail[]>(`/api/messages/${encodeURIComponent(messageId)}/thread`),
    message: (messageId) =>
      request<MessageDetail>(`/api/messages/${encodeURIComponent(messageId)}`),
    act: async (messageId, action, folder) => {
      await request<void>(`/api/conversations/${encodeURIComponent(messageId)}/${action}`, {
        method: "POST",
        body: { folder }
      });
    }
  };
}

export function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const rendered = search.toString();
  return rendered === "" ? "" : `?${rendered}`;
}

async function refreshAndStore(credentials: Credentials): Promise<Credentials> {
  const refreshed = await refreshAccessToken(credentials);
  writeCredentials(refreshed);
  return refreshed;
}

async function readError(response: Response): Promise<ApiError> {
  const fallback = `The workspace refused the request (${response.status}).`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? fallback,
      response.status
    );
  } catch {
    return new ApiError("REQUEST_FAILED", fallback, response.status);
  }
}
