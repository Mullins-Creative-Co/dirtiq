import { getScoreboardUrl, parseScoreboard, SCHEDULE_SOURCE, validateScheduleQuery } from '@/lib/matchups/schedule';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let query: ReturnType<typeof validateScheduleQuery>;
  try {
    if (params.getAll('sport').length !== 1 || params.getAll('date').length !== 1) throw new Error('Provide exactly one sport and one date.');
    query = validateScheduleQuery(params.get('sport'), params.get('date'));
  } catch (error) {
    return Response.json({ games: [], sourceLabel: SCHEDULE_SOURCE, error: error instanceof Error ? error.message : 'Invalid schedule request.' }, { status: 400 });
  }
  try {
    const response = await fetch(getScoreboardUrl(query.sport, query.date), {
      signal: AbortSignal.timeout(8000), next: { revalidate: 60 },
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`ESPN scoreboard request failed (HTTP ${response.status}).`);
    const games = parseScoreboard(await response.json(), query.sport);
    return Response.json({ games, sourceLabel: SCHEDULE_SOURCE }, { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } });
  } catch {
    return Response.json({ games: [], sourceLabel: SCHEDULE_SOURCE, error: 'ESPN schedule lookup is unavailable or returned invalid data. Try again later; no replacement games were generated.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
