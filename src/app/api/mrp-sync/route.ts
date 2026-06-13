import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { execSync } from "node:child_process";

const MRP_EVENT_ID = 597630;

interface MrpResult {
  driver_name: string;
  car_number: string;
  finishing_position: number;
  starting_position: number | null;
  feature_plus_minus: number | null;
  dnf: boolean;
  quick_time: number | null;
}

function parseMrpResultsHtml(html: string): MrpResult[] {
  // MRP race result tables: Finish | Start | # | Competitor | Hometown | +/-
  // Parse all <tr> rows and extract cell text
  const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) ?? [];
  const results: MrpResult[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

    if (cells.length < 4) continue;

    // Col 0: finish position (may include " DNF" suffix)
    const rawFinish = cells[0];
    const isDnf = /dnf/i.test(rawFinish) || /dns/i.test(rawFinish);
    const finishPos = parseInt(rawFinish, 10);
    if (!finishPos || isNaN(finishPos)) continue;

    // Col 1: start position
    const startPos = parseInt(cells[1], 10) || null;

    // Col 2: car number (may be empty cell with an icon)
    const carNum = cells[2] || null;

    // Col 3: competitor name — strip hometown which follows a newline
    const rawName = cells[3].split(/\r?\n/)[0].trim();
    if (!rawName || rawName.length < 2) continue;

    // Col 5: +/- (positions gained)
    const rawPlusMinus = cells[5] ?? "";
    const featurePlusMinus = /^-?\d+$/.test(rawPlusMinus.trim())
      ? parseInt(rawPlusMinus.trim(), 10)
      : null;

    // Deduplicate by name+finish (multiple race sessions on same page)
    const key = `${rawName}|${finishPos}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      driver_name: rawName,
      car_number: carNum ?? "",
      finishing_position: finishPos,
      starting_position: startPos,
      feature_plus_minus: featurePlusMinus,
      dnf: isDnf,
      quick_time: null,
    });
  }

  return results;
}

async function fetchMrpResults(eventId: number): Promise<MrpResult[]> {
  let cookieFile = "";
  try {
    execSync("test -f /tmp/mrp3.txt", { timeout: 1000 });
    cookieFile = "-b /tmp/mrp3.txt";
  } catch {}

  const url = `https://www.myracepass.com/events/${eventId}/races`;
  let html: string;
  try {
    html = execSync(
      `curl -s --max-time 10 ${cookieFile} -A "Mozilla/5.0" "${url}"`,
      { timeout: 15000 }
    ).toString();
  } catch {
    return [];
  }

  // If HTML has no result tables, race hasn't happened yet
  if (!/<th[^>]*>\s*Finish\s*<\/th>/i.test(html)) return [];

  return parseMrpResultsHtml(html);
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
      message: "No results from MRP — race may not have started or login session expired",
    });
  }

  let synced = 0;
  for (const r of results) {
    const driverId = fuzzyMatchDriver(r.driver_name, db);
    if (!driverId) continue;

    db.prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number) VALUES (?, ?, ?)`)
      .run(raceId, driverId, r.car_number || null);
    db.prepare(`
      UPDATE race_entries
      SET finishing_position = ?,
          starting_position = ?,
          dnf = ?,
          qualifying_time = ?
      WHERE race_id = ? AND driver_id = ?
    `).run(r.finishing_position, r.starting_position ?? null, r.dnf ? 1 : 0, r.quick_time ?? null, raceId, driverId);
    synced++;
  }

  if (results.length > 0) {
    db.prepare("UPDATE races SET status = 'complete' WHERE id = ?").run(raceId);
  }

  return NextResponse.json({
    synced,
    total: results.length,
    preview: results.slice(0, 5).map((r) => ({
      name: r.driver_name,
      finish: r.finishing_position,
      start: r.starting_position,
      plusMinus: r.feature_plus_minus,
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
