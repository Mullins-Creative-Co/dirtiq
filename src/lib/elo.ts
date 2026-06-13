import "server-only";
import { getDb } from "./db";

// DLM site ratings from dirtlatemodel.com/stats (last 365 days, Super Late Models)
// Lower rating = better performance. Used as Elo seeds.
const DLM_RATINGS: Record<string, number> = {
  "Tyler Erb": 61.76,
  "Dennis Erb Jr.": 70.91,
  "Brandon Overton": 63.33,
  "Brandon Sheppard": 59.49,
  "Hudson O'Neal": 58.71,
  "Drake Troutman": 66.39,
  "Ryan Gustin": 65.67,
  "Bobby Pierce": 57.33,
  "Ethan Dotson": 69.83,
  "Clay Stuckey": 104.22,
  "Ricky Thornton Jr.": 61.47,
  "Michael Leach": 84.11,
  "Garrett Alberson": 64.45,
  "Trey Mills": 71.38,
  "Brenden Smith": 88.67,
  "Devin Moran": 61.12,
  "Daulton Wilson": 68.13,
  "Kyle Bronson": 72.63,
  "Brian Shirley": 69.66,
  "Nick Hoffman": 59.37,
  "Tristan Chamberlain": 84.50,
  "Jonathan Davenport": 60.94,
  "Dillon McCowan": 83.29,
  "Tim McCreadie": 64.40,
  "Max Blair": 65.34,
  "Carson Ferguson": 73.60,
  "Josh Rice": 67.03,
  "Dan Ebert": 75.39,
  "Eli Johnson": 110.71,
  "Jason Feger": 73.10,
  "Dustin Sorensen": 72.98,
  "Brent Larson": 88.20,
  "Mike Marlar": 70.38,
  "Clay Harris": 70.40,
  "Cody Overton": 72.80,
  "Jackson Hise": 118.46,
  "Logan Zarin": 88.72,
  "Mark Whitener": 84.11,
  "Matthew Larson": 162.86,
  "Frank Heckenast Jr.": 89.65,
  "Brody Smith": 172.74,
  "Jake Timm": 85.90,
  "Tanner English": 76.95,
  "Luke Morey": 114.23,
  "Sam Seawright": 84.62,
  "Zack Mitchell": 80.36,
  "Daniel Adam": 123.91,
  "Daniel Hilsabeck": 89.44,
  "Eli Ross": 154.38,
  "Cade Dillard": 82.23,
};

// midpoint of the DLM scale used for seed conversion
const DLM_MID = 75;
const DLM_SCALE = 6;
const DEFAULT_ELO = 1500;

// K per pairwise comparison — small value prevents overreaction in a short history
const K_PAIR = 4;

function dlmToElo(rating: number): number {
  return DEFAULT_ELO + (DLM_MID - rating) * DLM_SCALE;
}

function seedElo(name: string): number {
  const dlm = DLM_RATINGS[name];
  return dlm !== undefined ? dlmToElo(dlm) : DEFAULT_ELO;
}

/**
 * Replay all completed races to compute current Elo ratings.
 * excludeRaceId: omit a specific race (use when generating odds for it).
 */
export function computeEloRatings(
  excludeRaceId?: number
): Map<number, number> {
  const db = getDb();

  const drivers = db
    .prepare("SELECT id, name FROM drivers")
    .all() as Array<{ id: number; name: string }>;

  const ratings = new Map<number, number>();
  for (const d of drivers) {
    ratings.set(d.id, seedElo(d.name));
  }

  const races = db
    .prepare(
      `SELECT id FROM races
       WHERE status = 'complete' AND id != COALESCE(?, -1)
       ORDER BY race_date ASC`
    )
    .all(excludeRaceId ?? null) as Array<{ id: number }>;

  for (const race of races) {
    const entries = db
      .prepare(
        `SELECT driver_id, finishing_position
         FROM race_entries
         WHERE race_id = ? AND finishing_position IS NOT NULL AND dnf = 0
         ORDER BY finishing_position ASC`
      )
      .all(race.id) as Array<{ driver_id: number; finishing_position: number }>;

    if (entries.length < 2) continue;

    // Snapshot pre-race ratings so all pairs use the same baseline
    const pre = new Map<number, number>();
    for (const e of entries) {
      pre.set(e.driver_id, ratings.get(e.driver_id) ?? DEFAULT_ELO);
    }

    // Pairwise updates: every driver who finished ahead "beats" every driver below
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const winnerId = entries[i].driver_id;
        const loserId = entries[j].driver_id;
        const Ra = pre.get(winnerId) ?? DEFAULT_ELO;
        const Rb = pre.get(loserId) ?? DEFAULT_ELO;

        const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
        const delta = K_PAIR * (1 - Ea);

        ratings.set(winnerId, (ratings.get(winnerId) ?? DEFAULT_ELO) + delta);
        ratings.set(loserId, (ratings.get(loserId) ?? DEFAULT_ELO) - delta);
      }
    }
  }

  return ratings;
}

/**
 * Return win probabilities for a given field using the Plackett-Luce model:
 * P(i wins) = strength_i / Σ strengths, where strength = 10^(rating/400).
 *
 * excludeRaceId: the race being predicted (excluded from history replay).
 */
export function eloWinProbabilities(
  driverIds: number[],
  excludeRaceId?: number
): Map<number, number> {
  const ratings = computeEloRatings(excludeRaceId);

  let totalStrength = 0;
  const strengths = new Map<number, number>();

  for (const id of driverIds) {
    const s = Math.pow(10, (ratings.get(id) ?? DEFAULT_ELO) / 400);
    strengths.set(id, s);
    totalStrength += s;
  }

  const probs = new Map<number, number>();
  for (const id of driverIds) {
    probs.set(id, (strengths.get(id) ?? 0) / totalStrength);
  }
  return probs;
}

/** Exposed for display — returns current Elo rating for each driver id. */
export function getDriverEloRatings(
  driverIds: number[],
  excludeRaceId?: number
): Map<number, number> {
  const all = computeEloRatings(excludeRaceId);
  const out = new Map<number, number>();
  for (const id of driverIds) {
    out.set(id, Math.round(all.get(id) ?? DEFAULT_ELO));
  }
  return out;
}
