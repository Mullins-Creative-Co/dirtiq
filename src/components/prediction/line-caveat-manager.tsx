"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createLineCaveatAction, resolveLineCaveatAction } from "@/app/actions";
import type { LineCaveat, LineCaveatSeverity } from "@/lib/line-caveats";

type DriverOption = {
  id: number;
  name: string;
};

type Preset = {
  label: string;
  caveatType: string;
  severity: LineCaveatSeverity;
  multiplier: number;
};

const presets: Preset[] = [
  { label: "Not confirmed", caveatType: "entry_not_confirmed", severity: "caution", multiplier: 0.55 },
  { label: "Schedule conflict", caveatType: "schedule_conflict", severity: "hold", multiplier: 0.35 },
  { label: "Hold line", caveatType: "line_hold", severity: "hold", multiplier: 0.2 },
  { label: "Scratch", caveatType: "scratch", severity: "scratch", multiplier: 0.02 },
  { label: "Race note", caveatType: "race_note", severity: "watch", multiplier: 1 },
];

const multiplierScale = [
  { value: "x1.00", label: "Note only", note: "no probability change" },
  { value: "x0.75", label: "Light caution", note: "small uncertainty haircut" },
  { value: "x0.55", label: "Not confirmed", note: "roughly halves the driver" },
  { value: "x0.35", label: "Schedule conflict", note: "strong attendance doubt" },
  { value: "x0.20", label: "Hold line", note: "keep visible but mostly suppressed" },
  { value: "x0.02", label: "Scratch", note: "effectively removes from pricing" },
];

function severityClass(severity: LineCaveatSeverity) {
  if (severity === "scratch") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (severity === "hold") return "border-orange-500/30 bg-orange-500/10 text-orange-300";
  if (severity === "caution") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-blue-500/30 bg-blue-500/10 text-blue-300";
}

function defaultNoteFor(driverName: string, preset: Preset) {
  if (preset.caveatType === "entry_not_confirmed") return `${driverName} entry is not confirmed yet; hold back model confidence until field/source confirms.`;
  if (preset.caveatType === "schedule_conflict") return `${driverName} has a possible schedule conflict; discount until attendance is confirmed.`;
  if (preset.caveatType === "line_hold") return `${driverName} line should stay suppressed until race-night data or manual review clears it.`;
  if (preset.caveatType === "scratch") return `${driverName} is scratched or effectively not bettable for this race.`;
  return `${driverName} race note for model/pricing review.`;
}

