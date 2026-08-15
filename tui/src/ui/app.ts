import type { DatabaseSync } from "node:sqlite";

import { ApiError, type Client, OfflineError } from "../api/client.js";
import {
  loadConversations,
  loadThread,
  readMeta,
  saveConversations,
  saveThread
} from "../store/cache.js";
import { deepSearch, lastSyncKey, syncConversations } from "../sync/sync.js";

import { ansi, colorEnabled } from "./ansi.js";
import { detectImageProtocol, isDrawableImage } from "./images.js";
import { decodeKeys } from "./keys.js";
import { type Effect, type Event, initialModel, type Model } from "./model.js";
import { update } from "./update.js";
import { render } from "./view.js";

/** Largest attachment the client will pull down just to draw it. */
const maxImageBytes = 4 * 1024 * 1024;

export type RunOptions = {
  db: DatabaseSync;
  client: Client;
  version: string;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
};

/**
 * The only module that talks to the terminal.
 *
 * It owns raw mode, the alternate screen, and effect execution; every decision
 * about what the interface does lives in the pure reducer it calls.
 */
export async function run(options: RunOptions): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  if (!input.isTTY) {
    throw new Error(
      "The interface needs an interactive terminal. Use `hqbase-mail search <query>` instead."
    );
  }

  const color = colorEnabled(output);
  const protocol = detectImageProtocol(process.env, output.isTTY === true);
  let model: Model = initialModel({
    origin: options.client.origin,
    version: options.version,
    width: output.columns ?? 100,
    height: output.rows ?? 30,
    canWrite: options.client.scopes.includes("mail:write"),
    lastSyncAt: readMeta(options.db, lastSyncKey)
  });

  let finished: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });

  const paint = (): void => {
    output.write(`${ansi.home}${ansi.clear}${render(model, { color, protocol })}`);
  };

  const dispatch = (event: Event): void => {
    const [next, effects] = update(model, event);
    model = next;
    paint();
    for (const effect of effects) void perform(effect);
    if (model.quitting) finished?.();
  };

  const perform = async (effect: Effect): Promise<void> => {
    try {
      await runEffect(effect, options, dispatch);
    } catch (error) {
      dispatch(toEvent(error));
    }
  };

  const restore = (): void => {
    input.off("data", onData);
    output.off("resize", onResize);
    if (input.isTTY) input.setRawMode(false);
    input.pause();
    output.write(`${ansi.enableAutowrap}${ansi.showCursor}${ansi.leaveAlternateScreen}`);
  };

  function onData(chunk: Buffer | string): void {
    for (const key of decodeKeys(chunk.toString("utf8"))) dispatch({ type: "key", key });
  }

  function onResize(): void {
    dispatch({ type: "resize", width: output.columns ?? 100, height: output.rows ?? 30 });
  }

  output.write(`${ansi.enterAlternateScreen}${ansi.hideCursor}${ansi.disableAutowrap}`);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  input.on("data", onData);
  output.on("resize", onResize);

  try {
    dispatch({
      type: "conversations",
      rows: loadConversations(options.db),
      lastSyncAt: readMeta(options.db, lastSyncKey)
    });
    void perform({ type: "sync" });
    void identify(options.client, dispatch);
    await done;
  } finally {
    restore();
  }
}

async function runEffect(
  effect: Effect,
  options: RunOptions,
  dispatch: (event: Event) => void
): Promise<void> {
  switch (effect.type) {
    case "quit":
      return;

    case "reload":
      dispatch({
        type: "conversations",
        rows: loadConversations(options.db),
        lastSyncAt: readMeta(options.db, lastSyncKey)
      });
      return;

    case "sync": {
      dispatch({ type: "sync-started" });
      const result = await syncConversations(options.db, options.client);
      dispatch({
        type: "sync-finished",
        added: result.added,
        updated: result.updated,
        truncated: result.truncated
      });
      return;
    }

    case "deep-search": {
      dispatch({ type: "deep-search-started" });
      const result = await deepSearch(options.db, options.client, effect.search);
      dispatch({ type: "deep-search-finished", found: result.found });
      return;
    }

    case "open": {
      // The cache answers first so a thread already read stays readable offline;
      // the workspace copy replaces it when it arrives.
      const cached = loadThread(options.db, effect.threadId);
      if (cached.length > 0) {
        dispatch({ type: "thread", conversationId: effect.conversationId, messages: cached });
      }
      const messages = await options.client.thread(effect.conversationId);
      saveThread(options.db, effect.threadId, messages);
      dispatch({ type: "thread", conversationId: effect.conversationId, messages });
      return;
    }

    case "images": {
      // Bounded on purpose: a mail client should not pull a 30 MB attachment
      // through the terminal because a thread happened to contain one.
      for (const attachment of effect.attachments) {
        if (!isDrawableImage(attachment.contentType)) continue;
        if (attachment.sizeBytes > maxImageBytes) {
          dispatch({
            type: "image",
            attachmentId: attachment.id,
            state: { status: "skipped", reason: "too large to display" }
          });
          continue;
        }
        dispatch({ type: "image", attachmentId: attachment.id, state: { status: "loading" } });
        void options.client
          .attachment(attachment.id)
          .then((image) =>
            dispatch({
              type: "image",
              attachmentId: attachment.id,
              state: { status: "ready", base64: image.base64, bytes: image.bytes }
            })
          )
          .catch(() =>
            dispatch({
              type: "image",
              attachmentId: attachment.id,
              state: { status: "skipped", reason: "could not be loaded" }
            })
          );
      }
      return;
    }

    case "mark-all-read": {
      // Applied one at a time because the workspace exposes no bulk endpoint.
      // Failures are counted rather than aborting the run, so one unreachable
      // conversation does not strand the rest half-marked with no report.
      let marked = 0;
      for (const conversationId of effect.conversationIds) {
        try {
          await options.client.act(conversationId, "read", effect.folder);
          marked += 1;
        } catch {
          // Counted by omission; the notice reports what actually changed.
        }
      }
      const page = await options.client.conversations({});
      saveConversations(options.db, page.conversations);
      dispatch({ type: "marked-all-read", count: marked });
      return;
    }

    case "act": {
      await options.client.act(effect.conversationId, effect.action, effect.folder);
      // Re-reading the list is what makes the row reflect the change, since the
      // action endpoint answers with a summary rather than the new page.
      const page = await options.client.conversations({});
      saveConversations(options.db, page.conversations);
      dispatch({ type: "acted", action: effect.action });
      return;
    }
  }
}

async function identify(client: Client, dispatch: (event: Event) => void): Promise<void> {
  try {
    const identity = await client.identity();
    dispatch({ type: "identity", account: identity.email });
  } catch (error) {
    dispatch(toEvent(error));
  }
}

function toEvent(error: unknown): Event {
  if (error instanceof OfflineError) {
    return { type: "offline", text: "The workspace is unreachable. Showing cached mail." };
  }
  if (error instanceof ApiError && error.needsLogin) {
    return {
      type: "notice",
      text: "This workspace connection was revoked. Run: hqbase-mail login",
      kind: "error"
    };
  }
  if (error instanceof ApiError && error.needsWriteAccess) {
    return {
      type: "notice",
      text: "This connection is read-only. Run: hqbase-mail login --write",
      kind: "error"
    };
  }
  return {
    type: "notice",
    text: error instanceof Error ? error.message : "Something went wrong.",
    kind: "error"
  };
}
