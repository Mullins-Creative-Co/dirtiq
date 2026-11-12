export type TeamNames = Record<string, Record<string, string>>;

/** A display label only. Unknown or ambiguous codes stay unchanged. */
export function teamLabel(names: TeamNames, sport: string, code: string): string {
  const name = names[sport]?.[code];
  return name && name !== code ? `${name} (${code})` : code;
}
