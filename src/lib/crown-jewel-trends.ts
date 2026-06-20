import "server-only";

import { getDb } from "@/lib/db";
import { isCombinedSeries } from "@/lib/series";

type RecentStart = {
  race_name: string;
  race_date: string;
  track_name: string;
  finishing_position: number | null;
};

export type CrownJewelTrendEvaluation = {
  applies: boolean;
  profileName: string | null;
  score: number;
  multiplier: number;
  reasons: string[];
  warnings: string[];
};

type RaceTrendContext = {
  raceName: string;
  trackName: string;
  raceDate: string;
  division: string | null;
  seriesMode: string | null;
};

const dreamShortlist = new Set([
  "jonathan davenport",
  "nick hoffman",
  "bobby pierce",
]);

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function isDreamProfileRace(context: RaceTrendContext) {
  const race = normalize(context.raceName);
  const track = normalize(context.trackName);
  return race.includes("dream") || track.includes("eldora");
}

function isCrownProfileRace(context: RaceTrendContext) {
  return (
    isDreamProfileRace(context) ||
    isCombinedSeries(context.seriesMode ?? context.division) ||
    /world 100|dirt track world championship|dtwc|topless|north-south|knoxville|show-me|firecracker/.test(
      normalize(context.raceName)
    )
  );
}

function recentStarts(driverId: number, raceDate: string): RecentStart[] {
  return getDb()
    .prepare(
      `SELECT r.name AS race_name, r.race_date, t.name AS track_name, e.finishing_position
       FROM race_entries e
       JOIN races r ON r.id = e.race_id
       JOIN tracks t ON t.id = r.track_id
       WHERE e.driver_id = ?
         AND r.status = 'complete'
         AND r.race_date < ?
         AND e.finishing_position IS NOT NULL
       ORDER BY r.race_date DESC, r.id DESC
       LIMIT 5`
    )
    .all(driverId, raceDate) as RecentStart[];
}

function hasMajorEventPedigree(driverId: number) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM race_entries e
       JOIN races r ON r.id = e.race_id
       JOIN tracks t ON t.id = r.track_id
       WHERE e.driver_id = ?
         AND r.status = 'complete'
         AND e.finishing_position BETWEEN 1 AND 5
         AND (
           lower(t.name) LIKE '%eldora%'
           OR lower(r.name) LIKE '%dream%'
           OR lower(r.name) LIKE '%world 100%'
           OR lower(r.name) LIKE '%dirt track world championship%'
           OR lower(r.name) LIKE '%dtwc%'
           OR lower(r.name) LIKE '%topless%'
           OR lower(r.name) LIKE '%north-south%'
           OR lower(r.name) LIKE '%knoxville%'
           OR lower(r.name) LIKE '%show-me%'
         )`
    )
    .get(driverId) as { n: number } | undefined;

  return (row?.n ?? 0) > 0;
}

export function evaluateCrownJewelTrends(
  context: RaceTrendContext,
  driver: { id: number; name: string }
): CrownJewelTrendEvaluation {
  if (!isCrownProfileRace(context)) {
    return {
      applies: false,
      profileName: null,
      score: 0,
      multiplier: 1,
      reasons: [],
      warnings: [],
    };
  }

  const starts = recentStarts(driver.id, context.raceDate);
  const hasRecentWin = starts.some((start) => start.finishing_position === 1);
  const pedigree = hasMajorEventPedigree(driver.id);
  const dreamProfile = isDreamProfileRace(context);
  const inDreamShortlist = dreamShortlist.has(normalize(driver.name));
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  if (hasRecentWin) {
    score += 1;
    reasons.push("Crown trend: won within last 5 recorded starts");
  } else if (starts.length >= 3) {
    warnings.push("Crown trend miss: no win in last 5 recorded starts");
  } else {
    warnings.push("Crown trend unknown: not enough recent completed starts");
  }

  if (pedigree || (dreamProfile && inDreamShortlist)) {
    score += 1;
    reasons.push(dreamProfile ? "Dream/Eldora pedigree trend matched" : "Major-event top-five pedigree matched");
  } else {
    warnings.push(dreamProfile ? "Dream/Eldora pedigree trend not yet supported by local results" : "Major-event pedigree trend not yet supported by local results");
  }

  if (dreamProfile) {
    if (inDreamShortlist) {
      score += 1;
      reasons.push("Dream profile gate: Davenport/Hoffman/Pierce shortlist");
    } else {
      warnings.push("Dream profile gate miss: outside Davenport/Hoffman/Pierce shortlist");
    }
  }

  const required = dreamProfile ? 3 : 2;
  const matchRate = score / required;
  const multiplier =
    matchRate >= 1 ? 1.08 :
    matchRate >= 0.67 ? 1.03 :
    matchRate <= 0.25 ? 0.92 :
    0.97;

  return {
    applies: true,
    profileName: dreamProfile ? "Dream/Eldora trend profile" : "Crown jewel trend profile",
    score,
    multiplier,
    reasons,
    warnings,
  };
}
