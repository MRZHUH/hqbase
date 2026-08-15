import { freeText, isEmptyQuery, parseAge, parseQuery } from "@tui/search/query";
import { describe, expect, it } from "vitest";

describe("parseQuery", () => {
  it("treats bare words as free text", () => {
    const query = parseQuery("Quarterly Review");
    expect(query.terms).toEqual(["quarterly", "review"]);
    expect(query.invalid).toEqual([]);
  });

  it("reads field filters", () => {
    const query = parseQuery("from:alice to:team subject:invoice mailbox:mbx_1");
    expect(query.fields).toEqual({
      from: ["alice"],
      to: ["team"],
      subject: ["invoice"],
      mailbox: ["mbx_1"]
    });
    expect(query.terms).toEqual([]);
  });

  it("accumulates repeated field filters", () => {
    expect(parseQuery("from:alice from:bob").fields.from).toEqual(["alice", "bob"]);
  });

  it("reads state and attachment filters", () => {
    const query = parseQuery("is:unread is:starred has:attachment");
    expect(query.states).toEqual(["unread", "starred"]);
    expect(query.hasAttachment).toBe(true);
  });

  it("reads folder filters", () => {
    expect(parseQuery("in:inbox in:archived").folders).toEqual(["inbox", "archived"]);
  });

  it("reads age filters in days, weeks, and months", () => {
    expect(parseQuery("newer:7d").newerThanMs).toBe(7 * 86_400_000);
    expect(parseQuery("older:2w").olderThanMs).toBe(14 * 86_400_000);
    expect(parseQuery("newer:1m").newerThanMs).toBe(30 * 86_400_000);
  });

  it("reports an unknown field instead of dropping it", () => {
    const query = parseQuery("bogus:value hello");
    expect(query.invalid).toEqual(["bogus:value"]);
    expect(query.terms).toEqual(["hello"]);
  });

  it("reports an invalid value for a known field", () => {
    expect(parseQuery("is:pending").invalid).toEqual(["is:pending"]);
    expect(parseQuery("in:nowhere").invalid).toEqual(["in:nowhere"]);
    expect(parseQuery("newer:soon").invalid).toEqual(["newer:soon"]);
    expect(parseQuery("has:cheese").invalid).toEqual(["has:cheese"]);
    expect(parseQuery("from:").invalid).toEqual(["from:"]);
  });

  it("does not mistake a leading colon for a filter", () => {
    expect(parseQuery(":oops").terms).toEqual([":oops"]);
  });

  it("keeps only free text for the workspace search", () => {
    expect(freeText(parseQuery("invoice from:alice is:unread number"))).toBe("invoice number");
    expect(freeText(parseQuery("is:unread"))).toBe("");
  });

  it("knows when a query constrains nothing", () => {
    expect(isEmptyQuery(parseQuery("   "))).toBe(true);
    expect(isEmptyQuery(parseQuery("is:unread"))).toBe(false);
    expect(isEmptyQuery(parseQuery("hello"))).toBe(false);
  });
});

describe("parseAge", () => {
  it("rejects zero, negatives, and unknown units", () => {
    expect(parseAge("0d")).toBeNull();
    expect(parseAge("-1d")).toBeNull();
    expect(parseAge("5y")).toBeNull();
    expect(parseAge("d")).toBeNull();
  });
});
