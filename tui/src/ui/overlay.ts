import type { Key } from "./keys.js";
import { isControl } from "./keys.js";
import {
  clamp,
  type Effect,
  type Model,
  menuItems,
  selectedConversation,
  withNotice
} from "./model.js";

/**
 * Keys while an overlay is up. The overlay is modal on purpose: both of these
 * change mail state on the workspace with no undo, so the decision should not be
 * something a keystroke aimed at the query line can complete.
 */
export function overlayKey(model: Model, key: Key): [Model, Effect[]] {
  const overlay = model.overlay;
  if (!overlay) return [model, []];

  if (key.kind === "quit") return [{ ...model, quitting: true }, [{ type: "quit" }]];
  if (key.kind === "escape" || key.kind === "left" || (key.kind === "char" && key.value === "q")) {
    return [{ ...model, overlay: null }, []];
  }

  if (overlay.kind === "confirm-all-read") {
    if (key.kind !== "enter") return [model, []];
    const conversations = model.results
      .filter((result) => result.conversation.unreadCount > 0)
      .map((result) => result.conversation);
    const folder = conversations[0]?.folder ?? "inbox";
    return [
      model,
      [{ type: "mark-all-read", conversationIds: conversations.map((row) => row.id), folder }]
    ];
  }

  if (key.kind === "up" || isControl(key, "p")) {
    return [
      {
        ...model,
        overlay: { ...overlay, selected: clamp(overlay.selected - 1, 0, menuItems.length - 1) }
      },
      []
    ];
  }
  if (key.kind === "down" || isControl(key, "n")) {
    return [
      {
        ...model,
        overlay: { ...overlay, selected: clamp(overlay.selected + 1, 0, menuItems.length - 1) }
      },
      []
    ];
  }

  if (key.kind === "enter" || key.kind === "right") {
    const item = menuItems[overlay.selected];
    if (!item) return [{ ...model, overlay: null }, []];
    if (!model.online) {
      return [
        withNotice({ ...model, overlay: null }, "The workspace is unreachable.", "error"),
        []
      ];
    }
    const folder = selectedConversation(model)?.folder ?? "inbox";
    return [
      { ...model, overlay: null },
      [{ type: "act", conversationId: overlay.conversationId, action: item.action, folder }]
    ];
  }

  // A number picks an entry directly, which is faster than arrowing to it.
  if (key.kind === "char") {
    const index = Number.parseInt(key.value, 10) - 1;
    if (Number.isInteger(index) && index >= 0 && index < menuItems.length) {
      return [{ ...model, overlay: { ...overlay, selected: index } }, []];
    }
  }

  return [model, []];
}
