export type ParsedArgs = {
  flags: Map<string, string | true>;
  positional: string[];
};

/**
 * Parses `--flag`, `--flag=value`, and `--flag value` while letting flags appear
 * anywhere, so `search invoice --limit 5` works as readily as
 * `search --limit 5 invoice`.
 */
export function parseArgs(argv: readonly string[], valued: ReadonlySet<string>): ParsedArgs {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const body = argument.slice(2);
    const equals = body.indexOf("=");
    if (equals > 0) {
      flags.set(body.slice(0, equals), body.slice(equals + 1));
      continue;
    }
    if (valued.has(body)) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(body, next);
        index += 1;
        continue;
      }
    }
    flags.set(body, true);
  }

  return { flags, positional };
}

export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) !== undefined;
}

export function numberFlag(args: ParsedArgs, name: string, fallback: number): number {
  const value = stringFlag(args, name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
