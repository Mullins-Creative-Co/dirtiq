import "server-only";

export type MrpEventCandidate = {
  event_id: number;
  event_name: string;
  track_name: string;
  description: string;
  date_label: string;
  url: string;
  score: number;
  reasons: string[];
};

export type MrpEventSearchRace = {
  name: string;
  track_name: string;
  race_date: string;
  division: string | null;
  series_mode?: string | null;
};

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(speedway|raceway|motor|motorsports|park|dirt|track|the|at|night|day|emr)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string) {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2));
}

function overlapScore(a: string, b: string) {
  const aTokens = tokenSet(a);
  const bTokens = tokenSet(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let hits = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) hits++;
  }
  return hits / Math.max(aTokens.size, bTokens.size);
}

export function parseMrpEventCards(html: string): MrpEventCandidate[] {
  const cards = html.match(/<div class="mrp-rowCardWrap">[\s\S]*?(?=<div class="mrp-rowCardWrap">|<footer|<\/body>|$)/gi) ?? [];
  const candidates: MrpEventCandidate[] = [];
  const seen = new Set<number>();

  for (const card of cards) {
    const idMatch = card.match(/href="\/events\/(\d+)(?:\/races)?"/i);
    const trackMatch = card.match(/<h3>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i);
    const textMatches = [...card.matchAll(/<p class="text-muted(?: text-uppercase)?">([\s\S]*?)<\/p>/gi)];
    if (!idMatch || !trackMatch || textMatches.length === 0) continue;

    const event_id = Number(idMatch[1]);
    if (!Number.isFinite(event_id) || seen.has(event_id)) continue;
    seen.add(event_id);

    const date_label = decodeHtml(textMatches[0]?.[1] ?? "");
    const description = decodeHtml(textMatches[textMatches.length - 1]?.[1] ?? "");
    const track_name = decodeHtml(trackMatch[1] ?? "");

    candidates.push({
      event_id,
      event_name: description || track_name,
      track_name,
      description,
      date_label,
      url: `https://www.myracepass.com/events/${event_id}`,
      score: 0,
      reasons: [],
    });
  }

  return candidates;
}

export function scoreMrpCandidate(race: MrpEventSearchRace, candidate: MrpEventCandidate) {
  let score = 0;
  const reasons: string[] = [];
  const trackScore = overlapScore(race.track_name, candidate.track_name);
  const eventScore = Math.max(
    overlapScore(race.name, candidate.description),
    overlapScore(race.name, candidate.event_name)
  );
  const divisionScore = Math.max(
    overlapScore(race.division ?? "", candidate.description),
    overlapScore(race.series_mode ?? "", candidate.description)
  );

  if (trackScore >= 0.8 || normalize(race.track_name) === normalize(candidate.track_name)) {
    score += 70;
    reasons.push("track match");
  } else if (trackScore >= 0.45) {
    score += 45;
    reasons.push("partial track match");
  }

  if (eventScore >= 0.6) {
    score += 20;
    reasons.push("event name match");
  } else if (eventScore >= 0.3) {
    score += 10;
    reasons.push("partial event match");
  }

  if (divisionScore >= 0.3) {
    score += 10;
    reasons.push("series/class match");
  }

  if (/late model|lucas oil|world of outlaws|woo|lmds/i.test(candidate.description)) {
    score += 5;
    reasons.push("late-model text");
  }

  return { score, reasons };
}

export async function fetchMrpEventsByDate(date: string): Promise<MrpEventCandidate[]> {
  const response = await fetch(`https://www.myracepass.com/events/find/?date=${encodeURIComponent(date)}`, {
    headers: { "user-agent": "DirtIQ/1.0 (+https://dirtiq.vercel.app)" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`MRP event search failed with HTTP ${response.status}.`);
  }

  return parseMrpEventCards(await response.text());
}

export async function findMrpEventForRace(race: MrpEventSearchRace): Promise<{
  best: MrpEventCandidate | null;
  candidates: MrpEventCandidate[];
}> {
  const candidates = await fetchMrpEventsByDate(race.race_date);
  const scored = candidates
    .map((candidate) => {
      const match = scoreMrpCandidate(race, candidate);
      return { ...candidate, score: match.score, reasons: match.reasons };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0] && scored[0].score >= 60 ? scored[0] : null;
  return { best, candidates: scored.slice(0, 5) };
}