export function LineCaveatManager({
  raceId,
  drivers,
  caveats,
}: {
  raceId: number;
  drivers: DriverOption[];
  caveats: LineCaveat[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [driverId, setDriverId] = useState("");
  const [presetLabel, setPresetLabel] = useState(presets[0].label);
  const [note, setNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.label === presetLabel) ?? presets[0],
    [presetLabel]
  );
  const selectedDriverId = driverId ? Number(driverId) : null;
  const duplicateCaveats = useMemo(
    () =>
      caveats.filter(
        (caveat) =>
          (caveat.driver_id ?? null) === selectedDriverId &&
          caveat.caveat_type === selectedPreset.caveatType
      ),
    [caveats, selectedDriverId, selectedPreset.caveatType]
  );
  const sameDriverCaveats = useMemo(
    () => caveats.filter((caveat) => (caveat.driver_id ?? null) === selectedDriverId),
    [caveats, selectedDriverId]
  );
  const selectedDriverName =
    selectedDriverId === null
      ? "Race-wide"
      : drivers.find((driver) => driver.id === selectedDriverId)?.name ?? "Selected driver";

  function submit() {
    setStatus("Saving caveat...");
    const resolvedNote = note.trim() || defaultNoteFor(selectedDriverName, selectedPreset);
    startTransition(async () => {
      const result = await createLineCaveatAction({
        raceId,
        driverId: driverId ? Number(driverId) : null,
        caveatType: selectedPreset.caveatType,
        severity: selectedPreset.severity,
        probabilityMultiplier: selectedPreset.multiplier,
        note: resolvedNote,
        sourceUrl,
      });

      if (result.error) {
        setStatus(result.error);
        return;
      }

      setNote("");
      setSourceUrl("");
      setStatus("Caveat saved and published to the model-backed betting views.");
      router.refresh();
    });
  }

  function resolve(caveatId: number) {
    startTransition(async () => {
      const result = await resolveLineCaveatAction(raceId, caveatId);
      if (result.error) {
        setStatus(result.error);
        return;
      }

      setStatus("Caveat resolved and betting views refreshed.");
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white">Live Caveats</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Add entry, schedule, weather, or scratch warnings before writing lines.
            Driver caveats adjust model probability immediately.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
          {caveats.length} active
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setPresetLabel(preset.label)}
            className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
              preset.label === presetLabel
                ? "border-[var(--accent)] bg-[var(--accent)] text-black"
                : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)] hover:text-white"
            }`}
          >
            {preset.label} x{preset.multiplier}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[220px_1fr_220px_auto]">
        <select
          value={driverId}
          onChange={(event) => setDriverId(event.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-white outline-none focus:border-[var(--accent)]"
        >
          <option value="">Race-wide</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>{driver.name}</option>
          ))}
        </select>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={defaultNoteFor(selectedDriverName, selectedPreset)}
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
          onClick={submit}
          disabled={isPending}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save
        </button>
      </div>

      {duplicateCaveats.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-bold text-amber-200">
            Possible duplicate: {selectedDriverName} already has an active {selectedPreset.label.toLowerCase()} caveat.
          </p>
          <div className="mt-2 grid gap-2">
            {duplicateCaveats.map((caveat) => (
              <div key={caveat.id} className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs leading-5 text-amber-100/80">
                  x{caveat.probability_multiplier} · {caveat.note}
                </p>
                <button
                  type="button"
                  onClick={() => resolve(caveat.id)}
                  disabled={isPending}
                  className="rounded-lg border border-amber-200/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-100 hover:bg-amber-200/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Resolve duplicate
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-amber-100/70">
            Resolve the active duplicate, then save the new caveat.
          </p>
        </div>
      ) : sameDriverCaveats.length > 0 ? (
        <div className="mt-3 rounded-xl border border-blue-500/25 bg-blue-500/10 p-3">
          <p className="text-xs font-bold text-blue-200">
            Existing caveats for {selectedDriverName}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {sameDriverCaveats.map((caveat) => (
              <span
                key={caveat.id}
                className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${severityClass(caveat.severity)}`}
              >
                {caveat.caveat_type.replaceAll("_", " ")} x{caveat.probability_multiplier}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Caveat multiplier guide</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Multipliers shrink a driver&apos;s probability. Example: x0.55 means keep 55% of the model probability; x0.02 is essentially scratched.
            </p>
          </div>
          <span className="font-mono text-[10px] text-slate-400">lower number = bigger haircut</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          {multiplierScale.map((item) => (
            <div key={item.value} className="rounded-lg border border-[var(--border)] px-2 py-2">
              <span className="block font-mono text-xs font-bold text-amber-300">{item.value}</span>
              <span className="mt-1 block text-[10px] font-semibold text-white">{item.label}</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-[var(--muted)]">{item.note}</span>
            </div>
          ))}
        </div>
      </div>

      {status ? <p className="mt-3 text-xs font-semibold text-amber-300">{status}</p> : null}

      {caveats.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {caveats.map((caveat) => (
            <div
              key={caveat.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${severityClass(caveat.severity)}`}>
                    {caveat.severity}
                  </span>
                  <span className="text-xs font-semibold text-white">
                    {caveat.driver_name ?? "Race-wide"}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--muted)]">
                    x{caveat.probability_multiplier}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{caveat.note}</p>
                {caveat.source_url ? (
                  <a
                    href={caveat.source_url}
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
                onClick={() => resolve(caveat.id)}
                disabled={isPending}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Resolve
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
