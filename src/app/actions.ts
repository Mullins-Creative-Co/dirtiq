"use server";
import { createDriver, listDrivers, getDriver } from "@/lib/drivers";
import { createTrack, listTracks, updateTrack, getTrack, getTrackSimilars, upsertTrackSimilar, removeTrackSimilar } from "@/lib/tracks";
import { createRace, addRaceEntry, recordResult, completeRace, updatePreRaceData, updateRaceConditions, setRaceLive } from "@/lib/races";
import { placeBet, settleBets, setRiskLimits } from "@/lib/book";
import {
  getOrCreateAccount, addFunds, placePlayerBet, settlePlayerBets,
  type PlayerAccount, type PropType,
} from "@/lib/player-bets";
import { upsertDriverSpecialty, removeDriverSpecialty } from "@/lib/driver-specialties";
import { extractEventId, fetchWooHtml, fetchWooRecaps, parseWooHtml, importWooResults, fetchWooStandings, importWooStandings, type WooEventSummary, type StandingsImportResult } from "@/lib/woo-import";
import { fetchMrpLineup } from "@/lib/mrp-lineup";
import { getDb } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function createDriverAction(fd: FormData): Promise<{ error?: string; id?: number }> {
  const name = (fd.get("name") as string)?.trim();
  if (!name) return { error: "Name is required." };
  try {
    return { id: createDriver({ name, car_number: (fd.get("car_number") as string) || undefined, hometown: (fd.get("hometown") as string) || undefined, division: (fd.get("division") as string) || undefined, notes: (fd.get("notes") as string) || undefined }) };
  } catch { return { error: "Failed to create driver." }; }
}

export async function createTrackAction(fd: FormData): Promise<{ error?: string; id?: number }> {
  const name = (fd.get("name") as string)?.trim();
  if (!name) return { error: "Track name is required." };
  const lengthStr = fd.get("track_length") as string;
  const bankingStr = fd.get("banking_angle") as string;
  const cautionStr = fd.get("avg_caution_rate") as string;
  try {
    return { id: createTrack({ name, location: (fd.get("location") as string) || undefined, surface_type: (fd.get("surface_type") as string) || undefined, track_length: lengthStr ? parseFloat(lengthStr) : undefined, banking_angle: bankingStr ? parseFloat(bankingStr) : undefined, clay_type: (fd.get("clay_type") as string) || undefined, avg_caution_rate: cautionStr ? parseFloat(cautionStr) : undefined, notes: (fd.get("notes") as string) || undefined }) };
  } catch { return { error: "Failed to create track." }; }
}

export async function listTracksAction(): Promise<{ id: number; name: string; location: string | null }[]> {
  return listTracks().map((t) => ({ id: t.id, name: t.name, location: t.location }));
}

export async function createRaceAction(fd: FormData): Promise<{ error?: string; id?: number }> {
  const name = (fd.get("name") as string)?.trim();
  const trackIdStr = fd.get("track_id") as string;
  const raceDate = fd.get("race_date") as string;
  if (!name) return { error: "Race name is required." };
  if (!trackIdStr) return { error: "Track is required." };
  if (!raceDate) return { error: "Date is required." };
  const distanceStr = fd.get("distance") as string;
  const tempStr = fd.get("temperature_f") as string;
  const humidStr = fd.get("humidity_pct") as string;
  const precipStr = fd.get("precip_48h_in") as string;
  const wtStr = fd.get("water_truck_runs") as string;
  try {
    return { id: createRace({ name, track_id: parseInt(trackIdStr, 10), race_date: raceDate, division: (fd.get("division") as string) || undefined, distance: distanceStr ? parseInt(distanceStr, 10) : undefined, track_condition: (fd.get("track_condition") as string) || undefined, weather_notes: (fd.get("weather_notes") as string) || undefined, time_of_day: (fd.get("time_of_day") as string) || undefined, temperature_f: tempStr ? parseFloat(tempStr) : undefined, humidity_pct: humidStr ? parseFloat(humidStr) : undefined, precip_48h_in: precipStr ? parseFloat(precipStr) : undefined, water_truck_runs: wtStr ? parseInt(wtStr, 10) : undefined, groove_stage: (fd.get("groove_stage") as string) || undefined }) };
  } catch { return { error: "Failed to create race." }; }
}

