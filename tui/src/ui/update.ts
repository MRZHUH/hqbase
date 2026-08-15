import type { MessageAction } from "../api/types.js";
import { freeText, parseQuery } from "../search/query.js";

import { isControl, type Key } from "./keys.js";
import {
  clamp,
  type Effect,
  type Event,
  type Model,
  moveSelection,
  refresh,
  selectedConversation,
  visibleRows,
  withNotice
} from "./model.js";
import { overlayKey } from "./overlay.js";

const readerActions: Record<string, MessageAction> = {
  a: "archive",
  s: "star",
  S: "unstar",
  u: "unread",
  r: "read",
  d: "trash"
};

/**
 * The whole interface as one pure transition.
 *
 * Nothing here touches the terminal, the network, or the disk: side effects are
 * returned for the runtime to perform, which is what lets every scenario in the
 * specification be tested by feeding events in and reading the model out.
 */
export function update(model: Model, event: Event, now = Date.now()): [Model, Effect[]] {
  switch (event.type) {
    case "resize":
      return [refresh({ ...model, width: event.width, height: event.height }, now), []];

    case "conversations": {
      const next = refresh(
        { ...model, conversations: event.rows, lastSyncAt: event.lastSyncAt },
        now
      );
      return [next, []];
    }

    case "identity":
      return [{ ...model, account: event.account, online: true }, []];

    case "sync-started":
      return [{ ...model, syncing: true }, []];

    case "sync-finished": {
      const parts = [`${event.added} new`, `${event.updated} updated`];
      if (event.truncated) parts.push("more available, run sync again");
      return [
        withNotice({ ...model, syncing: false, online: true }, parts.join(" · "), "info"),
        [{ type: "reload" }]
      ];
    }

    case "deep-search-started":
      return [{ ...model, deepSearching: true }, []];

    case "deep-search-finished":
      return [
        withNotice(
          { ...model, deepSearching: false, includesServerResults: true, online: true },
          `${event.found} match${event.found === 1 ? "" : "es"} from the workspace`,
          "info"
        ),
        [{ type: "reload" }]
      ];

    case "thread": {
      if (model.reader?.conversationId !== event.conversationId) return [model, []];
      const attachments = event.messages.flatMap((message) =>
        message.attachments.map((attachment) => ({
          id: attachment.id,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes
        }))
      );
      return [
        {
          ...model,
          reader: { ...model.reader, messages: event.messages, loading: false, scroll: 0 }
        },
        attachments.length > 0 ? [{ type: "images", attachments }] : []
      ];
    }

    case "image":
      return [{ ...model, images: { ...model.images, [event.attachmentId]: event.state } }, []];

    case "acted":
      return [
        withNotice({ ...model, online: true }, `Marked ${event.action}.`, "info"),
        [{ type: "reload" }]
      ];

    case "notice":
      return [withNotice(model, event.text, event.kind), []];

    case "offline":
      return [
        withNotice(
          { ...model, online: false, syncing: false, deepSearching: false },
          event.text,
          "error"
        ),
        []
      ];

    case "marked-all-read":
      return [
        withNotice(
          { ...model, overlay: null },
          `Marked ${event.count} conversation${event.count === 1 ? "" : "s"} as read.`,
          "info"
        ),
        [{ type: "reload" }]
      ];

    case "key":
      // An overlay owns the keyboard while it is up, so a decision cannot be
      // typed past by accident.
      if (model.overlay) return overlayKey(model, event.key);
      return model.screen === "reader"
        ? readerKey(model, event.key)
        : listKey(model, event.key, now);
  }
}

