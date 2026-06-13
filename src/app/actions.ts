"use server";
import { createDriver } from "@/lib/drivers";
import { createTrack, listTracks } from "@/lib/tracks";
import { createRace, addRaceEntry, recordResult, completeRace, updatePreRaceData, updateRaceConditions, setRaceLive } from "@/lib/races";
import { placeBet, settleBets, setRiskLimits } from "@/lib/book";
import {
  getOrCreateAccount, addFunds, placePlayerBet, settlePlayerBets,
  type PlayerAccount, type PropType,
} from "@/lib/player-bets";
import { extractEventId, fetchWooHtml, fetchWooRecaps, parseWooHtml, importWooResults, type WooEventSummary } from "@/lib/woo-import";
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
  try {
    return { id: createTrack({ name, location: (fd.get("location") as string) || undefined, surface_type: (fd.get("surface_type") as string) || undefined, track_length: lengthStr ? parseFloat(lengthStr) : undefined, notes: (fd.get("notes") as string) || undefined }) };
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
  try {
    return { id: createRace({ name, track_id: parseInt(trackIdStr, 10), race_date: raceDate, division: (fd.get("division") as string) || undefined, distance: distanceStr ? parseInt(distanceStr, 10) : undefined, track_condition: (fd.get("track_condition") as string) || undefined, weather_notes: (fd.get("weather_notes") as string) || undefined }) };
  } catch { return { error: "Failed to create race." }; }
}

export async function addEntryAction(fd: FormData): Promise<{ error?: string }> {
  const raceIdStr = fd.get("race_id") as string;
  const driverIdStr = fd.get("driver_id") as string;
  if (!raceIdStr || !driverIdStr) return { error: "Missing required fields." };
  const startPosStr = fd.get("starting_position") as string;
  try {
    addRaceEntry({ race_id: parseInt(raceIdStr, 10), driver_id: parseInt(driverIdStr, 10), starting_position: startPosStr ? parseInt(startPosStr, 10) : undefined });
    return {};
  } catch { return { error: "Failed to add entry." }; }
}

export async function recordResultsAction(data: { race_id: number; results: { driver_id: number; finishing_position?: number; laps_led?: number; dnf?: boolean }[] }): Promise<{ error?: string }> {
  try {
    for (const r of data.results) {
      recordResult({ race_id: data.race_id, driver_id: r.driver_id, finishing_position: r.finishing_position, laps_led: r.laps_led, dnf: r.dnf });
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
    revalidatePath(`/races/${raceId}`);
    revalidatePath(`/races/${raceId}/book`);
    return {};
  } catch { return { error: "Failed to update race status." }; }
}

export async function updateConditionsAction(data: { race_id: number; track_condition: string; weather_notes: string }): Promise<{ error?: string }> {
  try {
    updateRaceConditions({ race_id: data.race_id, track_condition: data.track_condition, weather_notes: data.weather_notes });
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
    const account = getOrCreateAccount(name);
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
