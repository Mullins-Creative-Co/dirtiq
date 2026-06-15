"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateConditionsAction } from "@/app/actions";

const CONDITIONS = ["Tacky", "Dry Slick", "Cushion", "Groomed", "Heavy", "Muddy"] as const;

const CONDITION_HINTS: Record<string, string> = {
  Tacky:     "Ideal surface — moisture locked in, predictable",
  "Dry Slick": "Surface dried out — slick bottom, speed on top",
  Cushion:   "Rubber built up on outside — 2-groove, aggressive",
  Groomed:   "Fresh prep, uniform surface",
  Heavy:     "Lots of moisture, sloppy — lower power tracks",
  Muddy:     "Water-soaked, no traction, survival racing",
};

const QUICK_NOTES = [
  "2 grooves", "single groove", "bottom only", "rubber on bottom",
  "cushion building", "slick on top", "cushion gone", "dusty",
  "moisture coming in", "track taking rubber", "marbles on outside",
];

const GROOVE_STAGES = [
  { value: "", label: "Unknown" },
  { value: "fresh", label: "Fresh prep" },
  { value: "early", label: "Early rubber" },
  { value: "mid", label: "Mid-groove development" },
  { value: "cushion", label: "Cushion forming" },
  { value: "slick", label: "Slick / locked down" },
];

export function LiveConditionsForm({
  raceId,
  currentCondition,
  currentNotes,
  currentTimeOfDay,
  currentTempF,
  currentHumidityPct,
  currentPrecip48hIn,
  currentWaterTruckRuns,
  currentGrooveStage,
}: {
  raceId: number;
  currentCondition: string;
  currentNotes: string | null;
  currentTimeOfDay?: string;
  currentTempF?: number | null;
  currentHumidityPct?: number | null;
  currentPrecip48hIn?: number | null;
  currentWaterTruckRuns?: number | null;
  currentGrooveStage?: string | null;
}) {
  const [condition, setCondition] = useState(currentCondition);
  const [notes, setNotes] = useState(currentNotes ?? "");
  const [timeOfDay, setTimeOfDay] = useState(currentTimeOfDay ?? "night");
  const [tempF, setTempF] = useState(currentTempF?.toString() ?? "");
  const [humidityPct, setHumidityPct] = useState(currentHumidityPct?.toString() ?? "");
  const [precip48h, setPrecip48h] = useState(currentPrecip48hIn?.toString() ?? "");
  const [waterTruckRuns, setWaterTruckRuns] = useState(currentWaterTruckRuns?.toString() ?? "");
  const [grooveStage, setGrooveStage] = useState(currentGrooveStage ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function addNote(tag: string) {
    setNotes((n) => {
      const trimmed = n.trim();
      if (trimmed.toLowerCase().includes(tag.toLowerCase())) return n;
      return trimmed ? `${trimmed}, ${tag}` : tag;
    });
    setSaved(false);
  }

  function save() {
    startTransition(async () => {
      const res = await updateConditionsAction({
        race_id: raceId,
        track_condition: condition,
        weather_notes: notes,
        time_of_day: timeOfDay,
        temperature_f: tempF ? parseFloat(tempF) : null,
        humidity_pct: humidityPct ? parseFloat(humidityPct) : null,
        precip_48h_in: precip48h ? parseFloat(precip48h) : null,
        water_truck_runs: waterTruckRuns ? parseInt(waterTruckRuns, 10) : null,
        groove_stage: grooveStage || null,
      });
      if (!res.error) {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Condition picker */}
      <div className="grid grid-cols-2 gap-1.5">
        {CONDITIONS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => { setCondition(c); setSaved(false); }}
            className={`rounded-lg px-3 py-2 text-xs font-semibold text-left transition-colors ${
              condition === c
                ? "bg-amber-500 text-black"
                : "bg-[var(--surface-raised)] text-[var(--muted)] hover:text-white"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-[var(--muted)] italic">
        {CONDITION_HINTS[condition] ?? ""}
      </p>

      {/* Quick-tag notes */}
      <div>
        <div className="text-xs text-[var(--muted)] mb-1.5">Quick tags</div>
        <div className="flex flex-wrap gap-1">
          {QUICK_NOTES.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => addNote(tag)}
              className="rounded-md bg-[var(--surface-raised)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:text-white hover:bg-slate-700 transition-colors"
            >
              + {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Free-text notes */}
      <textarea
        value={notes}
        onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
        placeholder="Additional surface notes…"
        rows={2}
        className="w-full rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500 resize-none"
      />

      {/* Environmental data */}
      <div className="border-t border-[var(--border)] pt-3 space-y-3">
        <p className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Environmental</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-[var(--muted)] mb-1">Time of Day</label>
            <select
              value={timeOfDay}
              onChange={(e) => { setTimeOfDay(e.target.value); setSaved(false); }}
              className="w-full rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
            >
              <option value="night">Night</option>
              <option value="afternoon">Afternoon</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-[var(--muted)] mb-1">Temp (°F)</label>
            <input
              type="number"
              step="1"
              value={tempF}
              onChange={(e) => { setTempF(e.target.value); setSaved(false); }}
              placeholder="78"
              className="w-full rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-[10px] text-[var(--muted)] mb-1">Humidity (%)</label>
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={humidityPct}
              onChange={(e) => { setHumidityPct(e.target.value); setSaved(false); }}
              placeholder="55"
              className="w-full rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-[10px] text-[var(--muted)] mb-1">Precip last 48h (in)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={precip48h}
              onChange={(e) => { setPrecip48h(e.target.value); setSaved(false); }}
              placeholder="0.25"
              className="w-full rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
      </div>

      {/* Prep data */}
      <div className="border-t border-[var(--border)] pt-3 space-y-3">
        <p className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Track Prep</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-[var(--muted)] mb-1">Water Truck Runs</label>
            <input
              type="number"
              step="1"
              min="0"
              value={waterTruckRuns}
              onChange={(e) => { setWaterTruckRuns(e.target.value); setSaved(false); }}
              placeholder="3"
              className="w-full rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-[10px] text-[var(--muted)] mb-1">Groove Stage</label>
            <select
              value={grooveStage}
              onChange={(e) => { setGrooveStage(e.target.value); setSaved(false); }}
              className="w-full rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
            >
              {GROOVE_STAGES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {pending ? "Saving…" : saved ? "Saved ✓" : "Update Conditions"}
      </button>
    </div>
  );
}