export async function addEntryAction(fd: FormData): Promise<{ error?: string }> {
  const raceIdStr = fd.get("race_id") as string;
  const driverIdStr = fd.get("driver_id") as string;
  if (!raceIdStr || !driverIdStr) return { error: "Missing required fields." };
  const startPosStr = fd.get("starting_position") as string;
  try {
    addRaceEntry({ race_id: parseInt(raceIdStr, 10), driver_id: parseInt(driverIdStr, 10), starting_position: startPosStr ? parseInt(startPosStr, 10) : undefined, engine_builder: (fd.get("engine_builder") as string) || undefined, tire_compound: (fd.get("tire_compound") as string) || undefined, crew_chief: (fd.get("crew_chief") as string) || undefined });
    return {};
  } catch { return { error: "Failed to add entry." }; }
}

export async function recordResultsAction(data: { race_id: number; results: { driver_id: number; finishing_position?: number; laps_led?: number; dnf?: boolean; margin?: string; money?: number }[] }): Promise<{ error?: string }> {
  try {
    for (const r of data.results) {
      recordResult({ race_id: data.race_id, driver_id: r.driver_id, finishing_position: r.finishing_position, laps_led: r.laps_led, dnf: r.dnf, margin: r.margin, money: r.money });
    }
    completeRace(data.race_id);
    const winner = data.results.find((r) => r.finishing_position === 1 && !r.dnf);
    if (winner) settleBets(data.race_id, winner.driver_id);
    settlePlayerBets(data.race_id, data.results.map((r) => ({
      driver_id: r.driver_id,
      finishing_position: r.finishing_position ?? null,
      laps_led: r.laps_led ?? 0,
      dnf: r.dnf ?? false,
    })));
    return {};
  } catch { return { error: "Failed to record results." }; }
}

export async function placeBetAction(data: { race_id: number; driver_id: number; bettor_name?: string; amount: number; american_odds: string }): Promise<{ error?: string }> {
  if (data.amount <= 0) return { error: "Stake must be greater than zero." };
  try {
    placeBet(data);
    return {};
  } catch (e) { return { error: e instanceof Error ? e.message : "Failed to place bet." }; }
}

export async function setRiskLimitsAction(data: {
  race_id: number;
  max_payout_per_driver: number | null;
  max_bet_size: number | null;
  alert_handle_pct: number;
}): Promise<{ error?: string }> {
  try {
    setRiskLimits(data);
    return {};
  } catch { return { error: "Failed to save risk limits." }; }
}

export async function voidBetAction(betId: number): Promise<{ error?: string }> {
  try {
    const { voidBet } = await import("@/lib/book");
    voidBet(betId);
    return {};
  } catch { return { error: "Failed to void bet." }; }
}

export async function setRaceLiveAction(raceId: number, live: boolean): Promise<{ error?: string }> {
  try {
    setRaceLive(raceId, live);
    // Lock prediction snapshot the first time a race goes live
    if (live) {
      const { calculateRaceOdds } = await import("@/lib/odds");
      const { lockPredictions } = await import("@/lib/predictions");
      const { getRace } = await import("@/lib/races");
      const race = getRace(raceId);
      if (race) {
        const odds = calculateRaceOdds(raceId, race.track_id);
        if (odds.length > 0) lockPredictions(raceId, odds);
      }
    }
    revalidatePath(`/races/${raceId}`);
    revalidatePath(`/races/${raceId}/book`);
    return {};
  } catch { return { error: "Failed to update race status." }; }
}

