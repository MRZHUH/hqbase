import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type Pkce = {
  verifier: string;
  challenge: string;
  method: "S256";
};

export function base64url(input: Buffer): string {
  return input.toString("base64url");
}

export function createPkce(): Pkce {
  // 32 random bytes is 43 base64url characters, the length RFC 7636 recommends
  // and the shortest value that leaves no room for a dictionary attack.
  const verifier = base64url(randomBytes(32));
  return {
    verifier,
    challenge: base64url(createHash("sha256").update(verifier).digest()),
    method: "S256"
  };
}

export function createState(): string {
  return base64url(randomBytes(24));
}

/**
 * Compares the state the redirect carried against the one this attempt
 * generated, in constant time and without leaking length through an early
 * return, so a redirect from any other flow is rejected.
 */
export function stateMatches(expected: string, received: string | null): boolean {
  if (received === null) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
