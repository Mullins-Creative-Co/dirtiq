import { getFreshness } from "@/lib/freshness";
import { Note } from "@/components/ui/primitives";

export async function RefreshNotice() {
  const state = await getFreshness();
  const messages: string[] = [];
  for (const [name, workflow] of Object.entries(state.workflows)) {
    if (!workflow.verified) messages.push(`${name} refresh status not verified (${workflow.error}).`);
    else if (workflow.latest.status === "completed" && workflow.latest.conclusion !== "success") {
      messages.push(`The latest ${name} refresh ${workflow.latest.conclusion ?? "did not complete"}. Published data may be old.`);
    }
  }
  const overdue = Object.entries(state.sports).filter(([, age]) => age.overdue).map(([sport]) => sport.toUpperCase());
  if (overdue.length) messages.push(`Forecast refresh overdue or missing for ${overdue.join(", ")}: no published update within 75 minutes. A scheduled run may have been missed.`);
  if (state.dailyCard.overdue) messages.push("Daily card refresh overdue or missing: no published update within 75 minutes.");
  if (state.raceData.overdue) messages.push("Race data refresh overdue or not verified: no published update within 75 minutes.");
  return messages.length ? <Note tone="warn"><strong>Refresh needs attention.</strong> {messages.join(" ")}</Note> : null;
}