function listKey(model: Model, key: Key, now: number): [Model, Effect[]] {
  if (key.kind === "quit") return [{ ...model, quitting: true }, [{ type: "quit" }]];

  if (key.kind === "up" || isControl(key, "p")) return [moveSelection(model, -1), []];
  if (key.kind === "down" || isControl(key, "n")) return [moveSelection(model, 1), []];
  if (key.kind === "page-up") return [moveSelection(model, -visibleRows(model)), []];
  if (key.kind === "page-down") return [moveSelection(model, visibleRows(model)), []];
  if (key.kind === "home") return [moveSelection(model, -model.results.length), []];
  if (key.kind === "end") return [moveSelection(model, model.results.length), []];

  if (key.kind === "escape" || key.kind === "left") {
    // Left is the way out of wherever you are. In the list the only thing to
    // leave is the query, and quitting stays on ctrl+c so a stray arrow never
    // ends the session.
    if (model.query === "") {
      return key.kind === "left"
        ? [withNotice(model, "Nothing to leave. Press ctrl+c to quit.", "info"), []]
        : [model, []];
    }
    return [refresh({ ...model, query: "", cursor: 0, selected: 0, offset: 0 }, now), []];
  }

  if (key.kind === "enter") {
    const conversation = selectedConversation(model);
    if (!conversation) return [withNotice(model, "Nothing selected.", "error"), []];
    if (!model.canWrite) {
      return [
        withNotice(model, "This connection is read-only. Run: hqbase-mail login --write", "error"),
        []
      ];
    }
    return [
      {
        ...model,
        overlay: {
          kind: "actions",
          conversationId: conversation.id,
          subject: conversation.subject,
          selected: 0
        }
      },
      []
    ];
  }

  if (isControl(key, "u")) {
    if (model.results.length === 0) {
      return [withNotice(model, "Nothing listed to mark.", "error"), []];
    }
    if (!model.canWrite) {
      return [
        withNotice(model, "This connection is read-only. Run: hqbase-mail login --write", "error"),
        []
      ];
    }
    const unread = model.results.filter((result) => result.conversation.unreadCount > 0);
    if (unread.length === 0) {
      return [withNotice(model, "Everything listed is already read.", "info"), []];
    }
    // Bulk state changes confirm first: this is one keystroke away from a common
    // multiplexer prefix, and there is no undo on the workspace side.
    return [{ ...model, overlay: { kind: "confirm-all-read", count: unread.length } }, []];
  }

  if (key.kind === "right") {
    const conversation = selectedConversation(model);
    if (!conversation) return [withNotice(model, "Nothing selected.", "error"), []];
    return [
      {
        ...model,
        screen: "reader",
        reader: {
          conversationId: conversation.id,
          threadId: conversation.threadId,
          subject: conversation.subject,
          messages: [],
          scroll: 0,
          loading: true
        }
      },
      [{ type: "open", conversationId: conversation.id, threadId: conversation.threadId }]
    ];
  }

  if (isControl(key, "r")) {
    const search = freeText(parseQuery(model.query));
    if (search === "") {
      return [withNotice(model, "Type words to search message bodies for.", "error"), []];
    }
    if (model.deepSearching) return [model, []];
    return [model, [{ type: "deep-search", search }]];
  }

  if (isControl(key, "s")) {
    if (model.syncing) return [model, []];
    return [model, [{ type: "sync" }]];
  }

  if (key.kind === "backspace") {
    if (model.cursor === 0) return [model, []];
    const query = model.query.slice(0, model.cursor - 1) + model.query.slice(model.cursor);
    return [
      refresh({ ...model, query, cursor: model.cursor - 1, selected: 0, offset: 0 }, now),
      []
    ];
  }

  if (key.kind === "delete") {
    if (model.cursor >= model.query.length) return [model, []];
    const query = model.query.slice(0, model.cursor) + model.query.slice(model.cursor + 1);
    return [refresh({ ...model, query, selected: 0, offset: 0 }, now), []];
  }

  // The arrows open and leave conversations, so editing the query line moves on
  // the readline keys instead.
  if (isControl(key, "b")) {
    return [{ ...model, cursor: clamp(model.cursor - 1, 0, model.query.length) }, []];
  }
  if (isControl(key, "f")) {
    return [{ ...model, cursor: clamp(model.cursor + 1, 0, model.query.length) }, []];
  }
  if (isControl(key, "a")) return [{ ...model, cursor: 0 }, []];
  if (isControl(key, "e")) return [{ ...model, cursor: model.query.length }, []];

  if (key.kind === "char") {
    const query = model.query.slice(0, model.cursor) + key.value + model.query.slice(model.cursor);
    return [
      refresh({ ...model, query, cursor: model.cursor + 1, selected: 0, offset: 0 }, now),
      []
    ];
  }

  return [model, []];
}

function readerKey(model: Model, key: Key): [Model, Effect[]] {
  const reader = model.reader;
  if (!reader) return [{ ...model, screen: "list" }, []];

  if (key.kind === "quit") return [{ ...model, quitting: true }, [{ type: "quit" }]];
  if (key.kind === "escape" || key.kind === "left" || (key.kind === "char" && key.value === "q")) {
    // The query, selection, and scroll offset are untouched, so leaving the
    // reader returns to exactly the search that opened it.
    return [{ ...model, screen: "list", reader: null }, []];
  }

  if (key.kind === "up" || isControl(key, "p")) return [scroll(model, reader.scroll - 1), []];
  if (key.kind === "down" || isControl(key, "n")) return [scroll(model, reader.scroll + 1), []];
  if (key.kind === "page-up") return [scroll(model, reader.scroll - visibleRows(model)), []];
  if (key.kind === "page-down" || key.kind === "enter") {
    return [scroll(model, reader.scroll + visibleRows(model)), []];
  }
  if (key.kind === "home") return [scroll(model, 0), []];

  if (key.kind === "char") {
    const action = readerActions[key.value];
    if (!action) return [model, []];
    if (!model.canWrite) {
      return [
        withNotice(model, "This connection is read-only. Run: hqbase-mail login --write", "error"),
        []
      ];
    }
    if (!model.online) {
      return [withNotice(model, "The workspace is unreachable.", "error"), []];
    }
    const folder = selectedConversation(model)?.folder ?? "inbox";
    return [model, [{ type: "act", conversationId: reader.conversationId, action, folder }]];
  }

  return [model, []];
}

function scroll(model: Model, to: number): Model {
  if (!model.reader) return model;
  return { ...model, reader: { ...model.reader, scroll: Math.max(to, 0) } };
}
