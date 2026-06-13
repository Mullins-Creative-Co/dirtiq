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

export function LiveConditionsForm({
  raceId,
  currentCondition,
  currentNotes,
}: {
  raceId: number;
  currentCondition: string;
  currentNotes: string | null;
}) {
  const [condition, setCondition] = useState(currentCondition);
  const [notes, setNotes] = useState(currentNotes ?? "");
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
      const res = await updateConditionsAction({ race_id: raceId, track_condition: condition, weather_notes: notes });
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

      {/* Hint for selected condition */}
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
        placeholder="84°F, 40% humidity, clear — 2 grooves, dusty…"
        rows={2}
        className="w-full rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500 resize-none"
      />

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
