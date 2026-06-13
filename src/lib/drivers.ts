import "server-only";
import { getDb } from "@/lib/db";

export type Driver = {
  id: number; name: string; car_number: string | null; hometown: string | null;
  division: string; active: number; notes: string | null; created_at: string;
};

export function listDrivers(): Driver[] {
  return getDb().prepare("SELECT * FROM drivers ORDER BY name ASC").all() as Driver[];
}

export function getDriver(id: number): Driver | null {
  return (getDb().prepare("SELECT * FROM drivers WHERE id = ?").get(id) as Driver) ?? null;
}

export function createDriver(data: { name: string; car_number?: string; hometown?: string; division?: string; notes?: string }): number {
  const r = getDb().prepare(`INSERT INTO drivers (name, car_number, hometown, division, notes) VALUES (?, ?, ?, ?, ?)`)
    .run(data.name, data.car_number ?? null, data.hometown ?? null, data.division ?? "Open", data.notes ?? null);
  return r.lastInsertRowid as number;
}

export function getDriverStats(driverId: number) {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS total_starts,
      SUM(CASE WHEN finishing_position = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN finishing_position <= 5 AND dnf = 0 THEN 1 ELSE 0 END) AS top5,
      SUM(dnf) AS dnfs
    FROM race_entries WHERE driver_id = ? AND finishing_position IS NOT NULL
  `).get(driverId) as { total_starts: number; wins: number; top5: number; dnfs: number };
  const total = row.total_starts || 0;
  const wins = row.wins || 0;
  return { total_starts: total, wins, top5: row.top5 || 0, dnfs: row.dnfs || 0, win_pct: total > 0 ? wins / total : 0 };
}