export async function updateConditionsAction(data: { race_id: number; track_condition: string; weather_notes: string; time_of_day?: string; temperature_f?: number | null; humidity_pct?: number | null; precip_48h_in?: number | null; water_truck_runs?: number | null; groove_stage?: string | null }): Promise<{ error?: string }> {
  try {
    updateRaceConditions({ race_id: data.race_id, track_condition: data.track_condition, weather_notes: data.weather_notes, time_of_day: data.time_of_day, temperature_f: data.temperature_f, humidity_pct: data.humidity_pct, precip_48h_in: data.precip_48h_in, water_truck_runs: data.water_truck_runs, groove_stage: data.groove_stage });
    return {};
  } catch { return { error: "Failed to update conditions." }; }
}

export async function updatePreRaceDataAction(data: { race_id: number; entries: { driver_id: number; qualifying_time?: number; heat_position?: number; starting_position?: number }[] }): Promise<{ error?: string }> {
  try {
    for (const e of data.entries) {
      updatePreRaceData({ race_id: data.race_id, driver_id: e.driver_id, qualifying_time: e.qualifying_time, heat_position: e.heat_position, starting_position: e.starting_position });
    }
    return {};
  } catch { return { error: "Failed to save pre-race data." }; }
}

// ── WoO Import ────────────────────────────────────────────────────────────────

export async function fetchWooRecapsAction(): Promise<{ events?: WooEventSummary[]; error?: string }> {
  try {
    const events = await fetchWooRecaps("latemodels");
    return { events };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to fetch recaps." };
  }
}

