import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchMrpFinalResults } from "@/lib/mrp-results";
import { applyRaceResults } from "@/lib/race-settlement";

function fuzzyMatchDriver(name: string, db: ReturnType<typeof getDb>): number | null {
  const exact = db.prepare("SELECT id FROM drivers WHERE LOWER(name) = LOWER(?) LIMIT 1").get(name) as { id: number } | undefined;
  if (exact) return exact.id;
  const lastName = name.trim().split(/\s+/).pop() ?? "";
  if (!lastName) return null;
  const fuzzy = db.prepare("SELECT id FROM drivers WHERE LOWER(name) LIKE LOWER(?) LIMIT 1").get(`%${lastName}%`) as { id: number } | undefined;
  return fuzzy?.id ?? null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const raceId = parseInt(searchParams.get("race_id") ?? searchParams.get("raceId") ?? "1", 10);

  const db = getDb();
  const race = db.prepare("SELECT * FROM races WHERE id = ?").get(raceId) as
    { mrp_event_id: number | null; status: string } | undefined;
  if (!race) return NextResponse.json({ error: "Race not found" }, { status: 404 });
  if (!race.mrp_event_id) {
    return NextResponse.json({ error: "No MRP Event ID linked to this race" }, { status: 400 });
  }

  const imported = await fetchMrpFinalResults(race.mrp_event_id);
  const results = imported.results;

  if (results.length === 0) {
    return NextResponse.json({
      synced: 0,
      message: "No results from MRP - race may not have started or the event page may not have final results yet",
      warnings: imported.warnings,
    });
  }

  const settlement = await applyRaceResults(raceId, results, `MRP ${race.mrp_event_id}`);

  return NextResponse.json({
    synced: settlement.synced,
    total: results.length,
    settlement,
    preview: results.slice(0, 5).map((r) => ({
      name: r.driver_name,
      finish: r.finishing_position,
      start: r.starting_position,
      lapsLed: r.laps_led,
      dnf: r.dnf,
    })),
  });
}

// Manual result entry: POST { race_id, driver_name, position, starting_position?, dnf?, quick_time? }
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    race_id: number;
    driver_name: string;
    position: number;
    starting_position?: number;
    dnf?: boolean;
    quick_time?: number;
  };

  const db = getDb();
  const driverId = fuzzyMatchDriver(body.driver_name, db);
  if (!driverId) {
    return NextResponse.json({ error: `Driver not found: ${body.driver_name}` }, { status: 404 });
  }

  db.prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id) VALUES (?, ?)`).run(body.race_id, driverId);
  db.prepare(`
    UPDATE race_entries
    SET finishing_position = ?,
        starting_position = ?,
        dnf = ?,
        qualifying_time = ?
    WHERE race_id = ? AND driver_id = ?
  `).run(body.position || null, body.starting_position ?? null, body.dnf ? 1 : 0, body.quick_time ?? null, body.race_id, driverId);

  return NextResponse.json({ ok: true, driver_id: driverId });
}
