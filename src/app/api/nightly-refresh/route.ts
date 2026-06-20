import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { revalidatePath } from "next/cache";
import { calculateRaceOdds } from "@/lib/odds";
import { getDb } from "@/lib/db";
import { fetchMrpLineup, mergeSessions, type MrpLineupEntry, type MrpSession } from "@/lib/mrp-lineup";
import { fetchMrpFinalResults } from "@/lib/mrp-results";
import { applyRaceResults } from "@/lib/race-settlement";
import { todayDateString } from "@/lib/races";

export const runtime = "nodejs";

type RefreshRace = {
  id: number;
  name: string;
  race_date: string;
  mrp_event_id: number;
  track_id: number;
};

const runFile = promisify(execFile);

function tomorrowDateString() {
  const [year, month, day] = todayDateString().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1, 12));
  return date.toISOString().slice(0, 10);
}

function isLateModelSession(session: MrpSession) {
  const normalized = session.name.toLowerCase();
  if (
    normalized.includes("sportmod") ||
    normalized.includes("stock car") ||
    normalized.includes("front wheel") ||
    normalized.includes("crown vic") ||
    normalized.includes("sportsman")
  ) {
    return false;
  }
  return (
    normalized.includes("late model") ||
    normalized.includes("super late") ||
    normalized.includes("lolmds") ||
    normalized.includes("outlaws")
  );
}

function authorize(req: NextRequest) {
  const secret = process.env.DIRTIQ_CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";
  return header === `Bearer ${secret}` || token === secret;
}

function matchDriverId(name: string) {
  const db = getDb();
  const norm = name.trim().toLowerCase();
  const exact = db
    .prepare("SELECT id FROM drivers WHERE LOWER(name) = ? LIMIT 1")
    .get(norm) as { id: number } | undefined;
  if (exact) return exact.id;

  const lastName = norm.split(/\s+/).pop() ?? "";
  if (!lastName || lastName.length < 3) return null;
  const fuzzy = db
    .prepare("SELECT id FROM drivers WHERE LOWER(name) LIKE ? LIMIT 1")
    .get(`%${lastName}%`) as { id: number } | undefined;
  return fuzzy?.id ?? null;
}

