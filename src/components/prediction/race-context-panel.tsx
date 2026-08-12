"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createRaceContextAdjustmentAction,
  resolveRaceContextAdjustmentAction,
} from "@/app/actions";
import type { RaceContextAdjustment } from "@/lib/race-context-adjustments";

type DriverOption = {
  id: number;
  name: string;
};

type Preset = {
  label: string;
  contextType: string;
  scoreDelta: number;
  driverRequired: boolean;
};

const presets: Preset[] = [
  { label: "Driving style fit", contextType: "driving_style", scoreDelta: 0.035, driverRequired: true },
  { label: "Prior series here", contextType: "prior_series_track", scoreDelta: 0.03, driverRequired: true },
  { label: "Local/non-series history", contextType: "local_history", scoreDelta: 0.04, driverRequired: true },
  { label: "Track style concern", contextType: "style_concern", scoreDelta: -0.03, driverRequired: true },
  { label: "Field strength", contextType: "field_strength", scoreDelta: 0, driverRequired: false },
];

const weightScale = [
  { value: -0.1, label: "Major downgrade", note: "bad fit or strong negative evidence" },
  { value: -0.05, label: "Clear concern", note: "meaningful drawback" },
  { value: -0.02, label: "Small concern", note: "minor watch item" },
  { value: 0, label: "Note only", note: "no model movement" },
  { value: 0.02, label: "Small boost", note: "useful supporting signal" },
  { value: 0.05, label: "Strong boost", note: "clear edge with evidence" },
  { value: 0.1, label: "Major boost", note: "rare, dominant track/style edge" },
];

function deltaLabel(value: number) {
  if (value === 0) return "note";
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
}

function deltaClass(value: number) {
  if (value > 0) return "text-green-300";
  if (value < 0) return "text-red-300";
  return "text-slate-400";
}

export function RaceContextPanel({
  raceId,
  drivers,
  adjustments,
}: {
  raceId: number;
  drivers: DriverOption[];
  adjustments: RaceContextAdjustment[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [presetLabel, setPresetLabel] = useState(presets[0].label);
  const [driverId, setDriverId] = useState("");
  const [label, setLabel] = useState("");
  const [scoreDelta, setScoreDelta] = useState(presets[0].scoreDelta.toString());
  const [note, setNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.label === presetLabel) ?? presets[0],
    [presetLabel]
  );

  function choosePreset(value: string) {
    const nextPreset = presets.find((preset) => preset.label === value) ?? presets[0];
    setPresetLabel(nextPreset.label);
    setScoreDelta(nextPreset.scoreDelta.toString());
    setLabel(nextPreset.label);
    if (!nextPreset.driverRequired) setDriverId("");
  }

  function save() {
    const parsedDelta = Number(scoreDelta);
    setStatus("Saving race context...");

    startTransition(async () => {
      const result = await createRaceContextAdjustmentAction({
        raceId,
        driverId: driverId ? Number(driverId) : null,
        contextType: selectedPreset.contextType,
        label: label || selectedPreset.label,
        scoreDelta: Number.isFinite(parsedDelta) ? parsedDelta : selectedPreset.scoreDelta,
        note,
        sourceUrl,
      });

      if (result.error) {
        setStatus(result.error);
        return;
      }

      setLabel(selectedPreset.label);
      setNote("");
      setSourceUrl("");
      setStatus("Race context saved. Publish odds again to move market lines.");
      router.refresh();
    });
  }

  function archive(adjustmentId: number) {
    setArchivingId(adjustmentId);
    startTransition(async () => {
      const result = await resolveRaceContextAdjustmentAction(raceId, adjustmentId);
      setArchivingId(null);
      if (result.error) {
        setStatus(result.error);
        return;
      }
      setStatus("Race context archived. Publish odds again to refresh lines.");
      router.refresh();
    });
  }

  const saveDisabled =
    !label.trim() ||
    (selectedPreset.driverRequired && !driverId) ||
    !Number.isFinite(Number(scoreDelta));

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white">Race Context</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Add structured race-specific factors like field strength, driving-style fit, and prior series history at this track.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
          {adjustments.length} active
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[170px_190px_1fr_110px]">
        <select
          value={presetLabel}
          onChange={(event) => choosePreset(event.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-white outline-none focus:border-[var(--accent)]"
        >
          {presets.map((preset) => (
            <option key={preset.label} value={preset.label}>
              {preset.label}
            </option>
          ))}
        </select>
        <select
          value={driverId}
          onChange={(event) => setDriverId(event.target.value)}
          disabled={!selectedPreset.driverRequired}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-white outline-none focus:border-[var(--accent)] disabled:opacity-50"
        >
          <option value="">Race-wide</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.name}
            </option>
          ))}
        </select>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Example: WoO Smoky pace carries over"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-[var(--accent)]"
        />
        <input
          value={scoreDelta}
          onChange={(event) => setScoreDelta(event.target.value)}
          inputMode="decimal"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-right font-mono text-xs text-white outline-none focus:border-[var(--accent)]"
          aria-label="Score delta"
        />
      </div>

      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Score delta guide</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Normal manual underwriting is usually ±0.02 to ±0.05. Use ±0.10 only for a rare, evidence-backed track/style edge.
            </p>
          </div>
          <span className="font-mono text-[10px] text-slate-400">0.035 = 3.5 score points</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {weightScale.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setScoreDelta(item.value.toString())}
              className="rounded-lg border border-[var(--border)] px-2 py-2 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)]/10"
            >
              <span className={`block font-mono text-xs font-bold ${deltaClass(item.value)}`}>
                {deltaLabel(item.value)}
              </span>
              <span className="mt-1 block text-[10px] font-semibold text-white">{item.label}</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-[var(--muted)]">{item.note}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_260px_auto]">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why this factor matters"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-[var(--accent)]"
        />
        <input
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="Source URL"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={save}
          disabled={saveDisabled}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add Context
        </button>
      </div>

      {status ? <p className="mt-3 text-xs font-semibold text-amber-300">{status}</p> : null}

      {adjustments.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {adjustments.map((adjustment) => (
            <div
              key={adjustment.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-300">
                    {adjustment.context_type.replaceAll("_", " ")}
                  </span>
                  <span className="text-xs font-semibold text-white">
                    {adjustment.driver_name ?? "Race-wide"}
                  </span>
                  <span className={`font-mono text-[10px] ${deltaClass(adjustment.score_delta)}`}>
                    {deltaLabel(adjustment.score_delta)}
                  </span>
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-300">{adjustment.label}</p>
                {adjustment.note ? (
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{adjustment.note}</p>
                ) : null}
                {adjustment.source_url ? (
                  <a
                    href={adjustment.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block text-[10px] text-[var(--accent)] hover:underline"
                  >
                    Source
                  </a>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => archive(adjustment.id)}
                disabled={archivingId === adjustment.id}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] hover:text-white disabled:opacity-50"
              >
                {archivingId === adjustment.id ? "Archiving..." : "Archive"}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
