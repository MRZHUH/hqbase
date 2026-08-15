export const queryFields = ["from", "to", "subject", "mailbox"] as const;
export type QueryField = (typeof queryFields)[number];

export const stateFilters = ["unread", "read", "starred"] as const;
export type StateFilter = (typeof stateFilters)[number];

export const folderNames = ["inbox", "sent", "archived", "trash", "catchall", "starred"] as const;

export type Query = {
  /** Free text, matched loosely against subject, sender, and snippet. */
  terms: string[];
  fields: Partial<Record<QueryField, string[]>>;
  states: StateFilter[];
  hasAttachment: boolean;
  folders: string[];
  /** Milliseconds; a conversation must be newer than this age. */
  newerThanMs: number | null;
  olderThanMs: number | null;
  /** Terms that named a filter but could not be understood. */
  invalid: string[];
};

const empty: Query = {
  terms: [],
  fields: {},
  states: [],
  hasAttachment: false,
  folders: [],
  newerThanMs: null,
  olderThanMs: null,
  invalid: []
};

const unitMs: Record<string, number> = {
  d: 86_400_000,
  w: 7 * 86_400_000,
  m: 30 * 86_400_000
};

/**
 * Parses the query line. Terms are ANDed. An unrecognized `field:value` term is
 * collected in `invalid` rather than being dropped or treated as free text, so
 * the interface can say a filter was not understood instead of silently
 * returning the wrong rows.
 */
export function parseQuery(input: string): Query {
  const query: Query = { ...empty, fields: {}, states: [], folders: [], terms: [], invalid: [] };

  for (const raw of input.trim().split(/\s+/).filter(Boolean)) {
    const separator = raw.indexOf(":");
    if (separator <= 0) {
      query.terms.push(raw.toLowerCase());
      continue;
    }
    const key = raw.slice(0, separator).toLowerCase();
    const value = raw.slice(separator + 1).toLowerCase();
    if (value === "") {
      query.invalid.push(raw);
      continue;
    }
    applyFilter(query, key, value, raw);
  }

  return query;
}

export function isEmptyQuery(query: Query): boolean {
  return (
    query.terms.length === 0 &&
    Object.keys(query.fields).length === 0 &&
    query.states.length === 0 &&
    query.folders.length === 0 &&
    !query.hasAttachment &&
    query.newerThanMs === null &&
    query.olderThanMs === null
  );
}

/** The free-text half of a query, which is what the workspace can search. */
export function freeText(query: Query): string {
  return query.terms.join(" ");
}

function applyFilter(query: Query, key: string, value: string, raw: string): void {
  if (isQueryField(key)) {
    const existing = query.fields[key] ?? [];
    existing.push(value);
    query.fields[key] = existing;
    return;
  }
  if (key === "is") {
    if (!isStateFilter(value)) {
      query.invalid.push(raw);
      return;
    }
    query.states.push(value);
    return;
  }
  if (key === "has") {
    if (value !== "attachment" && value !== "attachments") {
      query.invalid.push(raw);
      return;
    }
    query.hasAttachment = true;
    return;
  }
  if (key === "in") {
    if (!folderNames.includes(value as (typeof folderNames)[number])) {
      query.invalid.push(raw);
      return;
    }
    query.folders.push(value);
    return;
  }
  if (key === "newer" || key === "older") {
    const age = parseAge(value);
    if (age === null) {
      query.invalid.push(raw);
      return;
    }
    if (key === "newer") query.newerThanMs = age;
    else query.olderThanMs = age;
    return;
  }
  query.invalid.push(raw);
}

export function parseAge(value: string): number | null {
  const match = /^(\d+)([dwm])$/.exec(value);
  if (!match) return null;
  const amount = Number.parseInt(match[1] ?? "", 10);
  const unit = unitMs[match[2] ?? ""];
  if (!Number.isFinite(amount) || amount <= 0 || unit === undefined) return null;
  return amount * unit;
}

function isQueryField(value: string): value is QueryField {
  return (queryFields as readonly string[]).includes(value);
}

function isStateFilter(value: string): value is StateFilter {
  return (stateFilters as readonly string[]).includes(value);
}