function applyLineup(raceId: number, entries: MrpLineupEntry[]) {
  const db = getDb();
  let updated = 0;
  let added = 0;

  for (const entry of entries) {
    const driverId = matchDriverId(entry.driver_name);
    if (!driverId) continue;

    const exists = db
      .prepare("SELECT id FROM race_entries WHERE race_id = ? AND driver_id = ?")
      .get(raceId, driverId) as { id: number } | undefined;

    if (!exists) {
      db.prepare(
        `INSERT OR IGNORE INTO race_entries
           (race_id, driver_id, car_number, entry_status, entry_status_updated_at)
         VALUES (?, ?, ?, 'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
      ).run(raceId, driverId, entry.car_number ?? null);
      added++;
    }

    const sets = [
      "entry_status = 'confirmed'",
      "entry_status_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    ];
    const values: Array<string | number | null> = [];

    if (entry.car_number) {
      sets.push("car_number = COALESCE(car_number, ?)");
      values.push(entry.car_number);
    }
    if (entry.qualifying_time !== null) {
      sets.push("qualifying_time = ?");
      values.push(entry.qualifying_time);
    }
    if (entry.heat_position !== null) {
      sets.push("heat_position = ?");
      values.push(entry.heat_position);
    }
    if (entry.bmain_position !== null) {
      sets.push("bmain_position = ?");
      values.push(entry.bmain_position);
    }
    if (entry.starting_position !== null) {
      sets.push("starting_position = ?");
      values.push(entry.starting_position);
    }

    db.prepare(`UPDATE race_entries SET ${sets.join(", ")} WHERE race_id = ? AND driver_id = ?`)
      .run(...values, raceId, driverId);
    if (exists) updated++;
  }

  return { added, updated };
}

async function refreshXgboostCache(raceId: number) {
  try {
    const { stdout } = await runFile("python3", ["scripts/predict_model.py", String(raceId), "--cache"], {
      cwd: process.cwd(),
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const payload = JSON.parse(stdout) as { predictions?: unknown[]; modelSeries?: string; modelSlug?: string };
    return {
      scored: payload.predictions?.length ?? 0,
      modelSeries: payload.modelSeries ?? null,
      modelSlug: payload.modelSlug ?? null,
    };
  } catch (error) {
    return {
      scored: 0,
      error: error instanceof Error ? error.message : "XGBoost refresh failed",
    };
  }
}

function currentTopLines(raceId: number, trackId: number) {
  try {
    return calculateRaceOdds(raceId, trackId)
      .slice(0, 5)
      .map((line) => ({
        driverId: line.driverId,
        driverName: line.driverName,
        odds: line.americanOdds,
        probability: line.impliedProbability,
        reasons: line.reasoning.highlights.slice(0, 3),
        warnings: line.reasoning.warnings.slice(0, 2),
      }));
  } catch {
    return [];
  }
}

function revalidateRaceViews(raceId: number) {
  revalidatePath("/admin/live");
  revalidatePath("/bet");
  revalidatePath(`/race/${raceId}`);
  revalidatePath(`/admin/races/${raceId}`);
  revalidatePath(`/admin/races/${raceId}/book`);
  revalidatePath(`/admin/races/${raceId}/prediction`);
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const allowSettlement = req.nextUrl.searchParams.get("settle") === "1";
  const races = db
    .prepare(
      `SELECT id, name, race_date, mrp_event_id, track_id
       FROM races
       WHERE status = 'upcoming'
         AND mrp_event_id IS NOT NULL
         AND race_date BETWEEN ? AND ?
       ORDER BY race_date ASC, id ASC`
    )
    .all(todayDateString(), tomorrowDateString()) as RefreshRace[];

  const report = [];

  for (const race of races) {
    try {
      const finalResults = await fetchMrpFinalResults(race.mrp_event_id);
      if (allowSettlement && finalResults.results.length > 0) {
        const settlement = await applyRaceResults(race.id, finalResults.results, `MRP cron ${race.mrp_event_id}`);
        const model = await refreshXgboostCache(race.id);
        revalidateRaceViews(race.id);
        report.push({
          raceId: race.id,
          raceName: race.name,
          mode: "settled",
          synced: settlement.synced,
          total: finalResults.results.length,
          session: finalResults.session_name,
          model,
          topLines: currentTopLines(race.id, race.track_id),
          warnings: finalResults.warnings,
        });
        continue;
      }

      const lineup = await fetchMrpLineup(race.mrp_event_id);
      const targetSessions = lineup.sessions.filter(isLateModelSession);
      const targetEntries = mergeSessions(targetSessions);
      const applied = applyLineup(race.id, targetEntries);
      if (targetSessions.length > 0) {
        db.prepare(
          `UPDATE races
           SET is_live = 1,
               betting_status = CASE WHEN betting_status = 'open' THEN 'locked' ELSE betting_status END,
               betting_locked_at = COALESCE(betting_locked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
               betting_lock_reason = COALESCE(betting_lock_reason, 'MRP race-night session detected')
           WHERE id = ?`
        ).run(race.id);
      }

      const model = targetSessions.length > 0 ? await refreshXgboostCache(race.id) : null;
      if (targetSessions.length > 0) revalidateRaceViews(race.id);

      report.push({
        raceId: race.id,
        raceName: race.name,
        mode: targetSessions.length > 0 ? "live-lineup" : "waiting",
        sessions: targetSessions.map((session) => ({
          name: session.name,
          type: session.type,
          count: session.entries.length,
        })),
        entries: targetEntries.length,
        ...applied,
        model,
        topLines: currentTopLines(race.id, race.track_id),
        warnings: [
          ...lineup.warnings,
          ...(finalResults.results.length > 0
            ? ["Final results are available on MRP but were not settled. Add ?settle=1 to grade the race."]
            : []),
        ],
      });
    } catch (error) {
      report.push({
        raceId: race.id,
        raceName: race.name,
        mode: "error",
        error: error instanceof Error ? error.message : "Refresh failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: races.length,
    generatedAt: new Date().toISOString(),
    report,
  });
}
