// Display metadata only: refresh from ESPN without changing any model identifiers.
import { writeFile } from 'node:fs/promises';
const paths = { ncaab: 'basketball/mens-college-basketball', ncaaf: 'football/college-football' };
const date = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replaceAll('-', '');
const now = new Date();
const teams = {};
const sources = [];
for (const [sport, path] of Object.entries(paths)) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/${path}`;
  const urls = [`${base}/teams?limit=1000`, `${base}/scoreboard?dates=${date(now)}&limit=1000&groups=50`];
  const [catalog, scoreboard] = await Promise.all(urls.map(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${sport}: ESPN HTTP ${response.status}`);
    return response.json();
  }));
  sources.push(...urls);
  const entries = [
    ...(catalog.sports?.[0]?.leagues?.[0]?.teams ?? []).map(({ team }) => team),
    ...(scoreboard.events ?? []).flatMap((event) => (event.competitions ?? []).flatMap((game) => (game.competitors ?? []).map(({ team }) => team))),
  ];
  if (entries.length < 100) throw new Error(`${sport}: incomplete ESPN team catalog`);
  const candidates = new Map();
  for (const team of entries) {
    if (!team.abbreviation || !team.displayName || !team.id) continue;
    const byId = candidates.get(team.abbreviation) ?? new Map();
    byId.set(team.id, team.displayName);
    candidates.set(team.abbreviation, byId);
  }
  // Ambiguous abbreviations retain their original code; never guess a school.
  teams[sport] = Object.fromEntries([...candidates].filter(([, names]) => names.size === 1).map(([code, names]) => [code, [...names.values()][0]]).sort(([a], [b]) => a.localeCompare(b)));
  console.log(`${sport}: ${Object.keys(teams[sport]).length} unambiguous names`);
}
await writeFile(new URL('../public/data/team-names.json', import.meta.url), JSON.stringify({ generatedAt: now.toISOString(), sources, teams }, null, 2) + '\n');
