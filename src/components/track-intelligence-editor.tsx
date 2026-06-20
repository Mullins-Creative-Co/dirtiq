"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateTrackAction, upsertTrackSimilarAction, removeTrackSimilarAction,
  suggestTrackSimilarsAction, createTrackDriverTrendAction, resolveTrackDriverTrendAction,
  type AISimilaritySuggestion,
} from "@/app/actions";

type Track = {
  id: number; name: string; location: string | null; surface_type: string;
  track_length: number | null; banking_angle?: number | null; clay_type?: string | null;
  avg_caution_rate?: number | null; track_family: string | null; notes: string | null;
};
type Similar = { id: number; track_id: number; similar_track_id: number; similar_name: string; similarity_weight: number; notes: string | null };
type Driver = { id: number; name: string; car_number: string | null; hometown: string | null };
type TrackTrend = {
  id: number;
  track_id: number;
  driver_id: number | null;
  driver_name: string | null;
  trend_type: string;
  label: string;
  score_delta: number;
  note: string | null;
  source_url: string | null;
  active: number;
};

const SURFACE_TYPES = ["Clay", "Dirt", "Asphalt", "Concrete"];

export function TrackIntelligenceEditor({
  track,
  similars: initialSimilars,
  allTracks,
  allDrivers,
  trackTrends: initialTrackTrends,
}: {
  track: Track;
  similars: Similar[];
  allTracks: Track[];
  allDrivers: Driver[];
  trackTrends: TrackTrend[];
}) {
  const router = useRouter();

  // Track info state
  const [infoOpen, setInfoOpen] = useState(false);
  const [name, setName] = useState(track.name);
  const [location, setLocation] = useState(track.location ?? "");
  const [surfaceType, setSurfaceType] = useState(track.surface_type);
  const [trackLength, setTrackLength] = useState(track.track_length?.toString() ?? "");
  const [bankingAngle, setBankingAngle] = useState(track.banking_angle?.toString() ?? "");
  const [clayType, setClayType] = useState(track.clay_type ?? "");
  const [avgCautionRate, setAvgCautionRate] = useState(track.avg_caution_rate?.toString() ?? "");
  const [trackFamily, setTrackFamily] = useState(track.track_family ?? "");
  const [notes, setNotes] = useState(track.notes ?? "");
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoSaved, setInfoSaved] = useState(false);

  // Similarity state
  const [similars, setSimilars] = useState(initialSimilars);
  const [addTrackId, setAddTrackId] = useState<string>("");
  const [addWeight, setAddWeight] = useState("0.70");
  const [addNotes, setAddNotes] = useState("");
  const [savingSim, setSavingSim] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  // Inline weight edit
  const [editingWeight, setEditingWeight] = useState<Record<number, string>>({});

  // AI suggest state
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<(AISimilaritySuggestion & { accepted?: boolean; dismissed?: boolean })[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);

  // Durable track trend state
  const [trackTrends, setTrackTrends] = useState(initialTrackTrends);
  const [trendDriverId, setTrendDriverId] = useState("");
  const [trendType, setTrendType] = useState("track_history");
  const [trendLabel, setTrendLabel] = useState("");
  const [trendDelta, setTrendDelta] = useState("0.025");
  const [trendNote, setTrendNote] = useState("");
  const [trendSourceUrl, setTrendSourceUrl] = useState("");
  const [savingTrend, setSavingTrend] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [removingTrendId, setRemovingTrendId] = useState<number | null>(null);

  async function saveInfo() {
    setSavingInfo(true);
    setInfoSaved(false);
    await updateTrackAction(track.id, {
      name,
      location: location || null,
      surface_type: surfaceType,
      track_length: trackLength ? parseFloat(trackLength) : null,
      banking_angle: bankingAngle ? parseFloat(bankingAngle) : null,
      clay_type: clayType || null,
      avg_caution_rate: avgCautionRate ? parseFloat(avgCautionRate) : null,
      track_family: trackFamily || null,
      notes: notes || null,
    });
    setSavingInfo(false);
    setInfoSaved(true);
    router.refresh();
  }

  async function addSimilarity() {
    const tid = parseInt(addTrackId, 10);
    const w = parseFloat(addWeight);
    if (isNaN(tid) || isNaN(w)) return;
    setSavingSim(true);
    await upsertTrackSimilarAction(track.id, tid, w, addNotes || undefined);
    setSavingSim(false);
    setAddTrackId("");
    setAddWeight("0.70");
    setAddNotes("");
    router.refresh();
  }

  async function updateWeight(similarTrackId: number, weightStr: string) {
    const w = parseFloat(weightStr);
    if (isNaN(w) || w < 0 || w > 1) return;
    await upsertTrackSimilarAction(track.id, similarTrackId, w);
    setEditingWeight((prev) => { const n = { ...prev }; delete n[similarTrackId]; return n; });
    router.refresh();
  }

  async function removeSim(similarTrackId: number) {
    setRemovingId(similarTrackId);
    await removeTrackSimilarAction(track.id, similarTrackId);
    setRemovingId(null);
    setSimilars((prev) => prev.filter((s) => s.similar_track_id !== similarTrackId));
    router.refresh();
  }

  async function runAISuggest() {
    setSuggesting(true);
    setSuggestions(null);
    setSuggestError(null);
    const res = await suggestTrackSimilarsAction(track.id);
    setSuggesting(false);
    if (res.error) { setSuggestError(res.error); return; }
    setSuggestions((res.suggestions ?? []).filter((s) => s.weight > 0.05));
  }

  async function applySuggestion(idx: number, s: AISimilaritySuggestion) {
    setApplyingIdx(idx);
    await upsertTrackSimilarAction(track.id, s.track_id, s.weight);
    setSuggestions((prev) => prev ? prev.map((x, i) => i === idx ? { ...x, accepted: true } : x) : prev);
    setApplyingIdx(null);
    router.refresh();
  }

  async function addTrend() {
    const scoreDelta = parseFloat(trendDelta);
    if (!trendLabel.trim() || !Number.isFinite(scoreDelta)) return;

    setSavingTrend(true);
    setTrendError(null);
    const result = await createTrackDriverTrendAction({
      track_id: track.id,
      driver_id: trendDriverId ? parseInt(trendDriverId, 10) : null,
      trend_type: trendType,
      label: trendLabel,
      score_delta: scoreDelta,
      note: trendNote || null,
      source_url: trendSourceUrl || null,
    });
    setSavingTrend(false);

    if (result.error) {
      setTrendError(result.error);
      return;
    }

    setTrendDriverId("");
    setTrendType("track_history");
    setTrendLabel("");
    setTrendDelta("0.025");
    setTrendNote("");
    setTrendSourceUrl("");
    router.refresh();
  }

  async function removeTrend(trendId: number) {
    setRemovingTrendId(trendId);
    const result = await resolveTrackDriverTrendAction(trendId, track.id);
    setRemovingTrendId(null);
    if (result.error) {
      setTrendError(result.error);
      return;
    }
    setTrackTrends((prev) => prev.filter((trend) => trend.id !== trendId));
    router.refresh();
  }

  const weightColor = (w: number) =>
    w >= 0.75 ? "text-green-400" : w >= 0.45 ? "text-amber-400" : "text-[var(--muted)]";

  const existingIds = new Set(similars.map((s) => s.similar_track_id));

  return (
    <div className="space-y-5">

      {/* ── Track Info ────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <button
          onClick={() => setInfoOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--surface-raised)] transition-colors"
        >
          <span className="text-sm font-semibold text-white">Track Details</span>
          <span className="text-xs text-[var(--muted)]">{infoOpen ? "▲ Hide" : "▼ Edit"}</span>
        </button>

        {infoOpen && (
          <div className="border-t border-[var(--border)] px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 col-span-2">
                <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Location</span>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, ST"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Surface</span>
                <select value={surfaceType} onChange={(e) => setSurfaceType(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
                  {SURFACE_TYPES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Length (mi)</span>
                <input type="number" step="0.125" min="0.1" max="2" value={trackLength} onChange={(e) => setTrackLength(e.target.value)} placeholder="e.g. 0.375"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white tabular-nums focus:border-[var(--accent)] focus:outline-none" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Banking angle</span>
                <input type="number" step="1" min="0" max="40" value={bankingAngle} onChange={(e) => setBankingAngle(e.target.value)} placeholder="e.g. 22"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white tabular-nums focus:border-[var(--accent)] focus:outline-none" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Clay / surface style</span>
                <input value={clayType} onChange={(e) => setClayType(e.target.value)} placeholder="e.g. red clay, abrasive"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Avg cautions</span>
                <input type="number" step="0.1" min="0" value={avgCautionRate} onChange={(e) => setAvgCautionRate(e.target.value)} placeholder="e.g. 4.5"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white tabular-nums focus:border-[var(--accent)] focus:outline-none" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Track Family</span>
                <input value={trackFamily} onChange={(e) => setTrackFamily(e.target.value)} placeholder="e.g. High-banked Southeast 4/10"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none" />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Notes</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Banking style, typical conditions, etc."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none resize-none" />
              </label>
            </div>
            <div className="text-[10px] text-[var(--muted)]">
              <strong className="text-amber-400">Track Family</strong> groups this track with others of the same style for driver specialty matching. Use a consistent name across similar tracks such as Illinois Quarter Mile for Fairbury, Farmer City, and Gateway.
            </div>
            <button onClick={saveInfo} disabled={savingInfo}
              className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-black disabled:opacity-50 hover:opacity-90 transition-opacity">
              {savingInfo ? "Saving…" : infoSaved ? "Saved ✓" : "Save Track Details"}
            </button>
          </div>
        )}
      </div>

      {/* ── Similarity Matrix ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <span className="text-sm font-semibold text-white">Track Similarities</span>
            <span className="ml-2 text-[10px] text-[var(--muted)]">{similars.length} linked tracks · bidirectional</span>
          </div>
          <button onClick={runAISuggest} disabled={suggesting}
            className="rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs font-semibold text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50">
            {suggesting ? "Asking AI…" : "✦ AI Suggest Weights"}
          </button>
        </div>

        {/* Current similars */}
        {similars.length > 0 && (
          <div className="border-t border-[var(--border)]">
            {similars.map((s) => {
              const isEditing = editingWeight[s.similar_track_id] !== undefined;
              return (
                <div key={s.similar_track_id} className="flex items-center gap-3 px-5 py-2.5 border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-white truncate">{s.similar_name}</span>
                  </div>
                  {isEditing ? (
                    <input
                      type="number" min="0" max="1" step="0.05"
                      value={editingWeight[s.similar_track_id]}
                      onChange={(e) => setEditingWeight((p) => ({ ...p, [s.similar_track_id]: e.target.value }))}
                      onBlur={() => updateWeight(s.similar_track_id, editingWeight[s.similar_track_id])}
                      onKeyDown={(e) => e.key === "Enter" && updateWeight(s.similar_track_id, editingWeight[s.similar_track_id])}
                      autoFocus
                      className="w-20 rounded border border-[var(--accent)] bg-[var(--surface-raised)] px-2 py-1 text-xs text-white text-center tabular-nums focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => setEditingWeight((p) => ({ ...p, [s.similar_track_id]: s.similarity_weight.toFixed(2) }))}
                      className={`text-sm font-bold tabular-nums ${weightColor(s.similarity_weight)} hover:text-white transition-colors`}
                      title="Click to edit weight"
                    >
                      {s.similarity_weight.toFixed(2)}
                    </button>
                  )}
                  <div className="w-20 bg-[var(--border)] rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${s.similarity_weight * 100}%` }} />
                  </div>
                  <button
                    onClick={() => removeSim(s.similar_track_id)}
                    disabled={removingId === s.similar_track_id}
                    className="text-[10px] text-[var(--muted)] hover:text-red-400 transition-colors"
                  >
                    {removingId === s.similar_track_id ? "…" : "✕"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add new */}
        <div className="border-t border-[var(--border)] px-5 py-3 flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-32 space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Add Track</span>
            <select value={addTrackId} onChange={(e) => setAddTrackId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
              <option value="">— select track —</option>
              {allTracks.filter((t) => !existingIds.has(t.id)).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="w-24 space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Weight</span>
            <input type="number" min="0" max="1" step="0.05" value={addWeight} onChange={(e) => setAddWeight(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white tabular-nums focus:border-[var(--accent)] focus:outline-none" />
          </div>
          <button onClick={addSimilarity} disabled={savingSim || !addTrackId}
            className="rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-4 py-2 text-sm font-semibold text-white hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-40 mb-0">
            {savingSim ? "…" : "Add"}
          </button>
        </div>

        {/* Weight scale legend */}
        <div className="border-t border-[var(--border)] px-5 py-2.5 flex gap-4 text-[10px] text-[var(--muted)]">
          <span><span className="text-green-400 font-semibold">0.75+</span> Very similar</span>
          <span><span className="text-amber-400 font-semibold">0.45–0.74</span> Moderately similar</span>
          <span><span className="text-[var(--muted)] font-semibold">&lt;0.45</span> Loosely similar</span>
        </div>
      </div>

      {/* -- Durable Track Trends ------------------------------------------------ */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-sm font-semibold text-white">Driver / Track Trends</span>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                Reusable model nudges for this track. These apply automatically to future races here.
              </p>
            </div>
            <span className="text-[10px] text-[var(--muted)]">{trackTrends.length} active</span>
          </div>
        </div>

        {trackTrends.length > 0 && (
          <div className="divide-y divide-[var(--border)]">
            {trackTrends.map((trend) => (
              <div key={trend.id} className="grid gap-3 px-5 py-3 sm:grid-cols-[1.1fr_0.7fr_0.35fr_auto] sm:items-center hover:bg-[var(--surface-raised)] transition-colors">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">{trend.label}</span>
                    <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                      {trend.trend_type.replaceAll("_", " ")}
                    </span>
                  </div>
                  {trend.note && <p className="mt-1 text-xs text-[var(--muted)]">{trend.note}</p>}
                  {trend.source_url && (
                    <a href={trend.source_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[10px] text-blue-400 hover:text-blue-300">
                      Source
                    </a>
                  )}
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {trend.driver_name ?? "Track-wide"}
                </div>
                <div className={`text-sm font-bold tabular-nums ${trend.score_delta >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {trend.score_delta > 0 ? "+" : ""}{trend.score_delta.toFixed(3)}
                </div>
                <button
                  onClick={() => removeTrend(trend.id)}
                  disabled={removingTrendId === trend.id}
                  className="justify-self-start rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] hover:border-red-400/50 hover:text-red-400 disabled:opacity-50 transition-colors"
                >
                  {removingTrendId === trend.id ? "…" : "Resolve"}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-[var(--border)] px-5 py-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_0.45fr]">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Target</span>
              <select value={trendDriverId} onChange={(e) => setTrendDriverId(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
                <option value="">Track-wide trend</option>
                {allDrivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}{driver.car_number ? ` #${driver.car_number}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Trend type</span>
              <select value={trendType} onChange={(e) => setTrendType(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
                <option value="track_history">Track history</option>
                <option value="regional_fit">Regional fit</option>
                <option value="similar_track">Similar-track trend</option>
                <option value="driving_style">Driving style</option>
                <option value="field_strength">Field strength</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Score delta</span>
              <input type="number" step="0.005" min="-0.2" max="0.2" value={trendDelta} onChange={(e) => setTrendDelta(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white tabular-nums focus:border-[var(--accent)] focus:outline-none" />
            </label>
          </div>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Label</span>
            <input value={trendLabel} onChange={(e) => setTrendLabel(e.target.value)} placeholder="e.g. Smoky and Southeast elite fit"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none" />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Note</span>
              <textarea value={trendNote} onChange={(e) => setTrendNote(e.target.value)} rows={2} placeholder="What should underwriting remember next time?"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none resize-none" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Source URL</span>
              <input value={trendSourceUrl} onChange={(e) => setTrendSourceUrl(e.target.value)} placeholder="https://..."
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none" />
            </label>
          </div>
          {trendError && <p className="text-xs text-red-400">{trendError}</p>}
          <button onClick={addTrend} disabled={savingTrend || !trendLabel.trim()}
            className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-black disabled:opacity-50 hover:opacity-90 transition-opacity">
            {savingTrend ? "Saving…" : "Add Trend"}
          </button>
        </div>
      </div>

      {/* ── AI Suggestions ───────────────────────────────────────────────────── */}
      {suggestError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">{suggestError}</div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="rounded-2xl border border-blue-500/25 bg-[var(--surface)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <p className="text-sm font-semibold text-white">✦ AI Similarity Suggestions</p>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">Review and apply. Applying a weight updates the similarity table immediately.</p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {suggestions.map((s, i) => (
              <div key={s.track_id} className={`flex items-start gap-4 px-5 py-3.5 ${s.accepted ? "opacity-50" : s.dismissed ? "hidden" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{s.track_name}</span>
                    <span className={`text-sm font-bold tabular-nums ${weightColor(s.weight)}`}>{s.weight.toFixed(2)}</span>
                    {existingIds.has(s.track_id) && (
                      <span className="text-[10px] text-amber-400 border border-amber-400/30 rounded px-1.5 py-0.5">already linked</span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-0.5">{s.reasoning}</p>
                </div>
                {s.accepted ? (
                  <span className="text-xs text-green-400 shrink-0">Applied ✓</span>
                ) : (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => applySuggestion(i, s)} disabled={applyingIdx === i}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
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
        </div>
      )}
    </div>
  );
}
