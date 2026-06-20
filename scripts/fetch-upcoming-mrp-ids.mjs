#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv.includes("--seed")
  ? "public/data/dirtiq.seed.db"
  : "data/dirtiq.db";
const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number.parseInt(limitArg.split("=")[1] ?? "", 10) : 200;

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(speedway|raceway|motor|motorsports|park|dirt|track|the|at|night|day|emr)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value) {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2));
}

function overlapScore(a, b) {
  const aTokens = tokenSet(a);
  const bTokens = tokenSet(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let hits = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) hits++;
  }
  return hits / Math.max(aTokens.size, bTokens.size);
}

function parseMrpEventCards(html) {
  const cards = html.match(/<div class="mrp-rowCardWrap">[\s\S]*?(?=<div class="mrp-rowCardWrap">|<footer|<\/body>|$)/gi) ?? [];
  const candidates = [];
  const seen = new Set();

  for (const card of cards) {
    const idMatch = card.match(/href="\/events\/(\d+)(?:\/races)?"/i);
    const trackMatch = card.match(/<h3>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i);
    const textMatches = [...card.matchAll(/<p class="text-muted(?: text-uppercase)?">([\s\S]*?)<\/p>/gi)];
    if (!idMatch || !trackMatch || textMatches.length === 0) continue;

    const event_id = Number(idMatch[1]);
    if (!Number.isFinite(event_id) || seen.has(event_id)) continue;
    seen.add(event_id);

    const description = decodeHtml(textMatches[textMatches.length - 1]?.[1] ?? "");
    const track_name = decodeHtml(trackMatch[1] ?? "");

    candidates.push({
      event_id,
      event_name: description || track_name,
      track_name,
      description,
      score: 0,
      reasons: [],
    });
  }

  return candidates;
}

function scoreCandidate(race, candidate) {
  let score = 0;
  const reasons = [];
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

  return { ...candidate, score, reasons };
}

const db = new DatabaseSync(dbPath);
const races = db
  .prepare(
    `SELECT r.id, r.name, r.race_date, r.division, r.series_mode, t.name AS track_name
     FROM races r
     JOIN tracks t ON t.id = r.track_id
     WHERE r.status = 'upcoming'
       AND r.mrp_event_id IS NULL
       AND r.race_date >= date('now')
     ORDER BY r.race_date, r.id
     LIMIT ?`
  )
  .all(Number.isFinite(limit) ? limit : 200);

const cache = new Map();
let linked = 0;
let missed = 0;

for (const race of races) {
  let candidates = cache.get(race.race_date);
  if (!candidates) {
    const url = `https://www.myracepass.com/events/find/?date=${encodeURIComponent(race.race_date)}`;
    const response = await fetch(url, {
      headers: { "user-agent": "DirtIQ/1.0 (+https://dirtiq.vercel.app)" },
    });
    if (!response.ok) {
      console.log(`ERR ${race.race_date} ${response.status}`);
      missed++;
      continue;
    }
    candidates = parseMrpEventCards(await response.text());
    cache.set(race.race_date, candidates);
  }

  const best = candidates
    .map((candidate) => scoreCandidate(race, candidate))
    .sort((a, b) => b.score - a.score)[0];

  if (best && best.score >= 60) {
    linked++;
    console.log(
      `${dryRun ? "WOULD LINK" : "LINK"} race ${race.id} ${race.race_date} ${race.track_name} -> MRP ${best.event_id} (${best.track_name}; score ${best.score}; ${best.reasons.join(", ")})`
    );
    if (!dryRun) {
      db.prepare("UPDATE races SET mrp_event_id = ? WHERE id = ?").run(best.event_id, race.id);
    }
  } else {
    missed++;
    console.log(
      `MISS race ${race.id} ${race.race_date} ${race.track_name} (${race.name}) best=${best ? `${best.event_id}/${best.track_name}/${best.score}` : "none"}`
    );
  }
}

console.log(`${dryRun ? "Dry run" : "Done"}: ${linked} linked, ${missed} missed, ${races.length} checked in ${dbPath}`);
