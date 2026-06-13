import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { execSync } from "node:child_process";

const MRP_EVENT_ID = 597630;

interface MrpResult {
  driver_name: string;
  car_number: string;
  position: number;
  laps_completed: number;
  dnf: boolean;
  quick_time: number | null;
}

async function fetchMrpResults(eventId: number): Promise<MrpResult[]> {
  // MRP uses cookie-based session — try to read cached cookies
  let cookieFile = "";
  try {
    execSync("test -f /tmp/mrp3.txt", { timeout: 1000 });
    cookieFile = "-b /tmp/mrp3.txt";
  } catch {}

  const url = `https://www.myracepass.com/events/${eventId}/races`;
  let rawJson: string;
  try {
    rawJson = execSync(
      `curl -s --max-time 10 ${cookieFile} -H "Accept: application/json" "${url}"`,
      { timeout: 15000 }
    ).toString();
  } catch {
    return [];
  }

  let data: unknown;
  try { data = JSON.parse(rawJson); } catch { return []; }

  const results: MrpResult[] = [];
  const rows = Array.isArray(data) ? data : (data as Record<string, unknown[]>)?.races ?? [];
  for (const item of rows as Record<string, unknown>[]) {
    const pos = Number(item.finishing_position ?? item.position ?? 0);
    if (!pos) continue;
    results.push({
      driver_name: String(item.driver_name ?? item.name ?? ""),
      car_number: String(item.car_number ?? item.number ?? ""),
      position: pos,
      laps_completed: Number(item.laps ?? item.laps_completed ?? 0),
      dnf: Boolean(item.dnf ?? item.did_not_finish ?? false),
      quick_time: item.quick_time ? Number(item.quick_time) : null,
    });
  }
  return results;
}

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
  const raceId = parseInt(searchParams.get("race_id") ?? "1", 10);

  const db = getDb();
  const race = db.prepare("SELECT * FROM races WHERE id = ?").get(raceId) as
    { mrp_event_id: number | null; status: string } | undefined;
  if (!race) return NextResponse.json({ error: "Race not found" }, { status: 404 });

  const eventId = race.mrp_event_id ?? MRP_EVENT_ID;
  const results = await fetchMrpResults(eventId);

  if (results.length === 0) {
    return NextResponse.json({
      synced: 0,
      message: "No results from MRP — race may not have started or session expired",
    });
  }

  let synced = 0;
  for (const r of results) {
    const driverId = fuzzyMatchDriver(r.driver_name, db);
    if (!driverId) continue;

    db.prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number) VALUES (?, ?, ?)`).run(raceId, driverId, r.car_number || null);
    db.prepare(`UPDATE race_entries SET finishing_position = ?, dnf = ?, qualifying_time = ? WHERE race_id = ? AND driver_id = ?`)
      .run(r.position, r.dnf ? 1 : 0, r.quick_time ?? null, raceId, driverId);
    synced++;
  }

  if (results.length > 0 && results.every((r) => r.position > 0)) {
    db.prepare("UPDATE races SET status = 'complete' WHERE id = ?").run(raceId);
  }

  return NextResponse.json({ synced, total: results.length, preview: results.slice(0, 5) });
}

// Manual result entry: POST { race_id, driver_name, position, dnf?, quick_time? }
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    race_id: number;
    driver_name: string;
    position: number;
    dnf?: boolean;
    quick_time?: number;
  };

  const db = getDb();
  const driverId = fuzzyMatchDriver(body.driver_name, db);
  if (!driverId) {
    return NextResponse.json({ error: `Driver not found: ${body.driver_name}` }, { status: 404 });
  }

  db.prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id) VALUES (?, ?)`).run(body.race_id, driverId);
  db.prepare(`UPDATE race_entries SET finishing_position = ?, dnf = ?, qualifying_time = ? WHERE race_id = ? AND driver_id = ?`)
    .run(body.position || null, body.dnf ? 1 : 0, body.quick_time ?? null, body.race_id, driverId);

  return NextResponse.json({ ok: true, driver_id: driverId });
}
