import { searchConversations } from "@tui/search/filter";
import { fuzzyScore } from "@tui/search/fuzzy";
import { parseQuery } from "@tui/search/query";
import { describe, expect, it } from "vitest";

import { conversation, now, sample } from "./fixtures";

function ids(query: string): string[] {
  return searchConversations(sample, parseQuery(query), now).map(
    (result) => result.conversation.id
  );
}

describe("searchConversations", () => {
  it("returns everything, newest first, for an empty query", () => {
    expect(ids("")).toEqual(["c1", "c2", "c3"]);
  });

  it("matches free text against subject, sender, and snippet", () => {
    expect(ids("invoice")).toEqual(["c2"]);
    expect(ids("bob")).toEqual(["c3"]);
    expect(ids("rollout")).toEqual(["c3"]);
  });

  it("ANDs multiple free-text terms", () => {
    expect(ids("quarterly numbers")).toEqual(["c1"]);
    expect(ids("quarterly rollout")).toEqual([]);
  });

  it("applies field filters exactly", () => {
    expect(ids("from:vendor")).toEqual(["c2"]);
    expect(ids("to:ops")).toEqual(["c2"]);
    expect(ids("subject:deploy")).toEqual(["c3"]);
    expect(ids("mailbox:mbx_team").length).toBe(3);
  });

  it("applies state filters", () => {
    expect(ids("is:unread")).toEqual(["c1"]);
    expect(ids("is:read")).toEqual(["c2", "c3"]);
    expect(ids("is:starred")).toEqual(["c2"]);
    expect(ids("has:attachment")).toEqual(["c2"]);
  });

  it("applies folder filters, treating starred as a folder", () => {
    expect(ids("in:archived")).toEqual(["c3"]);
    expect(ids("in:inbox")).toEqual(["c1", "c2"]);
    expect(ids("in:starred")).toEqual(["c2"]);
  });

  it("applies age filters", () => {
    expect(ids("newer:2d")).toEqual(["c1", "c2"]);
    expect(ids("older:1m")).toEqual(["c3"]);
  });

  it("combines filters with free text", () => {
    expect(ids("is:starred invoice")).toEqual(["c2"]);
    expect(ids("is:unread invoice")).toEqual([]);
  });

  it("ranks a subject hit above a snippet hit", () => {
    const rows = [
      conversation({ id: "subject-hit", subject: "Budget", snippet: "unrelated" }),
      conversation({ id: "snippet-hit", subject: "unrelated", snippet: "Budget" })
    ];
    const ranked = searchConversations(rows, parseQuery("budget"), now);
    expect(ranked[0]?.conversation.id).toBe("subject-hit");
  });

  it("breaks ties by recency", () => {
    const rows = [
      conversation({ id: "older", subject: "Same", activityAt: "2026-08-01T00:00:00.000Z" }),
      conversation({ id: "newer", subject: "Same", activityAt: "2026-08-14T00:00:00.000Z" })
    ];
    expect(
      searchConversations(rows, parseQuery("same"), now).map((r) => r.conversation.id)
    ).toEqual(["newer", "older"]);
  });
});

describe("fuzzyScore", () => {
  it("scores an exact substring above a scattered subsequence", () => {
    const direct = fuzzyScore("quarterly review", "review");
    const scattered = fuzzyScore("quarterly review", "qrv");
    expect(direct).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(direct ?? 0).toBeGreaterThan(scattered ?? 0);
  });

  it("returns null when a character is missing", () => {
    expect(fuzzyScore("quarterly", "z")).toBeNull();
  });

  it("ignores case", () => {
    expect(fuzzyScore("Quarterly", "quarter")).not.toBeNull();
  });

  it("scores an empty needle as neutral", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });
});
