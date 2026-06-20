"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createUnderwritingNoteAction, resolveUnderwritingNoteAction } from "@/app/actions";
import type { UnderwritingNote } from "@/lib/underwriting-notes";

type DriverOption = {
  id: number;
  name: string;
};

type Scope = "race" | "track" | "driver";

export function UnderwritingNotesPanel({
  raceId,
  trackId,
  drivers,
  notes,
}: {
  raceId: number;
  trackId: number;
  drivers: DriverOption[];
  notes: UnderwritingNote[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [scope, setScope] = useState<Scope>("race");
  const [driverId, setDriverId] = useState("");
  const [noteType, setNoteType] = useState("underwriting");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archivingId, setArchivingId] = useState<number | null>(null);

  function save() {
    setError(null);
    setSaving(true);

    startTransition(async () => {
      const result = await createUnderwritingNoteAction({
        raceId,
        trackId,
        driverId: scope === "driver" && driverId ? Number(driverId) : null,
        scope,
        noteType,
        title,
        note,
        sourceUrl,
      });

      setSaving(false);
      if (result.error) {
        setError(result.error);
        return;
      }

      setTitle("");
      setNote("");
      setSourceUrl("");
      router.refresh();
    });
  }

  function archive(noteId: number) {
    setArchivingId(noteId);

    startTransition(async () => {
      const result = await resolveUnderwritingNoteAction(raceId, trackId, noteId);
      setArchivingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function noteScopeLabel(item: UnderwritingNote) {
    if (item.driver_name) return `Driver: ${item.driver_name}`;
    if (item.track_id && !item.race_id) return "Track carry-forward";
    return "Race note";
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-base font-bold text-white">Underwriting Notes</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Save the why behind a line, including track history, driver availability, and manual adjustments.
        </p>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-1">
            {(["race", "track", "driver"] as Scope[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition-colors ${
                  scope === value
                    ? "bg-[var(--accent)] text-black"
                    : "text-[var(--muted)] hover:text-white"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          {scope === "driver" ? (
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Driver</span>
              <select
                value={driverId}
                onChange={(event) => setDriverId(event.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
              >
                <option value="">Choose driver</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Type</span>
            <select
              value={noteType}
              onChange={(event) => setNoteType(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
            >
              <option value="underwriting">Underwriting</option>
              <option value="data_gap">Data gap</option>
              <option value="track_profile">Track profile</option>
              <option value="model_override">Model override</option>
              <option value="entry_watch">Entry watch</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Overton track history needs weight"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-[var(--accent)]"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Note</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              placeholder="Record the driver/track rationale and what would make you rerun the line."
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-[var(--accent)]"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Source URL</span>
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-[var(--accent)]"
            />
          </label>

          {error ? <p className="text-xs text-red-300">{error}</p> : null}

          <button
            type="button"
            onClick={save}
            disabled={saving || !title.trim() || !note.trim() || (scope === "driver" && !driverId)}
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Note"}
          </button>
        </div>

        <div className="space-y-3">
          {notes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              No saved underwriting notes yet.
            </div>
          ) : (
            notes.map((item) => (
              <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-[var(--border)] px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                        {noteScopeLabel(item)}
                      </span>
                      <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-300">
                        {item.note_type.replaceAll("_", " ")}
                      </span>
                    </div>
                    <h3 className="mt-3 text-sm font-bold text-white">{item.title}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => archive(item.id)}
                    disabled={archivingId === item.id}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] hover:text-white disabled:opacity-50"
                  >
                    {archivingId === item.id ? "Archiving..." : "Archive"}
                  </button>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{item.note}</p>
                {item.source_url ? (
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex text-xs font-semibold text-[var(--accent)] hover:underline"
                  >
                    Source
                  </a>
                ) : null}
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
