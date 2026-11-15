export type TeamNames = Record<string, Record<string, string>>;

/** A display label only. Unknown or ambiguous codes stay unchanged. */
export function teamLabel(names: TeamNames, sport: string, code: string): string {
  const name = names[sport]?.[code];
  return name && name !== code ? `${name} (${code})` : code;
}

export function teamName(names: TeamNames, sport: string, code: string): string {
  const key=code.toUpperCase();
  const aliases:Record<string,string>=sport==='nfl'?{BUFF:'BUF',WAS:'WSH',LA:'LAR'}:sport==='nba'?{GS:'GSW',NY:'NYK',NO:'NOP',SA:'SAS',PHO:'PHX'}:{};
  return names[sport]?.[key] ?? names[sport]?.[aliases[key]] ?? code;
}
export function eventName(names: TeamNames, sport: string, label: string): string {
  const parts=label.trim().split(/\s+(?:at|@)\s+/);
  if(parts.length!==2)return label;
  const full=(part:string)=>{
    const code=/^[A-Za-z0-9_]{1,8}$/.test(part)?part:/\(([A-Z0-9_]{1,8})\)$/.exec(part)?.[1];
    return code?teamName(names,sport,code):part;
  };
  return `${full(parts[0])} at ${full(parts[1])}`;
}
