"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createUnderwritingNoteAction } from "@/app/actions";

type FeedbackType = {
  value: string;
  label: string;
  title: string;
  scope: "race" | "track";
};

const feedbackTypes: FeedbackType[] = [
  {
    value: "groove_review",
    label: "Groove / Traffic",
    title: "Groove and traffic note",
    scope: "track",
  },
  {
    value: "lineup_lesson",
    label: "Lineup / Starts",
    title: "Lineup and starting-position lesson",
    scope: "race",
  },
  {
    value: "entry_watch",
    label: "Entry / Scratch",
    title: "Entry availability note",
    scope: "race",
  },
  {
    value: "model_lesson",
    label: "Model Lesson",
    title: "Model learning note",
    scope: "race",
  },
  {
    value: "race_status",
    label: "Status / Cancel",
    title: "Race status note",
    scope: "race",
  },
];

export function QuickFeedbackPanel({
  raceId,
  trackId,
}: {
  raceId: number;
  trackId: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedbackType, setFeedbackType] = useState(feedbackTypes[0].value);
  const [scope, setScope] = useState<"race" | "track">(feedbackTypes[0].scope);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<{ tone: "ok" | "error"; message: string } | null>(null);

  const selected = feedbackTypes.find((type) => type.value === feedbackType) ?? feedbackTypes[0];

  function chooseType(value: string) {
    const nextType = feedbackTypes.find((type) => type.value === value) ?? feedbackTypes[0];
    setFeedbackType(nextType.value);
    setScope(nextType.scope);
  }

  function save() {
    const trimmed = note.trim();
    if (!trimmed) {
      setStatus({ tone: "error", message: "Add the observation first." });
      return;
    }

    setStatus(null);
    startTransition(async () => {
      const result = await createUnderwritingNoteAction({
        raceId,
        trackId,
        driverId: null,
        scope,
        noteType: selected.value,
        title: selected.title,
        note: trimmed,
      });

      if (result.error) {
        setStatus({ tone: "error", message: result.error });
        return;
      }

      setNote("");
      setStatus({
        tone: "ok",
        message:
          scope === "track"
            ? "Saved as a track carry-forward note. It will show on future races here."
            : "Saved to this race. Review it before republishing odds.",
      });
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
            Quick Feedback
          </p>
          <h2 className="mt-1 text-base font-bold text-white">Teach the next model pass</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Save observations here so they are visible in DirtIQ and not trapped in chat.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-1">
          {(["race", "track"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition-colors ${
                scope === value ? "bg-emerald-400 text-black" : "text-[var(--muted)] hover:text-white"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr_auto]">
        <select
          value={feedbackType}
          onChange={(event) => chooseType(event.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
        >
          {feedbackTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder="Example: multiple grooves; leader preferred low, but top/middle traffic was hard to lap."
          className="min-h-[42px] resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
        />
        <button
          type="button"
          onClick={save}
          disabled={isPending || !note.trim()}
          className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
      </div>

      {status ? (
        <p className={`mt-3 text-xs font-semibold ${status.tone === "ok" ? "text-emerald-300" : "text-red-300"}`}>
          {status.message}
        </p>
      ) : null}
    </section>
  );
}
