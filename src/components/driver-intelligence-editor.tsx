"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  upsertDriverSpecialtyAction, removeDriverSpecialtyAction,
  suggestDriverSpecialtiesAction, type AISpecialtySuggestion,
} from "@/app/actions";

type Driver = { id: number; name: string; car_number: string | null; hometown: string | null; notes: string | null };
type Track = { id: number; name: string; track_family: string | null };
type Specialty = {
  id: number; driver_id: number; track_family: string | null;
  track_id: number | null; track_name: string | null;
  bonus_score: number; notes: string | null;
};

const BONUS_PRESETS = [
  { label: "Modest edge", value: 0.05 },
  { label: "Solid specialist", value: 0.10 },
  { label: "Strong specialist", value: 0.15 },
  { label: "Dominant / hometown", value: 0.20 },
];

export function DriverIntelligenceEditor({
  driver,
  specialties: initialSpecialties,
  allTracks,
}: {
  driver: Driver;
  specialties: Specialty[];
  allTracks: Track[];
}) {
  const router = useRouter();
  const [specialties, setSpecialties] = useState(initialSpecialties);

  // Add form
  const [addFamily, setAddFamily] = useState("");
  const [addTrackId, setAddTrackId] = useState<string>("");
  const [addBonus, setAddBonus] = useState("0.10");
  const [addNotes, setAddNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  // AI suggest
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<(AISpecialtySuggestion & { accepted?: boolean; dismissed?: boolean })[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);

  async function addSpecialty() {
    const bonus = parseFloat(addBonus);
    if (!addFamily.trim() || isNaN(bonus)) return;
    setSaving(true);
    await upsertDriverSpecialtyAction({
      driver_id: driver.id,
      track_family: addFamily.trim() || null,
      track_id: addTrackId ? parseInt(addTrackId, 10) : null,
      bonus_score: bonus,
      notes: addNotes.trim() || null,
    });
    setSaving(false);
    setAddFamily("");
    setAddTrackId("");
    setAddBonus("0.10");
    setAddNotes("");
    router.refresh();
  }

  async function removeSpecialty(id: number) {
    setRemovingId(id);
    await removeDriverSpecialtyAction(id, driver.id);
    setRemovingId(null);
    setSpecialties((prev) => prev.filter((s) => s.id !== id));
    router.refresh();
  }

  async function runAISuggest() {
    setSuggesting(true);
    setSuggestions(null);
    setSuggestError(null);
    const res = await suggestDriverSpecialtiesAction(driver.id);
    setSuggesting(false);
    if (res.error) { setSuggestError(res.error); return; }
    setSuggestions(res.suggestions ?? []);
  }

  async function applySuggestion(idx: number, s: AISpecialtySuggestion) {
    setApplyingIdx(idx);
    await upsertDriverSpecialtyAction({
      driver_id: driver.id,
      track_family: s.track_family || null,
      track_id: s.track_id,
      bonus_score: s.bonus_score,
      notes: s.reasoning,
    });
    setSuggestions((prev) => prev ? prev.map((x, i) => i === idx ? { ...x, accepted: true } : x) : prev);
    setApplyingIdx(null);
    router.refresh();
  }

  const bonusColor = (b: number) =>
    b >= 0.18 ? "text-amber-400" : b >= 0.10 ? "text-green-400" : "text-[var(--muted)]";

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-500/25 bg-[var(--surface)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <span className="text-sm font-semibold text-white">Track Specialties</span>
            <span className="ml-2 text-[10px] text-[var(--muted)]">
              Manual affinity bonuses applied to the odds model
            </span>
          </div>
          <button onClick={runAISuggest} disabled={suggesting}
            className="rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs font-semibold text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50">
            {suggesting ? "Asking AI…" : "✦ AI Suggest"}
          </button>
        </div>

        {/* How it works */}
        <div className="border-t border-[var(--border)] px-5 py-2.5 bg-amber-500/5">
          <p className="text-[10px] text-[var(--muted)]">
            A specialty adds a flat bonus to the composite score when {driver.name} runs at a track matching the family or specific track ID. Use <strong className="text-amber-400">Track Family</strong> (e.g. &quot;Illinois Quarter Mile&quot;) to apply across all similar tracks, or a specific track for a pinpoint override. Bonus is added <em>before</em> Elo blending.
          </p>
        </div>

        {/* Current specialties */}
        {specialties.length > 0 ? (
          <div className="border-t border-[var(--border)]">
            {specialties.map((s) => (
              <div key={s.id} className="flex items-start gap-4 px-5 py-3 border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {s.track_family && (
                      <span className="text-sm font-medium text-amber-400">{s.track_family}</span>
                    )}
                    {s.track_name && (
                      <span className="text-[10px] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--muted)]">{s.track_name}</span>
                    )}
                    <span className={`text-sm font-bold tabular-nums ${bonusColor(s.bonus_score)}`}>
                      +{(s.bonus_score * 100).toFixed(0)} pts
                    </span>
                    <span className="text-[10px] text-[var(--muted)]">
                      ({s.bonus_score >= 0.18 ? "dominant" : s.bonus_score >= 0.10 ? "strong" : "modest"} edge)
                    </span>
                  </div>
                  {s.notes && <p className="text-xs text-[var(--muted)]">{s.notes}</p>}
                </div>
                <button onClick={() => removeSpecialty(s.id)} disabled={removingId === s.id}
                  className="text-[10px] text-[var(--muted)] hover:text-red-400 transition-colors shrink-0">
                  {removingId === s.id ? "…" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="border-t border-[var(--border)] px-5 py-4 text-xs text-[var(--muted)]">
            No specialties set. Add one below or use AI Suggest.
          </div>
        )}

        {/* Add form */}
        <div className="border-t border-[var(--border)] px-5 py-4 space-y-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Add Specialty</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 col-span-2">
              <span className="text-[10px] text-[var(--muted)]">Track Family <span className="text-[var(--muted)]">(used for group matching)</span></span>
              <input
                value={addFamily} onChange={(e) => setAddFamily(e.target.value)}
                placeholder="e.g. Illinois Quarter Mile, WV Half Mile"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-[var(--muted)]">Specific Track <span className="text-[var(--muted)]">(optional override)</span></span>
              <select value={addTrackId} onChange={(e) => setAddTrackId(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none">
                <option value="">— any track in family —</option>
                {allTracks.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-[var(--muted)]">Bonus (0.05–0.25)</span>
              <div className="space-y-1">
                <input
                  type="number" min="0.05" max="0.25" step="0.01"
                  value={addBonus} onChange={(e) => setAddBonus(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white tabular-nums focus:border-amber-400 focus:outline-none"
                />
                <div className="flex gap-1 flex-wrap">
                  {BONUS_PRESETS.map((p) => (
                    <button key={p.value} onClick={() => setAddBonus(p.value.toFixed(2))}
                      className={`rounded px-2 py-0.5 text-[9px] font-medium transition-colors border ${parseFloat(addBonus) === p.value ? "border-amber-400 text-amber-400" : "border-[var(--border)] text-[var(--muted)] hover:text-white"}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </label>
            <label className="space-y-1 col-span-2">
              <span className="text-[10px] text-[var(--muted)]">Notes (optional)</span>
              <input value={addNotes} onChange={(e) => setAddNotes(e.target.value)} placeholder="Why this driver excels here"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none" />
            </label>
          </div>
          <button onClick={addSpecialty} disabled={saving || !addFamily.trim()}
            className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-bold text-black disabled:opacity-40 hover:bg-amber-400 transition-colors">
            {saving ? "Saving…" : "Add Specialty"}
          </button>
        </div>
      </div>

      {/* ── AI Suggestions ────────────────────────────────────────────────────── */}
      {suggestError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">{suggestError}</div>
      )}

      {suggestions && (
        <div className="rounded-2xl border border-blue-500/25 bg-[var(--surface)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <p className="text-sm font-semibold text-white">✦ AI Specialty Suggestions for {driver.name}</p>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">Based on known career history. Review before applying.</p>
          </div>
          {suggestions.length === 0 ? (
            <div className="px-5 py-4 text-xs text-[var(--muted)]">No strong specialties identified for this driver.</div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {suggestions.map((s, i) => (
                <div key={i} className={`flex items-start gap-4 px-5 py-3.5 ${s.accepted ? "opacity-50" : s.dismissed ? "hidden" : ""}`}>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-amber-400">{s.track_family}</span>
                      {s.track_id && (
                        <span className="text-[10px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
                          {allTracks.find((t) => t.id === s.track_id)?.name ?? `Track ${s.track_id}`}
                        </span>
                      )}
                      <span className={`text-sm font-bold tabular-nums ${bonusColor(s.bonus_score)}`}>
                        +{(s.bonus_score * 100).toFixed(0)} pts
                      </span>
                    </div>
                    <p className="text-xs text-[var(--muted)]">{s.reasoning}</p>
                  </div>
                  {s.accepted ? (
                    <span className="text-xs text-green-400 shrink-0">Applied ✓</span>
                  ) : (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => applySuggestion(i, s)} disabled={applyingIdx === i}
                        className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50 transition-colors">
                        {applyingIdx === i ? "…" : "Apply"}
                      </button>
                      <button onClick={() => setSuggestions((prev) => prev ? prev.map((x, xi) => xi === i ? { ...x, dismissed: true } : x) : prev)}
                        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] hover:text-white transition-colors">
                        Skip
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
