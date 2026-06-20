import "server-only";
import { fetchMrpLineup, type MrpSession } from "@/lib/mrp-lineup";
import type { ImportedRaceResult } from "@/lib/race-settlement";

export type MrpResultsImport = {
  event_name: string;
  session_name: string;
  results: ImportedRaceResult[];
  warnings: string[];
};

function pickFinalSession(sessions: MrpSession[]): MrpSession | null {
  return sessions
    .filter((session) => session.type === "feature" && session.entries.length > 0 && isLateModelSession(session.name))
    .sort((a, b) => b.entries.length - a.entries.length)[0];
}

function isLateModelSession(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes("sportmod") || normalized.includes("stock car") || normalized.includes("front wheel") || normalized.includes("crown vic")) {
    return false;
  }
  return (
    normalized.includes("late model") ||
    normalized.includes("super late") ||
    normalized.includes("lolmds") ||
    normalized.includes("outlaws")
  );
}

export async function fetchMrpFinalResults(eventId: number): Promise<MrpResultsImport> {
  const lineup = await fetchMrpLineup(eventId);
  const session = pickFinalSession(lineup.sessions);
  if (!session) {
    return {
      event_name: lineup.event_name,
      session_name: "",
      results: [],
      warnings: [...lineup.warnings, "No final-results session was found on MRP."],
    };
  }

  return {
    event_name: lineup.event_name,
    session_name: session.name,
    results: session.entries.map((entry) => ({
      driver_name: entry.driver_name,
      car_number: entry.car_number,
      finishing_position: entry.position,
      starting_position: entry.starting_position,
      laps_led: 0,
      dnf: entry.dnf,
    })),
    warnings: lineup.warnings,
  };
}