function normalizeName(n: string) {
  return n.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function findBestTrackId(trackName: string, tracks: Array<{ id: number; name: string }>): number | null {
  if (!trackName) return null;
  const norm = normalizeName(trackName);
  for (const t of tracks) {
    if (normalizeName(t.name) === norm) return t.id;
  }
  // Partial: check if any word from the WoO name is in the DB name
  const words = norm.split(" ").filter((w) => w.length > 3);
  for (const t of tracks) {
    const tn = normalizeName(t.name);
    if (words.some((w) => tn.includes(w))) return t.id;
  }
  return null;
}

export async function importWooEventAction(params: {
  eventId: string;
  targetRaceId?: number;
}): Promise<{ error?: string; raceId?: number; matched?: number; created?: number; updated?: number; warnings?: string[] }> {
  try {
    const eid = extractEventId(params.eventId);
    const html = await fetchWooHtml(eid);
    const parsed = parseWooHtml(html);

    if (parsed.entries.length === 0) {
      return { error: "No results found in the WoO page. The site may require a browser to render." };
    }

    let raceId = params.targetRaceId;

    if (!raceId) {
      const db = getDb();
      const tracks = listTracks();

      // Try to find existing race by date + track name match
      const allRaces = db.prepare(
        `SELECT r.id, r.name, r.race_date, t.name AS track_name
         FROM races r JOIN tracks t ON t.id = r.track_id`
      ).all() as Array<{ id: number; name: string; race_date: string; track_name: string }>;

      // Date match: WoO date like "June 12, 2026" → normalize to "2026-06-12"
      let raceDate = parsed.date;
      try {
        const d = new Date(parsed.date);
        if (!isNaN(d.getTime())) {
          raceDate = d.toISOString().slice(0, 10);
        }
      } catch {}

      // Find match by date (within 1 day) + track name overlap
      const normTrack = normalizeName(parsed.track_name);
      for (const r of allRaces) {
        const rTrack = normalizeName(r.track_name);
        const trackMatch = normTrack && rTrack && (
          normTrack.includes(rTrack.split(" ")[0]) ||
          rTrack.includes(normTrack.split(" ")[0])
        );
        const dateMatch = raceDate && Math.abs(
          new Date(r.race_date).getTime() - new Date(raceDate).getTime()
        ) <= 86400 * 2 * 1000;
        if (trackMatch && dateMatch) {
          raceId = r.id;
          break;
        }
      }

      if (!raceId) {
        // Create track if needed
        let trackId = findBestTrackId(parsed.track_name, tracks);
        if (!trackId && parsed.track_name) {
          trackId = createTrack({ name: parsed.track_name });
        } else if (!trackId) {
          // Fallback to first track or create generic
          trackId = tracks[0]?.id ?? createTrack({ name: "Unknown Track" });
        }

        // Create new race (importWooResults will mark it complete)
        raceId = createRace({
          name: parsed.event_name || `WoO Late Models – ${parsed.track_name}`,
          track_id: trackId,
          race_date: raceDate || new Date().toISOString().slice(0, 10),
          division: "WoO Late Models",
        });
      }
    }

    const result = importWooResults(raceId, parsed);
    revalidatePath(`/races/${raceId}`);
    revalidatePath("/races");
    revalidatePath("/import");

    return {
      raceId,
      matched: result.matched,
      created: result.created,
      updated: result.updated,
      warnings: result.warnings,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Import failed." };
  }
}

// ── WoO Points Standings import ───────────────────────────────────────────────

export async function importWooStandingsAction(season: number): Promise<StandingsImportResult & { error?: string }> {
  try {
    const entries = await fetchWooStandings(season);
    const result = importWooStandings(season, entries);
    revalidatePath("/import");
    revalidatePath("/drivers");
    revalidatePath("/model");
    return result;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Standings import failed.", season, total: 0, created: 0, matched: 0, warnings: [] };
  }
}

// ── Simulation ────────────────────────────────────────────────────────────────

export async function placeManualSimBetAction(data: {
  race_id: number;
  bettor_id: number;
  driver_id: number;
  driver_name: string;
  amount: number;
  american_odds: string;
}): Promise<{ blocked?: boolean; blocked_reason?: string; error?: string }> {
  if (data.amount <= 0) return { error: "Stake must be greater than zero." };
  try {
    const { placeManualSimBet } = await import("@/lib/sim");
    const result = placeManualSimBet(data);
    return result;
  } catch (e) { return { error: e instanceof Error ? e.message : "Failed to place bet." }; }
}

export async function runSimulationAction(raceId: number): Promise<{ placed?: number; blocked?: number; error?: string }> {
  try {
    const { calculateRaceOdds } = await import("@/lib/odds");
    const { runSimulation } = await import("@/lib/sim");
    const { getRace } = await import("@/lib/races");
    const race = getRace(raceId);
    if (!race) return { error: "Race not found." };
    const odds = calculateRaceOdds(raceId, race.track_id);
    if (odds.length === 0) return { error: "No drivers in field — add entries first." };
    const result = runSimulation(raceId, odds);
    return result;
  } catch (e) { return { error: e instanceof Error ? e.message : "Simulation failed." }; }
}

export async function clearSimBetsAction(raceId: number): Promise<{ error?: string }> {
  try {
    const { clearSimBets } = await import("@/lib/sim");
    clearSimBets(raceId);
    return {};
  } catch { return { error: "Failed to clear simulation." }; }
}

export async function simulateWinnerAction(raceId: number): Promise<{ driverId?: number; driverName?: string; error?: string }> {
  try {
    const { calculateRaceOdds } = await import("@/lib/odds");
    const { simulateWinner, settleSimBets } = await import("@/lib/sim");
    const { getRace } = await import("@/lib/races");
    const race = getRace(raceId);
    if (!race) return { error: "Race not found." };
    const odds = calculateRaceOdds(raceId, race.track_id);
    if (odds.length === 0) return { error: "No drivers in field." };
    const winnerId = simulateWinner(odds);
    settleSimBets(raceId, winnerId);
    const winner = odds.find((o: { driverId: number }) => o.driverId === winnerId);
    return { driverId: winnerId, driverName: (winner as { driverName: string } | undefined)?.driverName ?? "Unknown" };
  } catch (e) { return { error: e instanceof Error ? e.message : "Failed to simulate winner." }; }
}

// ── Player Betting ─────────────────────────────────────────────────────────────

export async function getOrCreateAccountAction(
  name: string
): Promise<{ error?: string; account?: PlayerAccount }> {
  if (!name.trim()) return { error: "Name is required." };
  try {
    const raw = getOrCreateAccount(name);
    const account: PlayerAccount = { id: raw.id, name: raw.name, balance: raw.balance, created_at: raw.created_at };
    return { account };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create account." };
  }
}

export async function placePlayerBetAction(data: {
  account_id: number;
  race_id: number;
  prop_type: PropType;
  description: string;
  driver_id: number | null;
  driver_b_id: number | null;
  american_odds: string;
  stake: number;
}): Promise<{ error?: string }> {
  if (data.stake <= 0) return { error: "Stake must be greater than zero." };
  try {
    placePlayerBet(data);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to place bet." };
  }
}

export async function addFundsAction(
  accountId: number,
  amount: number
): Promise<{ error?: string }> {
  if (amount <= 0) return { error: "Amount must be positive." };
  try {
    addFunds(accountId, amount);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to add funds." };
  }
}

// ── MRP Lineup Sync ────────────────────────────────────────────────────────────

export async function setMrpEventIdAction(
  raceId: number,
  mrpEventId: number
): Promise<{ error?: string }> {
  try {
    getDb()
      .prepare("UPDATE races SET mrp_event_id = ? WHERE id = ?")
      .run(mrpEventId, raceId);
    revalidatePath(`/races/${raceId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save MRP event ID." };
  }
}

export type MrpSyncResult = {
  error?: string;
  event_name?: string;
  sessions?: Array<{ name: string; type: string; count: number }>;
  updated?: number;
  added?: number;
  warnings?: string[];
};

export async function syncMrpLineupAction(raceId: number): Promise<MrpSyncResult> {
  const db = getDb();
  const race = db
    .prepare("SELECT mrp_event_id FROM races WHERE id = ?")
    .get(raceId) as { mrp_event_id: number | null } | undefined;

  if (!race) return { error: "Race not found." };
  if (!race.mrp_event_id) return { error: "No MRP Event ID linked to this race. Set one first." };

  let lineup;
  try {
    lineup = await fetchMrpLineup(race.mrp_event_id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to fetch MRP lineup." };
  }

  if (lineup.entries.length === 0) {
    return {
      event_name: lineup.event_name,
      sessions: lineup.sessions.map((s) => ({ name: s.name, type: s.type, count: s.entries.length })),
      updated: 0,
      added: 0,
      warnings: lineup.warnings,
    };
  }

  // Fuzzy driver match helper
  function matchDriver(name: string): number | null {
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

  let updated = 0;
  let added = 0;

  for (const entry of lineup.entries) {
    const driverId = matchDriver(entry.driver_name);
    if (!driverId) continue;

    // Ensure race entry exists
    const exists = db
      .prepare("SELECT id FROM race_entries WHERE race_id = ? AND driver_id = ?")
      .get(raceId, driverId) as { id: number } | undefined;

    if (!exists) {
      db.prepare(
        "INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number) VALUES (?, ?, ?)"
      ).run(raceId, driverId, entry.car_number ?? null);
      added++;
    }

    // Update pre-race data — only write fields that MRP returned
    const sets: string[] = [];
    const vals: (number | string | null)[] = [];

    if (entry.qualifying_time !== null) {
      sets.push("qualifying_time = ?");
      vals.push(entry.qualifying_time);
    }
    if (entry.heat_position !== null) {
      sets.push("heat_position = ?");
      vals.push(entry.heat_position);
    }
    if (entry.starting_position !== null) {
      sets.push("starting_position = ?");
      vals.push(entry.starting_position);
    }
    if (entry.car_number) {
      sets.push("car_number = COALESCE(car_number, ?)");
      vals.push(entry.car_number);
    }

    if (sets.length > 0) {
      db.prepare(
        `UPDATE race_entries SET ${sets.join(", ")} WHERE race_id = ? AND driver_id = ?`
      ).run(...vals, raceId, driverId);
      if (exists) updated++;
    }
  }

  revalidatePath(`/races/${raceId}`);
  revalidatePath(`/bet/${raceId}`);

  return {
    event_name: lineup.event_name,
    sessions: lineup.sessions.map((s) => ({ name: s.name, type: s.type, count: s.entries.length })),
    updated,
    added,
    warnings: lineup.warnings,
  };
}

export async function resetPrelimDataAction(raceId: number): Promise<{ error?: string }> {
  try {
    getDb()
      .prepare(
        "UPDATE race_entries SET qualifying_time = NULL, heat_position = NULL WHERE race_id = ?"
      )
      .run(raceId);
    revalidatePath(`/races/${raceId}`);
    revalidatePath(`/bet/${raceId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to reset prelim data." };
  }
}

// ── Track Management ──────────────────────────────────────────────────────────

export async function updateTrackAction(
  id: number,
  data: { name?: string; location?: string; surface_type?: string; track_length?: number | null; banking_angle?: number | null; clay_type?: string | null; avg_caution_rate?: number | null; track_family?: string | null; notes?: string | null }
): Promise<{ error?: string }> {
  try {
    updateTrack(id, data);
    revalidatePath(`/tracks/${id}`);
    revalidatePath("/tracks");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update track." };
  }
}

export async function upsertTrackSimilarAction(
  trackId: number, similarTrackId: number, weight: number, notes?: string
): Promise<{ error?: string }> {
  try {
    upsertTrackSimilar(trackId, similarTrackId, weight, notes);
    revalidatePath(`/tracks/${trackId}`);
    revalidatePath(`/tracks/${similarTrackId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save similarity." };
  }
}

export async function removeTrackSimilarAction(
  trackId: number, similarTrackId: number
): Promise<{ error?: string }> {
  try {
    removeTrackSimilar(trackId, similarTrackId);
    revalidatePath(`/tracks/${trackId}`);
    revalidatePath(`/tracks/${similarTrackId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to remove similarity." };
  }
}

// ── Driver Specialties ─────────────────────────────────────────────────────────

export async function upsertDriverSpecialtyAction(data: {
  driver_id: number;
  track_family?: string | null;
  track_id?: number | null;
  bonus_score: number;
  notes?: string | null;
}): Promise<{ error?: string }> {
  try {
    upsertDriverSpecialty(data);
    revalidatePath(`/drivers/${data.driver_id}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save specialty." };
  }
}

export async function removeDriverSpecialtyAction(id: number, driverId: number): Promise<{ error?: string }> {
  try {
    removeDriverSpecialty(id);
    revalidatePath(`/drivers/${driverId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to remove specialty." };
  }
}

// ── AI Suggest Actions ─────────────────────────────────────────────────────────

export type AISimilaritySuggestion = {
  track_id: number;
  track_name: string;
  weight: number;
  reasoning: string;
};

export type AISpecialtySuggestion = {
  track_family: string;
  track_id: number | null;
  bonus_score: number;
  reasoning: string;
};

export async function suggestTrackSimilarsAction(
  trackId: number
): Promise<{ error?: string; suggestions?: AISimilaritySuggestion[] }> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic();

    const target = getTrack(trackId);
    if (!target) return { error: "Track not found." };

    const allTracks = listTracks().filter((t) => t.id !== trackId);
    if (allTracks.length === 0) return { error: "No other tracks to compare." };

    const existing = getTrackSimilars(trackId);
    const existingIds = new Set(existing.map((e) => e.similar_track_id));

    const trackList = allTracks.map((t) =>
      `ID ${t.id}: "${t.name}" — ${t.location ?? "unknown location"}, ${t.surface_type}, ${t.track_length ? t.track_length + " mi" : "unknown length"}${t.track_family ? `, family: ${t.track_family}` : ""}`
    ).join("\n");

    const prompt = `You are an expert in dirt track late model racing track analysis. Given a target track, suggest similarity weights to other tracks based on characteristics that directly influence racing performance — specifically how well results at one track predict results at another.

Similarity weights (0.0–1.0):
- 0.85–1.0: Nearly identical style, length, and surface prep — results transfer very strongly
- 0.60–0.84: Very similar — same length family, similar region and style
- 0.35–0.59: Moderate similarity — shared characteristics but meaningful differences
- 0.10–0.34: Loose similarity — different but some skill transfer
- 0.0: No meaningful similarity

Target track: "${target.name}" — ${target.location ?? "unknown location"}, ${target.surface_type}, ${target.track_length ? target.track_length + " mi" : "unknown length"}${target.track_family ? `, family: ${target.track_family}` : ""}

Key factors to weigh: track length (strongest predictor of setup similarity), surface type, geographic region (affects typical soil and weather), banking style, and speed/racing groove style (bullring vs racy).

Other tracks:
${trackList}

Return ONLY valid JSON in this exact format, no other text:
{"similarities": [{"track_id": <number>, "weight": <0.0-1.0>, "reasoning": "<1 sentence>"}]}

Include all ${allTracks.length} tracks with their appropriate weights.`;

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { error: "AI returned unexpected format." };

    const parsed = JSON.parse(jsonMatch[0]) as {
      similarities: Array<{ track_id: number; weight: number; reasoning: string }>;
    };

    const suggestions: AISimilaritySuggestion[] = parsed.similarities
      .map((s) => {
        const t = allTracks.find((x) => x.id === s.track_id);
        if (!t) return null;
        return {
          track_id: s.track_id,
          track_name: t.name,
          weight: Math.max(0, Math.min(1, s.weight)),
          reasoning: s.reasoning,
          existing: existingIds.has(s.track_id),
        };
      })
      .filter(Boolean) as AISimilaritySuggestion[];

    return { suggestions };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI suggestion failed." };
  }
}

export async function suggestDriverSpecialtiesAction(
  driverId: number
): Promise<{ error?: string; suggestions?: AISpecialtySuggestion[] }> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic();

    const driver = getDriver(driverId);
    if (!driver) return { error: "Driver not found." };

    const allTracks = listTracks();
    const trackList = allTracks.map((t) =>
      `ID ${t.id}: "${t.name}" — ${t.location ?? "unknown"}, ${t.surface_type}, ${t.track_length ? t.track_length + " mi" : "?"}${t.track_family ? `, family: ${t.track_family}` : ""}`
    ).join("\n");

    const prompt = `You are an expert in WoO (World of Outlaws) Late Model dirt track racing. Given a driver's profile, identify which track types and specific tracks they are known to excel at — their "specialties" where their results are stronger than their overall average.

Driver: ${driver.name}
Car number: ${driver.car_number ?? "unknown"}
Hometown: ${driver.hometown ?? "unknown"}
Notes: ${driver.notes ?? "none"}

Consider:
1. Regional specialists — drivers near their hometown often have home-track advantages at local tracks
2. Track style specialists — bullring experts vs big-track specialists
3. Surface specialists — some drivers excel on drier/slicker surfaces
4. Known historical strengths you have from training data about this driver

Tracks in our database:
${trackList}

For each specialty:
- track_family: a descriptive label like "Illinois Quarter Mile", "WV Clay Half Mile", "Midwest Bullring" — used to group similar tracks. Can be a new family not listed above.
- track_id: specific track ID if this is a specific-track specialty (null if it applies to a family)
- bonus_score: 0.05–0.25 (0.05 = modest edge, 0.15 = strong specialist, 0.25 = dominant home-track advantage)
- reasoning: one sentence why

Return ONLY valid JSON, no other text:
{"specialties": [{"track_family": "<string>", "track_id": <number or null>, "bonus_score": <0.05-0.25>, "reasoning": "<1 sentence>"}]}

Only include meaningful specialties (at least 1, max 5). If you have no knowledge of this driver, return {"specialties": []}.`;

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { error: "AI returned unexpected format." };

    const parsed = JSON.parse(jsonMatch[0]) as {
      specialties: Array<{ track_family: string; track_id: number | null; bonus_score: number; reasoning: string }>;
    };

    const suggestions: AISpecialtySuggestion[] = parsed.specialties.map((s) => ({
      track_family: s.track_family,
      track_id: s.track_id,
      bonus_score: Math.max(0.05, Math.min(0.30, s.bonus_score)),
      reasoning: s.reasoning,
    }));

    return { suggestions };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI suggestion failed." };
  }
}
