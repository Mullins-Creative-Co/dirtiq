import "server-only";
import { getDb } from "@/lib/db";

export type DriverOdds = {
  driver_id: number; driver_name: string; car_number: string | null;
  starting_position: number | null; win_probability: number; american_odds: number;
  track_starts: number; track_wins: number; recent_form_score: number; overall_win_pct: number;
};

function toAmericanOdds(p: number): number {
  if (p <= 0) return 99999;
  if (p >= 1) return -99999;
  return p >= 0.5 ? Math.round(-(p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
}

export function formatAmericanOdds(odds: number): string {
  return odds >= 0 ? `+${odds}` : `${odds}`;
}

export function calculateRaceOdds(raceId: number, trackId: number): DriverOdds[] {
  const db = getDb();
  const entries = db.prepare(`SELECT e.driver_id, e.car_number, e.starting_position, d.name AS driver_name FROM race_entries e JOIN drivers d ON d.id = e.driver_id WHERE e.race_id = ?`).all(raceId) as { driver_id: number; car_number: string | null; starting_position: number | null; driver_name: string }[];
  if (entries.length === 0) return [];

  const scores = entries.map((entry) => {
    const tr = db.prepare(`SELECT COUNT(*) AS starts, SUM(CASE WHEN e.finishing_position = 1 THEN 1 ELSE 0 END) AS wins FROM race_entries e JOIN races r ON r.id = e.race_id WHERE e.driver_id = ? AND r.track_id = ? AND e.finishing_position IS NOT NULL AND r.id != ?`).get(entry.driver_id, trackId, raceId) as { starts: number; wins: number };
    const trackStarts = tr.starts || 0;
    const trackWins = tr.wins || 0;
    const trackWinRate = trackStarts > 0 ? trackWins / trackStarts : 0;

    const or = db.prepare(`SELECT COUNT(*) AS starts, SUM(CASE WHEN finishing_position = 1 THEN 1 ELSE 0 END) AS wins FROM race_entries WHERE driver_id = ? AND finishing_position IS NOT NULL AND race_id != ?`).get(entry.driver_id, raceId) as { starts: number; wins: number };
    const overallWinRate = (or.starts || 0) > 0 ? (or.wins || 0) / or.starts : 0;

    const recent = db.prepare(`SELECT e.finishing_position, e.dnf FROM race_entries e JOIN races r ON r.id = e.race_id WHERE e.driver_id = ? AND e.finishing_position IS NOT NULL AND e.race_id != ? ORDER BY r.race_date DESC LIMIT 10`).all(entry.driver_id, raceId) as { finishing_position: number; dnf: number }[];

    let fScore = 0, fWeight = 0;
    recent.forEach((r, i) => {
      const w = Math.pow(0.85, i);
      const s = r.dnf ? 0.05 : r.finishing_position === 1 ? 1.0 : r.finishing_position <= 3 ? 0.7 : r.finishing_position <= 5 ? 0.5 : r.finishing_position <= 10 ? 0.3 : 0.1;
      fScore += s * w; fWeight += w;
    });
    const formScore = fWeight > 0 ? fScore / fWeight : 0;

    const rawScore = trackStarts >= 3
      ? trackWinRate * 0.45 + formScore * 0.35 + overallWinRate * 0.20
      : (or.starts > 0 || recent.length > 0) ? formScore * 0.60 + overallWinRate * 0.40 : 0;

    return { ...entry, rawScore, trackStarts, trackWins, formScore, overallWinRate };
  });

  const totalRaw = scores.reduce((s, d) => s + d.rawScore, 0);
  const probs = totalRaw === 0 ? scores.map(() => 1 / scores.length) : scores.map((d) => d.rawScore / totalRaw);

  return scores.map((d, i) => ({
    driver_id: d.driver_id, driver_name: d.driver_name, car_number: d.car_number,
    starting_position: d.starting_position, win_probability: probs[i],
    american_odds: toAmericanOdds(probs[i] * 1.12),
    track_starts: d.trackStarts, track_wins: d.trackWins,
    recent_form_score: d.formScore, overall_win_pct: d.overallWinRate,
  }));
}
