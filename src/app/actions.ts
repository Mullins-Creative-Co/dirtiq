"use server";
import { createDriver } from "@/lib/drivers";
import { createTrack, listTracks } from "@/lib/tracks";
import { createRace, addRaceEntry, recordResult, completeRace } from "@/lib/races";

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

export async function recordResultsAction(data: { race_id: number; results: { driver_id: number; finishing_position?: number; dnf?: boolean }[] }): Promise<{ error?: string }> {
  try {
    for (const r of data.results) {
      recordResult({ race_id: data.race_id, driver_id: r.driver_id, finishing_position: r.finishing_position, dnf: r.dnf });
    }
    completeRace(data.race_id);
    return {};
  } catch { return { error: "Failed to record results." }; }
}
